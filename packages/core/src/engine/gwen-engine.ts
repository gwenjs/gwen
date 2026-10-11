/**
 * Provides the new `createEngine(options?) → Promise<GwenEngine>` API.
 *
 * NAVIGATION (use IDE region folding — Ctrl+Shift+[ / Cmd+Shift+[):
 *   engine-errors.ts                            — error classes & codes
 *   engine-types.ts                             — all public type contracts
 *   hook-tracker.ts                             — ScopedHooksTracker
 *   plugin-registry.ts                          — PluginRegistry
 *   service-container.ts                        — ServiceContainer
 *   engine-entities.ts                          — EngineEntities
 *   engine-stats.ts                             — EngineStatsRecorder
 *   engine-state.ts                             — EngineStateMachine
 *   engine-error-policy.ts                      — EngineErrorPolicy
 *   wasm-module-runner.ts                       — WasmModuleRunner
 *   #region Engine implementation               — GwenEngineImpl (frame loop)
 *   #region Factory                             — createEngine()
 */

import { createHooks, type Hookable } from "hookable";
import {
  GwenError,
  type GwenErrorPayload as BusErrorPayload,
  type GwenErrorTarget,
} from "@gwenjs/schema";
import type { GwenRuntimeHooks } from "./runtime-hooks";
import { engineContext } from "./context";
import { gwenEngineSelf, popEngine, pushEngine } from "./engine-local";
import { componentRegistryFor, componentTypeIds } from "./engine-component-registry";
import { stringPoolFor } from "../utils/string-pool";
import { createLogger } from "../logger/index";
import type { IGwenLogger } from "@gwenjs/schema";
import { WasmBridgeImpl } from "./wasm-bridge";
import { EngineMemory } from "./engine-memory.js";
import type { EntityId } from "./engine-api";
import type { ComponentDefinition, ComponentSchema, InferComponent } from "../schema";
import type { ComponentDef, LiveQuery, EntityAccessor } from "../system/runtime/define-system";
import { validateEngineConfig } from "./engine-config-validator";

// ─── Re-exports from extracted type modules ─────────────────────────────────
// Public types live in ./engine-types.ts and ./engine-errors.ts. Re-export them so
// existing `import { ... } from './gwen-engine.js'` statements keep working.

export {
  GwenPluginNotFoundError,
  CoreErrorCodes,
  GwenWasmError,
  GwenWasmPanicError,
  GwenEngineStateError,
} from "./engine-errors.js";
export type {
  GwenPluginNotFoundErrorOptions,
  CoreWasmErrorCode,
  GwenEngineStateMethod,
} from "./engine-errors.js";
export type { PluginErrorContext } from "./engine-types.js";

export { GWEN_PLUGIN_API_VERSION, checkPluginApiVersion } from "./engine-types.js";
export type {
  WasmModuleOptions,
  WasmModuleHandle,
  PlacementBridge,
  EngineErrorBus,
  GwenEngineOptions,
  GwenProvides,
  GwenWasmModules,
  GwenPlugin,
  EngineFramePhaseMs,
  EngineStats,
  EngineState,
  EngineStateChange,
  EngineStateChangePayload,
  GwenEngineState,
  GwenEngineStateChangeReason,
  GwenEngine,
} from "./engine-types.js";

export type {
  WasmMemoryRegion,
  WasmMemoryOptions,
  WasmChannelOptions,
} from "./wasm-module-handle.js";
export { WasmRegionView, WasmRingBuffer } from "./wasm-module-handle.js";
export type { EngineErrorPayload } from "./runtime-hooks.js";

// ─── Imports from extracted modules (used by implementation below) ──────────

import { CoreErrorCodes, GwenEngineStateError } from "./engine-errors.js";

import { createErrorBus } from "./error-bus.js";
import { bindFailureReporter, isIsolated, isThenable } from "./error-isolation.js";
import { ScopedHooksTracker } from "./hook-tracker.js";
import { PluginRegistry } from "./plugin-registry.js";
import { ServiceContainer } from "./service-container.js";
import { EngineEntities } from "./engine-entities.js";
import { EngineStatsRecorder } from "./engine-stats.js";
import { EngineStateMachine } from "./engine-state.js";
import { EngineErrorPolicy } from "./engine-error-policy.js";
import { WasmModuleRunner } from "./wasm-module-runner.js";

import type {
  WasmModuleOptions,
  WasmModuleHandle,
  PlacementBridge,
  EngineErrorBus,
  GwenEngineOptions,
  GwenProvides,
  GwenWasmModules,
  GwenPlugin,
  EngineFramePhaseMs,
  EngineStats,
  GwenEngineState,
  GwenEngineStateChangeReason,
  GwenEngine,
} from "./engine-types.js";
import { DisposableRegistry, createDisposable } from "../disposable.js";
import { clamp } from "@gwenjs/math";
import type { ComponentType } from "../types";

type EngineHookFn = (...args: unknown[]) => unknown;

function callHooksWithEngine(
  engine: GwenEngine,
  hooks: readonly EngineHookFn[],
  args: readonly unknown[],
  start: number,
): unknown {
  for (let i = start; i < hooks.length; i++) {
    const hook = hooks[i];
    if (hook === undefined) continue;
    const previous = pushEngine(engine);
    try {
      const result = hook(...args);
      if (isThenable(result)) {
        return Promise.resolve(result)
          .then(() => callHooksWithEngine(engine, hooks, args, i + 1))
          .finally(() => popEngine(engine, previous));
      }
    } catch (error) {
      popEngine(engine, previous);
      return Promise.reject(error);
    }
    popEngine(engine, previous);
  }
  return undefined;
}

function callHooksWithEngineParallel(
  engine: GwenEngine,
  hooks: readonly EngineHookFn[],
  args: readonly unknown[],
): unknown {
  if (hooks.length === 0) return undefined;
  return Promise.all(
    hooks.map((hook) => {
      const previous = pushEngine(engine);
      try {
        const result = hook(...args);
        if (isThenable(result)) {
          return Promise.resolve(result).finally(() => popEngine(engine, previous));
        }
        popEngine(engine, previous);
        return result;
      } catch (error) {
        popEngine(engine, previous);
        return Promise.reject(error);
      }
    }),
  );
}

// #region Engine implementation

class GwenEngineImpl implements GwenEngine {
  /** Real engine behind a hooks proxy. */
  get [gwenEngineSelf](): this {
    return this;
  }

  /** Engine that `activate()` replaced. Restored by `deactivate()` when this engine is still current. */
  private _engineBeforeActivate: GwenEngine | undefined;
  private _activateCaptured = false;
  // ─── Config ──────────────────────────────────────────────────────────────
  readonly maxEntities: number;
  readonly targetFPS: number;
  readonly maxDeltaSeconds: number;
  timeScale: number = 1;
  readonly variant: "light" | "physics2d" | "physics3d";
  readonly debug: boolean;
  readonly logger: IGwenLogger;
  physicsHz: number;
  maxCatchupSteps: number;

  // ─── Disposables ─────────────────────────────────────────────────────────
  readonly disposables = new DisposableRegistry();

  // ─── Internal state ───────────────────────────────────────────────────────
  private readonly _pluginRegistry: PluginRegistry;
  private readonly _serviceContainer: ServiceContainer;
  private _advancing = false;
  private readonly _stateMachine: EngineStateMachine;
  /**
   * The one teardown claim allowed by the #107 amendment. Set when the first `stop()`
   * starts teardown. While it is set, every `stop()` returns at once. Only `stop()`
   * reads it; every other check reads `state`.
   */
  private _teardownOnce: true | null = null;
  private _rafHandle: number | ReturnType<typeof setTimeout> = 0;
  private _lastFrameTime = 0;
  /** Caller `errorBus`, or `createErrorBus()` when omitted. @internal */
  private readonly _policy: EngineErrorPolicy;

  private readonly _memory: EngineMemory;

  get errors(): EngineErrorBus {
    return this._policy.bus;
  }

  isolated(): readonly GwenErrorTarget[] {
    return this._policy.isolated();
  }

  reenable(id: string): boolean {
    return this._policy.reenable(id);
  }

  get memory(): EngineMemory {
    return this._memory;
  }

  get state(): GwenEngineState {
    return this._stateMachine.state;
  }

  /** Drops a scheduled rAF or timeout. A zero handle means nothing is queued. */
  private _cancelScheduledFrame(): void {
    if (!this._rafHandle) return;
    this._cancelFrame(this._rafHandle);
    this._rafHandle = 0;
  }

  private _transition(
    to: GwenEngineState,
    reason: GwenEngineStateChangeReason,
  ): Promise<void> | void {
    return this._stateMachine.transition(to, reason);
  }

  /** Plain read so a frame check does not narrow `state` for the rest of the method. */
  private _frameFaulted(): boolean {
    return this._stateMachine.isFaulted();
  }

  private _enterFaulted(reason: GwenEngineStateChangeReason): void {
    this._stateMachine.enterFaulted(reason);
  }

  private _assertNotFaulted(method: string): void {
    this._stateMachine.assert(method);
  }

  private _assertPluginCall(method: "use" | "unuse"): void {
    this._stateMachine.assertPlugin(method);
  }

  private readonly _wasmRunner: WasmModuleRunner;

  // ─── Frame scheduler ─────────────────────────────────────────────────────
  /**
   * Schedule the next animation frame.
   * Uses `requestAnimationFrame` on the main thread; falls back to `setTimeout`
   * in Web Worker contexts where RAF is unavailable.
   */
  private _scheduleFrame(cb: (time: number) => void): number | ReturnType<typeof setTimeout> {
    if (typeof requestAnimationFrame !== "undefined") {
      return requestAnimationFrame(cb);
    }
    // Worker fallback: no visual sync, but keeps the loop running.
    return setTimeout(() => cb(performance.now()), 0);
  }

  /** Cancel a previously scheduled frame (RAF or setTimeout handle). */
  private _cancelFrame(handle: number | ReturnType<typeof setTimeout>): void {
    if (typeof cancelAnimationFrame !== "undefined") {
      if (typeof handle === "number") cancelAnimationFrame(handle);
      return;
    }
    clearTimeout(handle);
  }

  // ─── Frame stats ─────────────────────────────────────────────────────────
  private readonly _stats: EngineStatsRecorder;
  /**
   * Reused phase slot. Allocated once, inside the dev+debug instrument gate. @internal
   */
  private _lastPhaseMs?: EngineFramePhaseMs;
  /** Add phase samples across the steps of one fixed-mode display frame. @internal */
  private _sumPhases = false;
  /** True after the first instrumented step of the current display frame. @internal */
  private _displayTimed = false;
  /** `performance.now()` at the start of that first step. @internal */
  private _displayT0 = 0;

  // ─── Hooks ───────────────────────────────────────────────────────────────
  readonly hooks: Hookable<GwenRuntimeHooks> = createHooks<GwenRuntimeHooks>();

  /** @internal */ readonly _bridge: WasmBridgeImpl;

  private readonly _entities: EngineEntities;

  constructor(opts: GwenEngineOptions) {
    this._bridge = opts._bridge ?? new WasmBridgeImpl();
    this.maxEntities = opts.maxEntities ?? 10_000;
    this.targetFPS = opts.targetFPS ?? 60;
    this.maxDeltaSeconds = opts.maxDeltaSeconds ?? 0.1;
    this.variant = opts.variant ?? "light";
    this.debug = opts.debug ?? false;
    this.physicsHz = opts.physicsHz ?? 0;
    this.maxCatchupSteps = opts.maxCatchupSteps ?? 2;
    this._stats = new EngineStatsRecorder({
      targetFPS: this.targetFPS,
      debug: this.debug,
      entityCount: () => this._entities.count(),
      linearMemory: () => {
        const readMemory = this._bridge.getLinearMemory;
        if (typeof readMemory !== "function") return null;
        return readMemory.call(this._bridge);
      },
      phaseMs: () => this._lastPhaseMs,
    });
    this.logger = createLogger("gwen:core", this.debug, () => this._stats.frameCount);
    // `provide` calls `assert` immediately. The machine exists before the first one.
    this._stateMachine = new EngineStateMachine({
      hooks: this.hooks,
      logger: this.logger,
      cancelFrame: () => this._cancelScheduledFrame(),
    });
    this._serviceContainer = new ServiceContainer({
      assertState: (method) => this._assertNotFaulted(method),
    });
    this.provide("wasm:bridge", this._bridge);
    this.provide("logger", this.logger);
    this._entities = new EngineEntities({
      maxEntities: this.maxEntities,
      queryCacheSize: opts.queryCacheSize ?? 256,
      assertState: (method) => this._assertNotFaulted(method),
      registerComponent: (type) => this.getOrRegisterComponent(type),
      emitDestroy: (id) => this._emitEntityDestroy(id),
    });

    const errorBus = opts.errorBus ?? createErrorBus({ logger: this.logger });
    this._policy = new EngineErrorPolicy({
      bus: errorBus,
      hooks: this.hooks,
      logger: this.logger,
      state: this._stateMachine,
      frame: () => this._stats.frameCount,
      debug: this.debug,
      owner: this,
      disposables: this.disposables,
      pluginNamed: (name) => this._pluginRegistry.pluginNamed(name),
      bridge: this._bridge,
    });
    this.provide("errors", errorBus);
    this._pluginRegistry = new PluginRegistry({
      hooks: this.hooks,
      tracker: new ScopedHooksTracker(),
      errors: errorBus,
      assertState: (method) => this._assertPluginCall(method),
      logger: this.logger,
      debug: this.debug,
      remember: (proxy) => this._rememberInternals(proxy),
      frame: () => this._stats.frameCount,
      reportSetup: (plugin, error) => this._reportSetupError(plugin, error),
      reportTeardown: (plugin, error) => this._reportTeardown(plugin, error),
      dropIsolation: (name) => this._dropPluginIsolation(name),
    });
    bindFailureReporter(this, (error, target, hook) => {
      this._reportCaught(error, hook, { target });
    });
    this._memory = new EngineMemory(this._bridge, errorBus);
    this.provide("memory", this._memory);
    this._wasmRunner = new WasmModuleRunner({
      bridge: this._bridge,
      maxEntities: this.maxEntities,
      disposables: this.disposables,
      memory: this._memory,
      assertState: (method) => this._assertNotFaulted(method),
      isFaulted: () => this._stateMachine.isFaulted(),
      isIsolated: (id) => isIsolated(this, id),
      frame: () => this._stats.frameCount,
      reportCaught: (err, hook, forced) => this._reportCaught(err, hook, forced),
      publish: (event) => this._publish(event),
    });
    this.disposables.add(
      "engine:memory",
      createDisposable(() => {
        this._memory.disposeAll();
      }),
    );
    this._attachErrorPolicy();
    this._rememberInternals(this);
    this._bindEngineOnHooks();
    stringPoolFor(this);
  }

  private _bindEngineOnHooks(): void {
    const hooks = this.hooks;
    const engine = this;
    const callWith = hooks.callHookWith.bind(hooks);
    const runSerial = (list: readonly EngineHookFn[], hookArgs: readonly unknown[]): unknown =>
      callHooksWithEngine(engine, list, hookArgs, 0);
    const runParallel = (list: readonly EngineHookFn[], hookArgs: readonly unknown[]): unknown =>
      callHooksWithEngineParallel(engine, list, hookArgs);
    hooks.callHook = ((name, ...args) => callWith(runSerial, name, args)) as typeof hooks.callHook;
    hooks.callHookParallel = ((name, ...args) =>
      callWith(runParallel, name, args)) as typeof hooks.callHookParallel;
  }

  // ─── Plugin runner ────────────────────────────────────────────────────────

  use(plugin: GwenPlugin): Promise<void> {
    return this._pluginRegistry.use(plugin, this);
  }

  unuse(name: string): Promise<void> {
    return this._pluginRegistry.unuse(name, this);
  }

  // ─── Typed provide/inject ─────────────────────────────────────────────────

  provide<K extends keyof GwenProvides>(key: K, value: GwenProvides[K]): void {
    this._serviceContainer.provide(key, value);
  }

  inject<K extends keyof GwenProvides>(key: K): GwenProvides[K] {
    return this._serviceContainer.inject(key);
  }

  tryInject<K extends keyof GwenProvides>(key: K): GwenProvides[K] | undefined {
    return this._serviceContainer.tryInject(key);
  }

  // ─── Context (RFC-005) ────────────────────────────────────────────────────

  /**
   * Executes `fn` within this engine's context.
   * Composables (`useEngine()`, `usePhysics2D()`, etc.) resolve to this instance inside `fn`.
   *
   * @param fn - Synchronous function to execute in context
   * @returns The return value of `fn`
   *
   * @example
   * ```typescript
   * const instance = engine.run(() => useEngine())
   * // instance === engine ✓
   * ```
   */
  run<T>(fn: () => T): T {
    this._assertNotFaulted("run");
    const previous = pushEngine(this);
    try {
      return fn();
    } finally {
      popEngine(this, previous);
    }
  }

  /**
   * Sets this engine as the globally active context instance.
   * Prefer {@link run} for scoped context management.
   * Use `activate()` / `deactivate()` only when you control the lifecycle manually
   * (e.g., a custom game loop outside `advance()`).
   */
  activate(): void {
    this._assertNotFaulted("activate");
    if (!this._activateCaptured) {
      this._engineBeforeActivate = engineContext.tryUse() ?? undefined;
      this._activateCaptured = true;
    }
    engineContext.set(this, true);
  }

  /**
   * Restores the engine captured by {@link activate} when this engine is still current.
   * A no-op when another engine has replaced the context.
   */
  deactivate(): void {
    this._assertNotFaulted("deactivate");
    if (engineContext.tryUse() !== this) return;
    const previous = this._engineBeforeActivate;
    this._engineBeforeActivate = undefined;
    this._activateCaptured = false;
    if (previous) engineContext.set(previous, true);
    else engineContext.unset();
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  private _handleFrameLoopError(err: unknown): void {
    this._policy.handleFrameLoopError(err);
  }

  /**
   * Start the RAF or fixed-step loop.
   *
   * Throws {@link GwenEngineStateError} when `state` is not `idle`.
   * Throws {@link GwenError} `CORE:WASM_NOT_INITIALIZED` when the bridge is not
   * active. That check does not change `state` and does not schedule a frame.
   * A later `start()` throws again until `bridge.init()` or `setupGwen()` has run.
   */
  async start(): Promise<void> {
    const state = this._stateMachine.state;
    if (state !== "idle") throw new GwenEngineStateError(state, "start");
    if (!this._bridge.isActive()) {
      throw new GwenError(
        CoreErrorCodes.WASM_NOT_INITIALIZED,
        "[GWEN] WASM core not initialized.\n" +
          "Call `await bridge.init()` or `setupGwen()` before starting the Engine.",
      );
    }
    this._attachErrorPolicy();
    this._lastFrameTime = performance.now();
    await this._beginStart();
    if (this._stateMachine.state !== "running") return;

    if (this.physicsHz) {
      // Fixed timestep loop — accumulator pattern
      const fixedDt = 1 / this.physicsHz;
      let accumulator = 0;

      const loop = async (now: number) => {
        if (this._stateMachine.state !== "running") return;

        try {
          const rawSeconds = (now - this._lastFrameTime) / 1000;
          this._lastFrameTime = now;
          this._stats.recordRawFrameTime(rawSeconds);
          accumulator += Math.min(rawSeconds, this.maxDeltaSeconds);

          let steps = 0;
          this._sumPhases = true;
          this._displayTimed = false;
          try {
            while (
              accumulator >= fixedDt &&
              steps < this.maxCatchupSteps &&
              this._stateMachine.state === "running"
            ) {
              const scaledDt = fixedDt * clamp(this.timeScale, 0, 100);
              this._stats.setDeltaTime(scaledDt);
              try {
                await this._runFrame(scaledDt);
              } catch (err) {
                this._handleFrameLoopError(err);
              }
              if (this._stateMachine.state !== "running") break;
              accumulator -= fixedDt;
              steps++;
            }
          } finally {
            this._sumPhases = false;
            this._displayTimed = false;
          }
        } finally {
          if (this._stateMachine.state === "running") this._rafHandle = this._scheduleFrame(loop);
        }
      };
      this._rafHandle = this._scheduleFrame(loop);
    } else {
      // Variable dt loop — original behaviour
      const loop = async (now: number) => {
        if (this._stateMachine.state !== "running") return;

        // Throttle to targetFPS: skip frame if minimum interval hasn't elapsed.
        // Use a 0.5ms tolerance to account for RAF timing jitter.
        const frameBudgetMs = 1000 / this.targetFPS;
        if (now - this._lastFrameTime < frameBudgetMs - 0.5) {
          if (this._stateMachine.state === "running") this._rafHandle = this._scheduleFrame(loop);
          return;
        }

        const rawSeconds = (now - this._lastFrameTime) / 1000;
        this._stats.recordRawFrameTime(rawSeconds);
        const dt = Math.min(rawSeconds, this.maxDeltaSeconds) * clamp(this.timeScale, 0, 100);
        this._lastFrameTime = now;
        this._stats.setDeltaTime(dt);
        try {
          await this._runFrame(dt);
        } catch (err) {
          this._handleFrameLoopError(err);
        } finally {
          if (this._stateMachine.state === "running") this._rafHandle = this._scheduleFrame(loop);
        }
      };
      this._rafHandle = this._scheduleFrame(loop);
    }
  }

  /**
   * Tear down once. Only the first `stop()` runs teardown. A `stop()` called while
   * teardown runs returns immediately and does not wait for it, so awaiting `stop()`
   * inside `engine:stop` or an `engine:state-change` handler for `stopping` resolves.
   * To know when teardown has finished, observe `engine:state-change` to `stopped`.
   */
  async stop(): Promise<void> {
    if (this._teardownOnce !== null) return;
    const from = this._stateMachine.state;
    if (from === "stopped" || from === "stopping") return;
    if (from === "starting") throw new GwenEngineStateError(from, "stop");
    // Claim before the first hook runs: a stop() from inside teardown must see it.
    this._teardownOnce = true;
    if (from !== "faulted") await this._transition("stopping", "USER");
    await this._teardown();
    if (this._stateMachine.state === "stopping") await this._transition("stopped", "USER");
  }

  /** Cancel the frame, run `engine:stop`, then clear hooks, this engine's module handles, and disposables. */
  private async _teardown(): Promise<void> {
    this._cancelScheduledFrame();
    try {
      await this.hooks.callHook("engine:stop");
    } catch (err) {
      this._handleFrameLoopError(err);
    }
    this._pluginRegistry.clearHooks();
    this._policy.clearIsolated();

    // Per-engine module handles only. The glue cache is shared by variant:
    // another live engine may still need those keys.
    this._wasmRunner.clear();

    this.disposables.disposeAll(); // LIFO — last registered, first disposed
    this._policy.dispose();
  }

  /**
   * `idle → starting` before `engine:init`, then `starting → running` after `engine:start`.
   * A throw from either hook moves `starting` to `faulted` and rejects the caller.
   */
  private async _beginStart(): Promise<void> {
    await this._transition("starting", "USER");
    let hook: "engine:init" | "engine:start" = "engine:init";
    try {
      await this.hooks.callHook("engine:init");
      if (this._stateMachine.state !== "starting") return;
      hook = "engine:start";
      await this.hooks.callHook("engine:start");
    } catch (err) {
      this._enterFaulted("FATAL_ERROR");
      const message = err instanceof Error ? err.message : String(err);
      this._emit({
        level: "fatal",
        code: CoreErrorCodes.FRAME_LOOP_ERROR,
        message,
        source: "@gwenjs/core",
        error: err,
        context: { frame: this._stats.frameCount, hook },
      });
      throw err;
    }
    if (this._stateMachine.state !== "starting") return;
    await this._transition("running", "USER");
  }

  /**
   * Initialise the engine for an externally driven loop.
   * Fires `engine:init` and `engine:start` hooks without launching a RAF loop.
   * Call this once, then drive frames by calling `advance(dt)` each tick.
   *
   * @example
   * ```typescript
   * await engine.startExternal()
   * // In a game loop / R3F useFrame:
   * engine.advance(1 / 60)
   * ```
   */
  async startExternal(): Promise<void> {
    const state = this._stateMachine.state;
    if (state !== "idle") throw new GwenEngineStateError(state, "startExternal");
    this._attachErrorPolicy();
    await this._beginStart();
    // Intentionally skip RAF — the caller drives the loop via advance().
  }

  async advance(dt: number): Promise<void> {
    if (this._stateMachine.state !== "idle" && this._stateMachine.state !== "running") {
      throw new GwenEngineStateError(this._stateMachine.state, "advance");
    }
    if (this._advancing) {
      throw new GwenError(
        CoreErrorCodes.ADVANCE_REENTRANT,
        "[GwenEngine] advance() called re-entrantly — only one advance per frame.",
      );
    }
    this._advancing = true;
    this._stats.recordRawFrameTime(dt);
    // Cap dt at maxDeltaSeconds to prevent spiral-of-death after tab suspension.
    const cappedDt = Math.min(dt, this.maxDeltaSeconds) * clamp(this.timeScale, 0, 100);
    this._stats.setDeltaTime(cappedDt);
    try {
      await this._runFrame(cappedDt);
    } catch (err) {
      this._handleFrameLoopError(err);
    } finally {
      this._advancing = false;
    }
  }

  // ─── WASM modules (RFC-008) ────────────────────────────────────────────────

  /**
   * Fetch and instantiate a WASM binary, then register it under `options.name`.
   * If a module with the same name is already loaded, returns the existing handle.
   *
   * @param options - Load options: name, URL, and optional per-frame step.
   * @returns The typed {@link WasmModuleHandle}.
   * @throws {GwenError} `CORE:WASM_LOAD_ERROR` when fetch, compile, the probe
   *   instantiate or the second instantiate fails.
   * @throws {GwenError} `CORE:WASM_NOT_INITIALIZED` when `transformRegion` is
   *   set and the WASM bridge is not active.
   * @throws {GwenError} `CORE:WASM_MODULE_REGION_TOO_SMALL` or
   *   `CORE:WASM_MODULE_REGION_INVALID` when `transformRegion` fails a load check.
   *   The module is not registered and the engine keeps running.
   * @throws {GwenError} `CORE:WASM_API_VERSION_MISMATCH` when `versionPolicy`
   *   is `throw` and `gwen_plugin_api_version` does not match.
   */
  loadWasmModule<Exports extends WebAssembly.Exports = WebAssembly.Exports>(
    options: WasmModuleOptions<Exports>,
  ): Promise<WasmModuleHandle<Exports>> {
    return this._wasmRunner.load(options);
  }

  /**
   * Retrieve a previously loaded WASM module handle by name.
   *
   * @param name - The name supplied to {@link loadWasmModule}.
   * @returns The typed {@link WasmModuleHandle}.
   * @throws {GwenError} If no module has been loaded under `name`.
   */
  getWasmModule<K extends keyof GwenWasmModules>(name: K): WasmModuleHandle<GwenWasmModules[K]> {
    return this._wasmRunner.get(name);
  }

  // ─── ECS entity management ────────────────────────────────────────────────

  /**
   * Create a new entity.
   * @returns A fresh {@link EntityId}.
   * @throws {GwenError} code `CORE:ENTITY_LIMIT_REACHED` when the entity capacity is exceeded.
   */
  createEntity(): EntityId {
    return this._entities.createEntity();
  }

  canSpawn(count: number): boolean {
    return this._entities.canSpawn(count);
  }

  /**
   * Destroy an entity and remove all its components.
   *
   * @param id - The entity to destroy
   * @returns `true` if it was alive and is now destroyed
   */
  destroyEntity(id: EntityId): boolean {
    return this._entities.destroyEntity(id);
  }

  private _emitEntityDestroy(id: EntityId): void {
    this.hooks.callHookWith(
      (hooks, args) => {
        for (const handler of hooks) {
          const previous = pushEngine(this);
          try {
            const result = handler(...args);
            if (result instanceof Promise) {
              void result.catch((error: unknown) => {
                this._reportEntityDestroyFailure(id, error);
              });
            }
          } catch (error) {
            this._reportEntityDestroyFailure(id, error);
          } finally {
            popEngine(this, previous);
          }
        }
      },
      "entity:destroy",
      [id],
    );
  }

  private _reportEntityDestroyFailure(id: EntityId, error: unknown): void {
    this._policy.reportEntityDestroyFailure(id, error);
  }

  /**
   * Check whether an entity is currently alive.
   *
   * @param id - The entity to check
   * @returns `true` if alive
   */
  isAlive(id: EntityId): boolean {
    return this._entities.isAlive(id);
  }

  /**
   * Slot flag used by actor pools. Not a component and not on {@link GwenEngine}.
   * Returns false when `id` is not alive, without changing state.
   * @internal
   */
  _setEntityDormant(id: EntityId, dormant: boolean): boolean {
    return this._entities.setDormant(id, dormant);
  }

  // ─── ECS component management ─────────────────────────────────────────────

  /**
   * Attach a component to an entity.
   * Merges `def.defaults` with the supplied `data` (data wins on conflict).
   *
   * @param id - Target entity
   * @param def - Component definition
   * @param data - Partial data to store (merged with defaults)
   */
  /**
   * Rust component type id for `name`, owned by this engine.
   * The same name (including an HMR re-definition) keeps the same id.
   * Numeric ids are not baked by the Vite optimizer; cached lookup is #66.
   */
  getOrRegisterComponent(type: ComponentType): number {
    this._assertNotFaulted("getOrRegisterComponent");
    return componentRegistryFor(this).getOrRegister(type);
  }

  /** Names registered on this engine. Does not create the registry. */
  registeredComponentTypes(): ReadonlyMap<ComponentType, number> {
    return componentTypeIds(this);
  }

  addComponent<D extends ComponentDefinition<ComponentSchema>>(
    id: EntityId,
    def: D,
    data: Partial<InferComponent<D>>,
  ): void {
    this._entities.addComponent(id, def, data);
  }

  /**
   * Retrieve a component from an entity.
   *
   * @param id - Target entity
   * @param def - Component definition to look up
   * @returns The stored component data, or `undefined`
   */
  getComponent<D extends ComponentDefinition<ComponentSchema>>(
    id: EntityId,
    def: D,
  ): InferComponent<D> | undefined {
    return this._entities.getComponent(id, def);
  }

  /**
   * Check whether an entity has a specific component.
   *
   * @param id - Target entity
   * @param def - Component definition to check
   * @returns `true` if the component is present
   */
  hasComponent<D extends ComponentDefinition<ComponentSchema>>(id: EntityId, def: D): boolean {
    return this._entities.hasComponent(id, def);
  }

  /**
   * Remove a component from an entity.
   *
   * @param id - Target entity
   * @param def - Component definition to remove
   * @returns `true` if the component existed and was removed
   */
  removeComponent<D extends ComponentDefinition<ComponentSchema>>(id: EntityId, def: D): boolean {
    return this._entities.removeComponent(id, def);
  }

  // ─── ECS live query ───────────────────────────────────────────────────────

  /**
   * Create a live query that reflects the current ECS state on each iteration.
   *
   * The returned `Iterable` re-evaluates matching entities every time it is
   * iterated — no stale cache is exposed to the caller.
   *
   * @param components - Array of component definitions all matched entities must have
   * @param precomputedKey - Optional cache key pre-computed by the Vite transform.
   *   When provided, `normalizeComponentTypesForQuery` is skipped.
   *   Do not pass manually; this parameter is injected by `gwenQueryHoistPlugin`.
   * @returns A live {@link LiveQuery} of {@link EntityAccessor} objects
   */
  createLiveQuery<const C extends readonly ComponentDef[]>(
    components: C,
    _precomputedKey?: string,
  ): LiveQuery<EntityAccessor<C>> {
    return this._entities.createLiveQuery(components, _precomputedKey);
  }

  // ─── Internal WASM bridge accessors ───────────────────────────────────────

  getPlacementBridge(): PlacementBridge {
    const bridge = this._bridge.engine();
    if (!bridge) {
      throw new GwenError(
        CoreErrorCodes.WASM_NOT_INITIALIZED,
        "[GWEN] getPlacementBridge() called before WASM is initialised. " +
          "Await bridge.init() before calling placement composables.",
      );
    }
    // boundary: WASM bridge object is an untyped export bag. PlacementBridge is its typed view.
    return bridge as unknown as PlacementBridge;
  }

  // ─── Stats ────────────────────────────────────────────────────────────────

  get deltaTime(): number {
    return this._stats.deltaTime;
  }
  /** Uncapped, unscaled wall-frame duration in seconds. */
  get rawFrameTime(): number {
    return this._stats.rawFrameTime;
  }
  /** Frame counter — increments by 1 for each completed `_runFrame` call. */
  get frameCount(): number {
    return this._stats.frameCount;
  }
  /** Smoothed frames per second from the raw wall-frame duration, not the scaled simulation dt. */
  getFPS(): number {
    return this._stats.fps;
  }
  getStats(): EngineStats {
    return this._stats.snapshot();
  }

  /** One phase object for the life of the engine. Created on the first timed frame. */
  private _phaseSlot(): EngineFramePhaseMs {
    const existing = this._lastPhaseMs;
    if (existing !== undefined) return existing;
    const slot: EngineFramePhaseMs = {
      tick: 0,
      plugins: 0,
      wasm: 0,
      update: 0,
      render: 0,
      afterTick: 0,
      total: 0,
    };
    this._lastPhaseMs = slot;
    return slot;
  }

  // ─── 8-phase frame runner ─────────────────────────────────────────────────

  private _emit(event: BusErrorPayload): void {
    this._policy.emit(event);
  }

  private _publish(event: BusErrorPayload): void {
    this._policy.publish(event);
  }

  private _attachErrorPolicy(): void {
    this._policy.attach();
  }

  private _dropPluginIsolation(name: string): void {
    this._policy.dropIsolation(name);
  }

  private _reportSetupError(plugin: GwenPlugin, err: unknown): void {
    this._policy.reportSetupError(plugin, err);
  }

  private _reportTeardown(plugin: GwenPlugin, err: unknown): void {
    this._policy.reportTeardown(plugin, err);
  }

  private _reportCaught(
    err: unknown,
    hook: string,
    forced?: {
      level?: "error" | "fatal";
      code?: string;
      source?: string;
      message?: string;
      target?: GwenErrorTarget;
    },
  ): void {
    this._policy.reportCaught(err, hook, forced);
  }

  private _settleHook(hook: string, result: unknown): unknown {
    if (!isThenable(result)) return undefined;
    return result.then(undefined, (error: unknown) => {
      this._reportCaught(error, hook);
    });
  }

  private _guardHook0(hook: "engine:render"): unknown {
    let result: unknown;
    try {
      result = this.hooks.callHook(hook);
    } catch (error) {
      this._reportCaught(error, hook);
      return undefined;
    }
    return this._settleHook(hook, result);
  }

  private _guardHook1(
    hook:
      | "engine:tick"
      | "engine:before-update"
      | "engine:update"
      | "engine:after-update"
      | "engine:afterTick",
    arg: number,
  ): unknown {
    let result: unknown;
    try {
      result = this.hooks.callHook(hook, arg);
    } catch (error) {
      this._reportCaught(error, hook);
      return undefined;
    }
    return this._settleHook(hook, result);
  }

  /**
   * One identity check before a frame phase.
   * Returns a promise only when memory grew, so a quiet frame stays synchronous.
   * A handler that throws is an error on the bus. The frame continues.
   */
  private _onPhaseBoundary(): Promise<void> | void {
    if (!this._bridge.checkMemoryGrow()) return;
    const memory = this._bridge.getLinearMemory();
    const byteLength = memory === null ? 0 : memory.buffer.byteLength;
    const frame = this._stats.frameCount;
    this._memory.noteGrowth(frame);
    let pending: Promise<unknown> | void;
    try {
      pending = this.hooks.callHook("engine:memory-grow", {
        epoch: this._memory.epoch,
        byteLength,
        frame,
      }) as Promise<unknown> | void;
    } catch (error: unknown) {
      this._reportMemoryGrow(error, frame);
      return;
    }
    if (pending === undefined || pending === null || typeof pending.then !== "function") return;
    return pending.then(
      () => undefined,
      (error: unknown) => {
        this._reportMemoryGrow(error, frame);
      },
    );
  }

  private _reportMemoryGrow(error: unknown, frame: number): void {
    this._policy.reportMemoryGrow(error, frame);
  }

  private async _runFrame(dt: number): Promise<void> {
    // Phases start with this engine current. Each hook handler re-asserts it
    // before it runs. After an await, the continuation keeps this engine only
    // when no other engine has run. `finally` restores the engine found on
    // entry when this engine is still current, and never clears another engine.
    const previousEngine = engineContext.tryUse() ?? undefined;
    engineContext.set(this, true);
    // Single per-frame debug read. Timers, sentinels, and the budget scan sit under it.
    const instrument = __GWEN_DEV__ && this.debug;
    let t0 = 0;
    let t1 = 0;
    let t2 = 0;
    let t3 = 0;
    let t5 = 0;
    let t6 = 0;
    let t7 = 0;
    let t8 = 0;
    if (instrument) t0 = performance.now();
    try {
      // Phase 1 — engine:tick hook (fires before any plugin work)
      if (instrument) t1 = performance.now();
      if (this._frameFaulted()) return;
      {
        const memoryGrow = this._onPhaseBoundary();
        if (memoryGrow !== undefined) await memoryGrow;
      }
      if (this._frameFaulted()) return;
      const tickDone = this._guardHook1("engine:tick", dt);
      if (isThenable(tickDone)) await tickDone;
      if (instrument) t2 = performance.now();

      // Phase 2 — emit before-update hook (physics plugins step here)
      if (this._frameFaulted()) return;
      {
        const memoryGrow = this._onPhaseBoundary();
        if (memoryGrow !== undefined) await memoryGrow;
      }
      if (this._frameFaulted()) return;
      const beforeDone = this._guardHook1("engine:before-update", dt);
      if (isThenable(beforeDone)) await beforeDone;
      if (instrument) t3 = performance.now();

      // Phase 3 — community WASM modules step (Cas B: user WASM, registration order)
      if (this._frameFaulted()) return;
      {
        const memoryGrow = this._onPhaseBoundary();
        if (memoryGrow !== undefined) await memoryGrow;
      }
      if (this._frameFaulted()) return;
      this._wasmRunner.stepAll(dt);
      if (instrument) t5 = performance.now();

      // Memory sentinel — dev+debug only, and only when shared memory is active.
      if (instrument) this._wasmRunner.checkSentinels();

      // Phase 4 — ECS query flush + transform propagation
      if (this._frameFaulted()) return;
      {
        const memoryGrow = this._onPhaseBoundary();
        if (memoryGrow !== undefined) await memoryGrow;
      }
      if (this._frameFaulted()) return;
      // update_transforms() propagates local→world transforms so that
      // get_entity_world_x/y/rotation return up-to-date values in onUpdate.
      try {
        this._bridge.engine().update_transforms?.();
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        this._reportCaught(err, "update_transforms", {
          message: `update_transforms failed: ${detail}`,
        });
      }

      // Phase 5 — emit update hook
      if (this._frameFaulted()) return;
      {
        const memoryGrow = this._onPhaseBoundary();
        if (memoryGrow !== undefined) await memoryGrow;
      }
      if (this._frameFaulted()) return;
      const updateDone = this._guardHook1("engine:update", dt);
      if (isThenable(updateDone)) await updateDone;
      if (instrument) t6 = performance.now();

      // Phase 6a — emit after-update hook
      if (this._frameFaulted()) return;
      {
        const memoryGrow = this._onPhaseBoundary();
        if (memoryGrow !== undefined) await memoryGrow;
      }
      if (this._frameFaulted()) return;
      const afterDone = this._guardHook1("engine:after-update", dt);
      if (isThenable(afterDone)) await afterDone;
      if (this._frameFaulted()) return;

      // Phase 6b — emit render hook
      const renderDone = this._guardHook0("engine:render");
      if (isThenable(renderDone)) await renderDone;
      if (instrument) t7 = performance.now();

      // Phase 7 — update stats, then fire engine:afterTick hook
      if (this._frameFaulted()) return;
      {
        const memoryGrow = this._onPhaseBoundary();
        if (memoryGrow !== undefined) await memoryGrow;
      }
      if (this._frameFaulted()) return;
      this._stats.frameCompleted();
      const afterTickDone = this._guardHook1("engine:afterTick", dt);
      if (isThenable(afterTickDone)) await afterTickDone;
      if (instrument) t8 = performance.now();

      if (instrument) {
        const tick = t2 - t1;
        const plugins = t3 - t2;
        const wasm = t5 - t3;
        const update = t6 - t5;
        const render = t7 - t6;
        const afterTick = t8 - t7;
        const slot = this._phaseSlot();
        if (this._sumPhases && this._displayTimed) {
          slot.tick += tick;
          slot.plugins += plugins;
          slot.wasm += wasm;
          slot.update += update;
          slot.render += render;
          slot.afterTick += afterTick;
          slot.total = t8 - this._displayT0;
        } else {
          slot.tick = tick;
          slot.plugins = plugins;
          slot.wasm = wasm;
          slot.update = update;
          slot.render = render;
          slot.afterTick = afterTick;
          slot.total = t8 - t0;
          if (this._sumPhases) {
            this._displayTimed = true;
            this._displayT0 = t0;
          }
        }
        const budget = 1000 / this.targetFPS;
        if (tick > budget * 0.5) {
          this.logger.warn(`phase "tick" exceeded 50% of frame budget`, {
            phase: "tick",
            ms: tick.toFixed(2),
            budgetMs: budget.toFixed(2),
            frame: this._stats.frameCount,
          });
        }
        if (plugins > budget * 0.5) {
          this.logger.warn(`phase "plugins" exceeded 50% of frame budget`, {
            phase: "plugins",
            ms: plugins.toFixed(2),
            budgetMs: budget.toFixed(2),
            frame: this._stats.frameCount,
          });
        }
        if (wasm > budget * 0.5) {
          this.logger.warn(`phase "wasm" exceeded 50% of frame budget`, {
            phase: "wasm",
            ms: wasm.toFixed(2),
            budgetMs: budget.toFixed(2),
            frame: this._stats.frameCount,
          });
        }
        if (update > budget * 0.5) {
          this.logger.warn(`phase "update" exceeded 50% of frame budget`, {
            phase: "update",
            ms: update.toFixed(2),
            budgetMs: budget.toFixed(2),
            frame: this._stats.frameCount,
          });
        }
        if (render > budget * 0.5) {
          this.logger.warn(`phase "render" exceeded 50% of frame budget`, {
            phase: "render",
            ms: render.toFixed(2),
            budgetMs: budget.toFixed(2),
            frame: this._stats.frameCount,
          });
        }
        if (afterTick > budget * 0.5) {
          this.logger.warn(`phase "afterTick" exceeded 50% of frame budget`, {
            phase: "afterTick",
            ms: afterTick.toFixed(2),
            budgetMs: budget.toFixed(2),
            frame: this._stats.frameCount,
          });
        }
      }
    } finally {
      popEngine(this, previousEngine);
    }
  }

  private _rememberInternals(key: object): void {
    engineInternals.set(key, {
      setDormant: (id, dormant) => this._setEntityDormant(id, dormant),
      queryIds: (components) => this._entities.resolveIds(components),
    });
  }
}

// #endregion

const engineInternals = new WeakMap<
  object,
  {
    setDormant(id: EntityId, dormant: boolean): boolean;
    queryIds(components: readonly ComponentDef[]): readonly EntityId[];
  }
>();

/**
 * Pool dormancy flag. Not part of {@link GwenEngine}.
 * False when `engine` is not a GWEN engine or `id` is not alive.
 * @internal
 */
export function setEntityDormant(engine: GwenEngine, id: EntityId, dormant: boolean): boolean {
  const ops = engineInternals.get(engine);
  if (!ops) return false;
  return ops.setDormant(id, dormant);
}

/**
 * Cached id list for one query. The same array until a real membership change.
 * @internal
 */
export function readLiveQueryIds(
  engine: GwenEngine,
  components: readonly ComponentDef[],
): readonly EntityId[] {
  const ops = engineInternals.get(engine);
  if (!ops) return [];
  return ops.queryIds(components);
}

// #region Factory ─────────────────────────────────────────────────────────────

/**
 * Create a GWEN engine instance.
 *
 * @param options - Engine configuration. All fields optional.
 * @returns The engine. WASM is not loaded. Use {@link setupGwen} to load it.
 *
 * @example
 * ```typescript
 * import { createEngine } from '@gwenjs/core'
 * const engine = await createEngine({ maxEntities: 5_000, variant: 'physics2d' })
 * await engine.use(myPlugin())
 * // start() throws CORE:WASM_NOT_INITIALIZED until setupGwen() or bridge.init().
 * ```
 */
export async function createEngine(options?: GwenEngineOptions): Promise<GwenEngine> {
  validateEngineConfig(options ?? {});
  return new GwenEngineImpl(options ?? {});
}

/**
 * Initialises the WASM core and creates a new engine in a single call.
 *
 * Equivalent to:
 * ```ts
 * const bridge = new WasmBridgeImpl();
 * await bridge.init(options?.variant ?? 'light', options);
 * const engine = await createEngine({ ...options, _bridge: bridge });
 * ```
 *
 * Use this in application entry points. In tests or environments where WASM
 * must be mocked, call {@link createEngine} directly and pass a pre-configured
 * `WasmBridgeImpl` via the `_bridge` option (e.g. `createEngine({ _bridge: myBridge })`).
 *
 * @param options - Engine configuration. `variant` is forwarded to `bridge.init`.
 * @returns A fully initialised {@link GwenEngine} with WASM ready.
 *
 * @example
 * ```ts
 * import { setupGwen } from '@gwenjs/core'
 *
 * const engine = await setupGwen({ variant: 'physics2d', maxEntities: 5_000 })
 * await engine.start()
 * ```
 */
export async function setupGwen(options?: GwenEngineOptions): Promise<GwenEngine> {
  const bridge = new WasmBridgeImpl();
  await bridge.init(options?.variant ?? "light", options);
  return createEngine({ ...options, _bridge: bridge });
}
