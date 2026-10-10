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
 *   #region Engine implementation               — GwenEngineImpl (frame loop)
 *   #region Factory                             — createEngine()
 */

import { createHooks, type Hookable } from "hookable";
import {
  GwenError,
  type GwenErrorPayload as BusErrorPayload,
  type GwenErrorTarget,
  type PluginErrorContext,
} from "@gwenjs/schema";
import type { GwenRuntimeHooks, EngineErrorPayload } from "./runtime-hooks";
import { engineContext } from "./context";
import { gwenEngineSelf, popEngine, pushEngine } from "./engine-local";
import { componentRegistryFor, componentTypeIds } from "./engine-component-registry";
import { stringPoolFor } from "../utils/string-pool";
import { createLogger } from "../logger/index";
import type { IGwenLogger } from "@gwenjs/schema";
import { WasmRegionView, WasmRingBuffer, type WasmMemoryRegion } from "./wasm-module-handle";
import { poisonWasmBridge, WasmBridgeImpl } from "./wasm-bridge";
import { EngineMemory, type MemoryView } from "./engine-memory.js";
import type { EntityId } from "./engine-api";
import type { ComponentDefinition, ComponentSchema, InferComponent } from "../schema";
import type { ComponentDef, LiveQuery, EntityAccessor } from "../system/runtime/define-system";
import { buildTransformImports } from "../hooks/wasm/transform-imports";
import { SharedMemoryManager, TRANSFORM_STRIDE } from "../hooks/wasm/shared-memory";
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

import {
  CoreErrorCodes,
  GwenWasmError,
  GwenWasmPanicError,
  GwenEngineStateError,
} from "./engine-errors.js";

import { GWEN_PLUGIN_API_VERSION, checkPluginApiVersion } from "./engine-types.js";
import { createErrorBus } from "./error-bus.js";
import {
  bindFailureReporter,
  clearIsolated,
  forgetTarget,
  isIsolated,
  isThenable,
  isolateTarget,
  listIsolated,
  phaseForHook,
} from "./error-isolation.js";
import { ScopedHooksTracker } from "./hook-tracker.js";
import { PluginRegistry } from "./plugin-registry.js";
import { ServiceContainer } from "./service-container.js";
import { EngineEntities } from "./engine-entities.js";

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

interface WasmModuleTransformCopy {
  offset: number;
  bytes: Uint8Array | null;
}

interface WasmModuleEntry {
  handle: WasmModuleHandle<WebAssembly.Exports>;
  step?: (handle: WasmModuleHandle<WebAssembly.Exports>, dt: number) => void;
  transformCopy: WasmModuleTransformCopy | null;
}

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
  private _deltaTime = 0;
  private _state: GwenEngineState = "idle";
  /**
   * The one teardown claim allowed by the #107 amendment. Set when the first `stop()`
   * starts teardown. While it is set, every `stop()` returns at once. Only `stop()`
   * reads it; every other check reads `state`.
   */
  private _teardownOnce: true | null = null;
  private _rafHandle: number | ReturnType<typeof setTimeout> = 0;
  private _lastFrameTime = 0;
  /** Caller `errorBus`, or `createErrorBus()` when omitted. @internal */
  private readonly _errorBus: EngineErrorBus;
  private _errorOnAttached = false;
  private _errorFatalAttached = false;
  private _errorInstallAttached = false;
  private _emitBridgeActive = false;
  /** Set when `emit` cannot be wrapped. `engine:error` then fires from `on`. */
  private _engineErrorFromOn = false;
  /** One core trap is published. A later poisoned-bridge rethrow is not a second panic. */
  private _wasmPanicPublished = false;

  private readonly _memory: EngineMemory;

  get errors(): EngineErrorBus {
    return this._errorBus;
  }

  isolated(): readonly GwenErrorTarget[] {
    return listIsolated(this);
  }

  reenable(id: string): boolean {
    return forgetTarget(this, id);
  }

  get memory(): EngineMemory {
    return this._memory;
  }

  get state(): GwenEngineState {
    return this._state;
  }

  /** Drops a scheduled rAF or timeout. A zero handle means nothing is queued. */
  private _cancelScheduledFrame(): void {
    if (!this._rafHandle) return;
    this._cancelFrame(this._rafHandle);
    this._rafHandle = 0;
  }

  /**
   * The only writer of `_state`.
   * Sets the state before the hook runs. A throwing handler is logged.
   * It does not undo the transition or escape to the caller.
   * Returns a promise only when the hook itself returns one.
   */
  private _transition(
    to: GwenEngineState,
    reason: GwenEngineStateChangeReason,
  ): Promise<void> | void {
    const from = this._state;
    if (from === to) return;
    this._state = to;
    let result: unknown;
    try {
      result = this.hooks.callHook("engine:state-change", { from, to, reason });
    } catch (error: unknown) {
      this._logHandlerFailed(error);
      return;
    }
    if (!isThenable(result)) return;
    return Promise.resolve(result).then(
      () => undefined,
      (error: unknown) => {
        this._logHandlerFailed(error);
      },
    );
  }

  /** Plain read so a frame check does not narrow `_state` for the rest of the method. */
  private _frameFaulted(): boolean {
    return this._state === "faulted";
  }

  private _enterFaulted(reason: GwenEngineStateChangeReason): void {
    if (this._state === "faulted" || this._state === "stopped") return;
    this._cancelScheduledFrame();
    const pending = this._transition("faulted", reason);
    if (pending !== undefined) this._catchAsync(pending);
  }

  private _assertNotFaulted(method: string): void {
    if (this._state !== "faulted") return;
    throw new GwenError(
      CoreErrorCodes.INVALID_STATE_TRANSITION,
      `[GwenEngine] ${method}() is not allowed while the engine is faulted.`,
    );
  }

  /**
   * `use` / `unuse` are legal in `idle` and `running` only. `stopped` is terminal (#107):
   * a plugin installed after `stop()` would never be torn down.
   */
  private _assertPluginCall(method: "use" | "unuse"): void {
    const state = this._state;
    if (state === "idle" || state === "running") {
      return;
    }
    throw new GwenEngineStateError(state, method);
  }

  // ─── WASM module registry (RFC-008) ───────────────────────────────────────
  /**
   * Map of loaded WASM module entries keyed by name.
   * Each entry holds the public handle and the optional per-frame step function.
   * @internal
   */
  private readonly _wasmModules = new Map<string, WasmModuleEntry>();

  /**
   * Lazily-created shared memory manager for community WASM plugin transform access.
   * Created on first `loadWasmModule()` call. Null until then.
   * @internal
   */
  private _sharedMemory: SharedMemoryManager | null = null;
  /** Core-memory view of the fill buffer. Disposed before that buffer is freed. */
  private _transformView: MemoryView<"u8"> | null = null;

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
  /**
   * Frame counter driven exclusively by `_runFrame` calls.
   * @internal
   */
  private _frameCountOwn = 0;
  /** Smoothed FPS. First positive raw sample is exact; later samples use a 0.5s EMA. @internal */
  private _fps = 0;
  /** True after the first positive raw frame sample. @internal */
  private _hasFpsSample = false;
  /** Uncapped, unscaled wall-frame duration in seconds. @internal */
  private _rawFrameTime = 0;
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
    this._serviceContainer = new ServiceContainer({
      assertState: (method) => this._assertNotFaulted(method),
    });
    this._bridge = opts._bridge ?? new WasmBridgeImpl();
    this.provide("wasm:bridge", this._bridge);
    this.maxEntities = opts.maxEntities ?? 10_000;
    this.targetFPS = opts.targetFPS ?? 60;
    this.maxDeltaSeconds = opts.maxDeltaSeconds ?? 0.1;
    this.variant = opts.variant ?? "light";
    this.debug = opts.debug ?? false;
    this.physicsHz = opts.physicsHz ?? 0;
    this.maxCatchupSteps = opts.maxCatchupSteps ?? 2;
    this.logger = createLogger("gwen:core", this.debug, () => this._frameCountOwn);
    this.provide("logger", this.logger);
    this._entities = new EngineEntities({
      maxEntities: this.maxEntities,
      queryCacheSize: opts.queryCacheSize ?? 256,
      assertState: (method) => this._assertNotFaulted(method),
      registerComponent: (type) => this.getOrRegisterComponent(type),
      emitDestroy: (id) => this._emitEntityDestroy(id),
    });

    const errorBus = opts.errorBus ?? createErrorBus({ logger: this.logger });
    this._errorBus = errorBus;
    this.provide("errors", errorBus);
    this._pluginRegistry = new PluginRegistry({
      hooks: this.hooks,
      tracker: new ScopedHooksTracker(),
      errors: errorBus,
      assertState: (method) => this._assertPluginCall(method),
      logger: this.logger,
      debug: this.debug,
      remember: (proxy) => this._rememberInternals(proxy),
      frame: () => this._frameCountOwn,
      reportSetup: (plugin, error) => this._reportSetupError(plugin, error),
      reportTeardown: (plugin, error) => this._reportTeardown(plugin, error),
      dropIsolation: (name) => this._dropPluginIsolation(name),
    });
    bindFailureReporter(this, (error, target, hook) => {
      this._reportCaught(error, hook, { target });
    });
    this._memory = new EngineMemory(this._bridge, errorBus);
    this.provide("memory", this._memory);
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
    if (err instanceof WebAssembly.RuntimeError) {
      poisonWasmBridge(this._bridge, err);
    }
    try {
      this._reportCaught(err, "frame");
    } catch (handlerError) {
      this._logHandlerFailed(handlerError);
    }
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
    const state = this._state;
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
    if (this._state !== "running") return;

    if (this.physicsHz) {
      // Fixed timestep loop — accumulator pattern
      const fixedDt = 1 / this.physicsHz;
      let accumulator = 0;

      const loop = async (now: number) => {
        if (this._state !== "running") return;

        try {
          const rawSeconds = (now - this._lastFrameTime) / 1000;
          this._lastFrameTime = now;
          this._recordRawFrameTime(rawSeconds);
          accumulator += Math.min(rawSeconds, this.maxDeltaSeconds);

          let steps = 0;
          this._sumPhases = true;
          this._displayTimed = false;
          try {
            while (
              accumulator >= fixedDt &&
              steps < this.maxCatchupSteps &&
              this._state === "running"
            ) {
              const scaledDt = fixedDt * clamp(this.timeScale, 0, 100);
              this._deltaTime = scaledDt;
              try {
                await this._runFrame(scaledDt);
              } catch (err) {
                this._handleFrameLoopError(err);
              }
              if (this._state !== "running") break;
              accumulator -= fixedDt;
              steps++;
            }
          } finally {
            this._sumPhases = false;
            this._displayTimed = false;
          }
        } finally {
          if (this._state === "running") this._rafHandle = this._scheduleFrame(loop);
        }
      };
      this._rafHandle = this._scheduleFrame(loop);
    } else {
      // Variable dt loop — original behaviour
      const loop = async (now: number) => {
        if (this._state !== "running") return;

        // Throttle to targetFPS: skip frame if minimum interval hasn't elapsed.
        // Use a 0.5ms tolerance to account for RAF timing jitter.
        const frameBudgetMs = 1000 / this.targetFPS;
        if (now - this._lastFrameTime < frameBudgetMs - 0.5) {
          if (this._state === "running") this._rafHandle = this._scheduleFrame(loop);
          return;
        }

        const rawSeconds = (now - this._lastFrameTime) / 1000;
        this._recordRawFrameTime(rawSeconds);
        const dt = Math.min(rawSeconds, this.maxDeltaSeconds) * clamp(this.timeScale, 0, 100);
        this._lastFrameTime = now;
        this._deltaTime = dt;
        try {
          await this._runFrame(dt);
        } catch (err) {
          this._handleFrameLoopError(err);
        } finally {
          if (this._state === "running") this._rafHandle = this._scheduleFrame(loop);
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
    const from = this._state;
    if (from === "stopped" || from === "stopping") return;
    if (from === "starting") throw new GwenEngineStateError(from, "stop");
    // Claim before the first hook runs: a stop() from inside teardown must see it.
    this._teardownOnce = true;
    if (from !== "faulted") await this._transition("stopping", "USER");
    await this._teardown();
    if (this._state === "stopping") await this._transition("stopped", "USER");
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
    clearIsolated(this);

    // Per-engine module handles only. The glue cache is shared by variant:
    // another live engine may still need those keys.
    this._wasmModules.clear();

    this.disposables.disposeAll(); // LIFO — last registered, first disposed
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
      if (this._state !== "starting") return;
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
        context: { frame: this._frameCountOwn, hook },
      });
      throw err;
    }
    if (this._state !== "starting") return;
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
    const state = this._state;
    if (state !== "idle") throw new GwenEngineStateError(state, "startExternal");
    this._attachErrorPolicy();
    await this._beginStart();
    // Intentionally skip RAF — the caller drives the loop via advance().
  }

  async advance(dt: number): Promise<void> {
    if (this._state !== "idle" && this._state !== "running") {
      throw new GwenEngineStateError(this._state, "advance");
    }
    if (this._advancing) {
      throw new GwenError(
        CoreErrorCodes.ADVANCE_REENTRANT,
        "[GwenEngine] advance() called re-entrantly — only one advance per frame.",
      );
    }
    this._advancing = true;
    this._recordRawFrameTime(dt);
    // Cap dt at maxDeltaSeconds to prevent spiral-of-death after tab suspension.
    const cappedDt = Math.min(dt, this.maxDeltaSeconds) * clamp(this.timeScale, 0, 100);
    this._deltaTime = cappedDt;
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
  async loadWasmModule<Exports extends WebAssembly.Exports = WebAssembly.Exports>(
    options: WasmModuleOptions<Exports>,
  ): Promise<WasmModuleHandle<Exports>> {
    this._assertNotFaulted("loadWasmModule");
    // Deduplication — same name returns existing handle without re-fetching.
    const existing = this._wasmModules.get(options.name);
    if (existing) {
      return existing.handle as WasmModuleHandle<Exports>;
    }

    const declared = this._declaredTransformRegion(options);
    let modulePtr = declared !== null && declared.byteOffset !== 0 ? declared.byteOffset : 0;
    const builtImports = buildTransformImports(
      modulePtr,
      /* stride */ TRANSFORM_STRIDE,
      /* maxEntities */ this.maxEntities,
    );
    const gwenImports = {
      transform_buffer_ptr: () => modulePtr,
      transform_stride: builtImports.transform_stride,
      max_entities: builtImports.max_entities,
    };

    let wasmModule: WebAssembly.Module;
    let probeOffset: number | undefined;
    try {
      const response = await fetch(
        options.url instanceof URL ? options.url.toString() : options.url,
      );
      if (!response.ok) {
        throw new GwenError(
          CoreErrorCodes.WASM_LOAD_ERROR,
          `[GWEN] loadWasmModule("${options.name}"): fetch failed with status ${response.status} ${response.statusText}.`,
        );
      }
      const buffer = await response.arrayBuffer();
      wasmModule = await WebAssembly.compile(buffer);
      if (declared) {
        const exportName = `gwen_${declared.name}_ptr`;
        const hasPtrExport = WebAssembly.Module.exports(wasmModule).some(
          (item) => item.name === exportName && item.kind === "function",
        );
        if (hasPtrExport) {
          const probe = await WebAssembly.instantiate(wasmModule, { gwen: gwenImports });
          probeOffset = this._resolveTransformOffset(probe.exports, declared);
          // The real start() reads modulePtr, so publish the probe offset first.
          modulePtr = probeOffset;
        }
      }
    } catch (err) {
      throw new GwenError(
        CoreErrorCodes.WASM_LOAD_ERROR,
        `[GWEN] loadWasmModule("${options.name}"): failed to load WASM module from "${options.url}". ` +
          `Cause: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    let instance: WebAssembly.Instance;
    try {
      instance = await WebAssembly.instantiate(wasmModule, { gwen: gwenImports });
    } catch (err) {
      throw new GwenError(
        CoreErrorCodes.WASM_LOAD_ERROR,
        `[GWEN] loadWasmModule("${options.name}"): failed to load WASM module from "${options.url}". ` +
          `Cause: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Plugin API version (#92) before any resolved-region check.
    void checkPluginApiVersion(
      instance.exports,
      options.name,
      options.expectedVersion,
      options.versionPolicy,
    );

    const memory =
      instance.exports["memory"] instanceof WebAssembly.Memory
        ? instance.exports["memory"]
        : undefined;

    let transformCopy: WasmModuleTransformCopy | null = null;
    if (declared) {
      const resolved = this._resolveTransformOffset(instance.exports, declared);
      if (probeOffset !== undefined && resolved !== probeOffset) {
        throw this._regionInvalid(
          options.name,
          declared.name,
          `probe offset ${probeOffset} differs from the instance offset ${resolved}`,
        );
      }
      modulePtr = resolved;
      this._validateResolvedRegion(options.name, declared, modulePtr, memory);
      transformCopy = { offset: modulePtr, bytes: null };
      this._getOrCreateTransformPtr();
    }

    // Build region and channel maps from options.
    const regionMap = new Map((options.memory?.regions ?? []).map((r) => [r.name, r]));
    const channelMap = new Map(
      (options.channels ?? []).map((c) => {
        if (!memory) {
          throw new GwenError(
            CoreErrorCodes.WASM_MODULE_NO_MEMORY,
            `[GWEN] loadWasmModule("${options.name}"): channel '${c.name}' declared but ` +
              `the WASM binary does not export "memory". ` +
              `Add "(export \\"memory\\" (memory ...))" to your WASM module.`,
          );
        }
        return [c.name, new WasmRingBuffer(memory, c, instance.exports)];
      }),
    );

    const handle: WasmModuleHandle<Exports> = {
      name: options.name,
      exports: instance.exports as Exports,
      memory,
      region(regionName: string): WasmRegionView {
        const def = regionMap.get(regionName);
        if (!def) {
          throw new GwenError(
            CoreErrorCodes.WASM_REGION_NOT_FOUND,
            `[GWEN] WASM region '${regionName}' not found in module '${options.name}'. ` +
              `Declare it in WasmModuleOptions.memory.regions.`,
          );
        }
        if (!memory) {
          throw new GwenError(
            CoreErrorCodes.WASM_MODULE_NO_MEMORY,
            `[GWEN] WASM module '${options.name}' does not export memory — cannot create region view.`,
          );
        }
        return new WasmRegionView(memory, def);
      },
      channel(channelName: string): WasmRingBuffer {
        const ch = channelMap.get(channelName);
        if (!ch) {
          throw new GwenError(
            CoreErrorCodes.WASM_CHANNEL_NOT_FOUND,
            `[GWEN] WASM channel '${channelName}' not found in module '${options.name}'. ` +
              `Declare it in WasmModuleOptions.channels.`,
          );
        }
        return ch;
      },
    };

    const stored: WasmModuleEntry = {
      handle: handle as WasmModuleHandle<WebAssembly.Exports>,
      transformCopy,
    };
    if (options.step !== undefined) {
      // Cast through unknown to satisfy the Map's invariant generic type.
      stored.step = options.step as (
        handle: WasmModuleHandle<WebAssembly.Exports>,
        dt: number,
      ) => void;
    }
    this._wasmModules.set(options.name, stored);

    return handle;
  }

  /**
   * Retrieve a previously loaded WASM module handle by name.
   *
   * @param name - The name supplied to {@link loadWasmModule}.
   * @returns The typed {@link WasmModuleHandle}.
   * @throws {GwenError} If no module has been loaded under `name`.
   */
  getWasmModule<K extends keyof GwenWasmModules>(name: K): WasmModuleHandle<GwenWasmModules[K]> {
    const entry = this._wasmModules.get(name);
    if (!entry) {
      throw new GwenError(
        CoreErrorCodes.WASM_MODULE_NOT_FOUND,
        `[GWEN] getWasmModule("${String(name)}"): no WASM module loaded under that name. ` +
          `Call engine.loadWasmModule({ name: "${String(name)}", url: ... }) first.`,
      );
    }
    return entry.handle as WasmModuleHandle<GwenWasmModules[K]>;
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
    const message = error instanceof Error ? error.message : String(error);
    this.errors.emit({
      level: "error",
      code: CoreErrorCodes.PLUGIN_RUNTIME_ERROR,
      message,
      source: "entity:destroy",
      error,
      context: { entityId: id },
    });
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
    return this._deltaTime;
  }
  /** Uncapped, unscaled wall-frame duration in seconds. */
  get rawFrameTime(): number {
    return this._rawFrameTime;
  }
  /** Frame counter — increments by 1 for each completed `_runFrame` call. */
  get frameCount(): number {
    return this._frameCountOwn;
  }
  /** Smoothed frames per second from the raw wall-frame duration, not the scaled simulation dt. */
  getFPS(): number {
    return this._fps;
  }
  getStats(): EngineStats {
    const budgetMs = 1000 / this.targetFPS;
    const wasmMemoryBytes = this._wasmByteLength();
    const stats: EngineStats = {
      fps: this._fps,
      rawFrameTime: this._rawFrameTime,
      deltaTime: this._deltaTime,
      frameCount: this._frameCountOwn,
      entityCount: this._entities.count(),
      budgetMs,
    };
    if (wasmMemoryBytes !== undefined) stats.wasmMemoryBytes = wasmMemoryBytes;
    const showPhases = __GWEN_DEV__ && this.debug;
    const phaseMs = this._lastPhaseMs;
    if (showPhases && phaseMs !== undefined) {
      stats.phaseMs = { ...phaseMs };
      stats.overBudget = phaseMs.total > budgetMs;
    }
    return stats;
  }

  /** Linear-memory size, read only when stats are requested. Omitted when absent. */
  private _wasmByteLength(): number | undefined {
    const readMemory = this._bridge.getLinearMemory;
    if (typeof readMemory !== "function") return undefined;
    const memory = readMemory.call(this._bridge);
    if (memory === null) return undefined;
    return memory.buffer.byteLength;
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

  // ─── Shared memory transform pointer accessor ────────────────────────────

  private _declaredTransformRegion(options: {
    name: string;
    transformRegion?: string;
    memory?: { regions: readonly WasmMemoryRegion[] };
  }): WasmMemoryRegion | null {
    const regionName = options.transformRegion;
    if (regionName === undefined) return null;
    const found = options.memory?.regions.find((region) => region.name === regionName);
    if (!found) {
      throw this._regionInvalid(options.name, regionName, "unknown region name");
    }
    const required = this.maxEntities * TRANSFORM_STRIDE;
    if (found.byteLength < required) {
      throw new GwenError(
        CoreErrorCodes.WASM_MODULE_REGION_TOO_SMALL,
        `[GWEN] loadWasmModule("${options.name}"): transform region "${regionName}" is ${found.byteLength} bytes; ${required} bytes are required.`,
      );
    }
    if (found.byteOffset !== 0 && (found.byteOffset % 4 !== 0 || found.byteOffset < 0)) {
      throw this._regionInvalid(
        options.name,
        regionName,
        `offset ${found.byteOffset} is not a positive multiple of 4`,
      );
    }
    return found;
  }

  private _regionInvalid(moduleName: string, regionName: string, reason: string): GwenError {
    return new GwenError(
      CoreErrorCodes.WASM_MODULE_REGION_INVALID,
      `[GWEN] loadWasmModule("${moduleName}"): transform region "${regionName}" is invalid: ${reason}.`,
    );
  }

  private _resolveTransformOffset(exports: WebAssembly.Exports, region: WasmMemoryRegion): number {
    const exported = exports[`gwen_${region.name}_ptr`];
    if (typeof exported === "function") {
      const value: unknown = (exported as () => unknown)();
      if (typeof value === "number" && Number.isFinite(value)) return value;
      return 0;
    }
    return region.byteOffset;
  }

  private _validateResolvedRegion(
    moduleName: string,
    region: WasmMemoryRegion,
    offset: number,
    memory: WebAssembly.Memory | undefined,
  ): void {
    if (!(offset > 0) || offset % 4 !== 0) {
      throw this._regionInvalid(
        moduleName,
        region.name,
        `offset ${offset} must be a positive multiple of 4`,
      );
    }
    if (!(memory instanceof WebAssembly.Memory)) {
      throw this._regionInvalid(moduleName, region.name, "the module does not export memory");
    }
    const end = offset + region.byteLength;
    if (end > memory.buffer.byteLength) {
      throw this._regionInvalid(
        moduleName,
        region.name,
        `region ends at ${end}, past memory of ${memory.buffer.byteLength} bytes`,
      );
    }
  }

  /** @returns true when the fill trapped. Copies are skipped either way. */
  private _reportTransformFill(err: unknown): boolean {
    const isTrap = err instanceof WebAssembly.RuntimeError || err instanceof GwenWasmPanicError;
    if (isTrap) {
      const message = err instanceof Error ? err.message : String(err);
      this._reportCaught(err, "sync_transforms_to_buffer", {
        level: "fatal",
        source: "gwen_core.wasm",
        code: CoreErrorCodes.WASM_PANIC,
        message,
      });
      return true;
    }
    const code = err instanceof GwenWasmError ? err.code : CoreErrorCodes.FRAME_LOOP_ERROR;
    const message = err instanceof Error ? err.message : String(err);
    this._publish({
      level: "error",
      code,
      message,
      source: "gwen_core.wasm",
      error: err,
      context: { frame: this._frameCountOwn, hook: "sync_transforms_to_buffer" },
    });
    return false;
  }

  private _copyTransformRegion(entry: WasmModuleEntry): void {
    const copy = entry.transformCopy;
    const memory = entry.handle.memory;
    const view = this._transformView;
    if (!copy || !memory || !view) return;
    const length = this.maxEntities * TRANSFORM_STRIDE;
    let dest = copy.bytes;
    if (!dest || dest.byteLength === 0) {
      dest = new Uint8Array(memory.buffer, copy.offset, length);
      copy.bytes = dest;
    }
    dest.set(view.array);
  }

  private _runWasmModules(dt: number): void {
    let needsFill = false;
    for (const [name, entry] of this._wasmModules) {
      if (entry.transformCopy && !isIsolated(this, `wasm:${name}`)) {
        needsFill = true;
        break;
      }
    }
    let skipCopies = false;
    let fillTrapped = false;
    if (needsFill) {
      try {
        const ptr = this._getOrCreateTransformPtr();
        this._bridge.syncTransformsToBuffer(ptr, this.maxEntities);
      } catch (err: unknown) {
        fillTrapped = this._reportTransformFill(err);
        skipCopies = true;
      }
    }
    if (fillTrapped || this._state === "faulted") return;
    for (const [name, entry] of this._wasmModules) {
      if (isIsolated(this, `wasm:${name}`)) continue;
      try {
        if (entry.transformCopy && !skipCopies) this._copyTransformRegion(entry);
        entry.step?.(entry.handle, dt);
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        const isWasmPanic =
          err instanceof WebAssembly.RuntimeError || err instanceof GwenWasmPanicError;
        this._reportCaught(err, "wasm", {
          source: `wasm:${name}`,
          message: `WASM module "${name}" step failed: ${detail}`,
          target: { kind: "wasm-module", id: `wasm:${name}`, name },
          code: isWasmPanic ? CoreErrorCodes.WASM_PANIC : CoreErrorCodes.FRAME_LOOP_ERROR,
        });
      }
    }
  }

  /**
   * Core buffer filled once per frame before the host copies it into module regions.
   * The address stays in this engine. Community modules never receive it.
   *
   * @throws {GwenError} `CORE:WASM_NOT_INITIALIZED` when the WASM bridge is not active.
   * @internal
   */
  private _getOrCreateTransformPtr(): number {
    const bridge = this._bridge;
    if (!bridge.isActive()) {
      throw new GwenError(
        CoreErrorCodes.WASM_NOT_INITIALIZED,
        "[GWEN] loadWasmModule() was called before WASM bridge initialisation. " +
          "Await bridge.init() (or setupGwen()) before loading community WASM modules.",
      );
    }
    if (!this._sharedMemory) {
      this._sharedMemory = SharedMemoryManager.create(bridge, this.maxEntities);
      this.disposables.add(
        "wasm:shared-memory",
        createDisposable(() => {
          this._sharedMemory?.dispose(this._bridge);
          this._sharedMemory = null;
        }),
      );
    }
    if (!this._transformView && this._sharedMemory) {
      const byteLength = this.maxEntities * TRANSFORM_STRIDE;
      const ptr = this._sharedMemory.transformBufferPtr;
      this._transformView = this._memory.view({
        name: "core:module-transforms",
        type: "u8",
        ptr: () => ptr,
        length: () => byteLength,
      });
      this.disposables.add(
        "wasm:module-transforms",
        createDisposable(() => {
          this._transformView?.dispose();
          this._transformView = null;
        }),
      );
    }
    return this._sharedMemory.transformBufferPtr;
  }

  // ─── 8-phase frame runner ─────────────────────────────────────────────────

  private _logHandlerFailed(error: unknown): void {
    const detail = error instanceof Error ? error.message : String(error);
    this.logger.error(`[${CoreErrorCodes.ERROR_HANDLER_FAILED}] ${detail}`, {
      code: CoreErrorCodes.ERROR_HANDLER_FAILED,
    });
  }

  private _catchAsync(result: unknown): void {
    if (!isThenable(result)) return;
    void Promise.resolve(result).catch((error: unknown) => this._logHandlerFailed(error));
  }

  private _emit(event: BusErrorPayload): void {
    try {
      this._errorBus.emit(event);
    } catch (error) {
      this._logHandlerFailed(error);
    }
  }

  /** Isolation and the fatal transition. Runs even when a custom bus does not call `on`. */
  private _publish(event: BusErrorPayload): void {
    this._noteIsolation(event);
    if (event.level === "fatal") {
      this._enterFaulted(event.code === CoreErrorCodes.WASM_PANIC ? "WASM_PANIC" : "FATAL_ERROR");
    }
    this._emit(event);
  }

  private _noteIsolation(event: BusErrorPayload): void {
    if (event.level !== "error" || !event.target || event.context?.phase === "setup") return;
    if (!isolateTarget(this, event.target)) return;
    // DEV+DEBUG advice. Production builds omit it even when debug is true.
    if (__GWEN_DEV__ && this.debug) {
      const hook = typeof event.context?.hook === "string" ? event.context.hook : "unknown";
      this.logger.warn(
        `[GWEN] ${event.target.kind} "${event.target.name}" isolated after ${event.code} in ${hook}; skipped until engine.reenable("${event.target.id}").`,
      );
    }
  }

  private _attachErrorPolicy(): void {
    const bus = this._errorBus;
    if (!this._errorOnAttached) {
      const unsubscribe = bus.on((event) => {
        this._applyBusEvent(event);
      });
      this._errorOnAttached = true;
      if (typeof unsubscribe === "function") {
        this.disposables.add(
          "errors:on",
          createDisposable(() => {
            this._errorOnAttached = false;
            unsubscribe();
          }),
        );
      }
    }
    if (!this._errorFatalAttached) {
      const unsubscribeFatal = bus.onFatal(() => {
        this._enterFaulted("FATAL_ERROR");
      });
      this._errorFatalAttached = true;
      if (typeof unsubscribeFatal === "function") {
        this.disposables.add(
          "errors:onFatal",
          createDisposable(() => {
            this._errorFatalAttached = false;
            unsubscribeFatal();
          }),
        );
      }
    }
    if (!this._errorInstallAttached) {
      const uninstall = bus.install?.();
      if (typeof uninstall === "function") {
        this._errorInstallAttached = true;
        this.disposables.add(
          "errors:install",
          createDisposable(() => {
            this._errorInstallAttached = false;
            uninstall();
          }),
        );
      }
    }
    this._bridgeErrorEmit();
  }

  /**
   * `engine:error` runs after every `on` handler.
   * `stop()` drops the wrapper when this engine still owns `emit`.
   * A bus whose `emit` cannot be replaced fires the hook from `on` instead.
   */
  private _bridgeErrorEmit(): void {
    if (this._emitBridgeActive || this._engineErrorFromOn) return;
    const errorBus = this._errorBus;
    const previous = errorBus.emit;
    let active = true;
    const wrapped = (event: BusErrorPayload): void => {
      if (!active) {
        if (errorBus.emit === wrapped) errorBus.emit = previous;
        previous.call(errorBus, event);
        return;
      }
      try {
        previous.call(errorBus, event);
      } catch (error) {
        this._logHandlerFailed(error);
        return;
      }
      if (event.level === "error" || event.level === "fatal") {
        this._fireEngineErrorHook(event);
      }
    };
    try {
      errorBus.emit = wrapped;
    } catch {
      this._engineErrorFromOn = true;
      return;
    }
    if (errorBus.emit !== wrapped) {
      this._engineErrorFromOn = true;
      return;
    }
    this._emitBridgeActive = true;
    this.disposables.add(
      "errors:emit",
      createDisposable(() => {
        this._emitBridgeActive = false;
        active = false;
        if (errorBus.emit === wrapped) errorBus.emit = previous;
      }),
    );
  }

  private _applyBusEvent(event: BusErrorPayload): void {
    switch (event.level) {
      case "verbose":
        this.logger.debug(event.message, { code: event.code });
        break;
      case "info":
        this.logger.info(event.message, { code: event.code });
        break;
      case "warning":
        this.logger.warn(event.message, { code: event.code });
        break;
      case "error":
      case "fatal":
        this.logger.error(event.message, { code: event.code });
        break;
      default:
        break;
    }
    this._noteIsolation(event);
    if (this._engineErrorFromOn) this._fireEngineErrorHook(event);
  }

  private _fireEngineErrorHook(event: BusErrorPayload): void {
    if (event.level !== "error" && event.level !== "fatal") return;
    const frame =
      typeof event.context?.frame === "number" ? event.context.frame : this._frameCountOwn;
    const payload: EngineErrorPayload = {
      level: event.level,
      code: event.code,
      message: event.message,
      cause: event.error,
      frame,
      ...(event.source !== undefined ? { source: event.source } : {}),
      ...(event.target !== undefined ? { target: event.target } : {}),
    };
    try {
      const result: unknown = this.hooks.callHook("engine:error", payload);
      this._catchAsync(result);
    } catch (error) {
      this._logHandlerFailed(error);
    }
  }

  private _firePluginError(
    pluginName: string,
    phase: PluginErrorContext["phase"],
    error: unknown,
    hook?: string,
  ): void {
    try {
      const result: unknown = this.hooks.callHook("plugin:error", {
        pluginName,
        phase,
        error,
        frame: this._frameCountOwn,
        ...(hook !== undefined ? { hook } : {}),
      });
      this._catchAsync(result);
    } catch (handlerError) {
      this._logHandlerFailed(handlerError);
    }
  }

  private _pluginForTarget(target: GwenErrorTarget): GwenPlugin | undefined {
    if (target.kind === "plugin") {
      return this._pluginRegistry.pluginNamed(target.id);
    }
    if (target.kind === "system") {
      return this._pluginRegistry.pluginNamed(target.name);
    }
    return undefined;
  }

  private _consultRecover(
    plugin: GwenPlugin,
    err: unknown,
    phase: PluginErrorContext["phase"],
    hook?: string,
  ): boolean {
    if (!plugin.onError) return false;
    let recovered = false;
    try {
      plugin.onError(err, {
        phase,
        ...(hook !== undefined ? { hook } : {}),
        frame: this._frameCountOwn,
        recover() {
          recovered = true;
        },
      });
    } catch (handlerError) {
      this._logHandlerFailed(handlerError);
    }
    return recovered;
  }

  private _dropPluginIsolation(name: string): void {
    forgetTarget(this, name);
    for (const target of listIsolated(this)) {
      if (target.id === name || target.name === name) forgetTarget(this, target.id);
    }
  }

  private _reportSetupError(plugin: GwenPlugin, err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    const isTrap = err instanceof WebAssembly.RuntimeError;
    if (!isTrap && this._consultRecover(plugin, err, "setup")) return;
    this._publish({
      level: "error",
      code: isTrap ? CoreErrorCodes.WASM_PANIC : CoreErrorCodes.PLUGIN_SETUP_ERROR,
      message: `[${plugin.name}] setup failed: ${message}`,
      source: plugin.name,
      error: err,
      target: { kind: "plugin", id: plugin.name, name: plugin.name },
      context: { frame: this._frameCountOwn, phase: "setup", hook: "setup" },
    });
  }

  private _reportTeardown(plugin: GwenPlugin, err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    const isTrap = err instanceof WebAssembly.RuntimeError;
    if (!isTrap && this._consultRecover(plugin, err, "teardown")) return;
    const target: GwenErrorTarget = { kind: "plugin", id: plugin.name, name: plugin.name };
    this._publish({
      level: isTrap ? "fatal" : "error",
      code: isTrap ? CoreErrorCodes.WASM_PANIC : CoreErrorCodes.PLUGIN_RUNTIME_ERROR,
      message: `[${plugin.name}] teardown threw: ${message}`,
      source: plugin.name,
      error: err,
      target,
      context: { frame: this._frameCountOwn, phase: "teardown", hook: "teardown" },
    });
    if (!isTrap) this._firePluginError(plugin.name, "teardown", err, "teardown");
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
    if (forced === undefined && err instanceof WebAssembly.RuntimeError) {
      poisonWasmBridge(this._bridge, err);
    }
    if (
      err instanceof GwenWasmPanicError &&
      err.exportName === undefined &&
      this._wasmPanicPublished
    ) {
      return;
    }
    const message = forced?.message ?? (err instanceof Error ? err.message : String(err));
    const isTrap = err instanceof WebAssembly.RuntimeError || err instanceof GwenWasmPanicError;
    const target = forced?.target;
    const frame = this._frameCountOwn;

    if (forced?.target?.kind === "wasm-module") {
      this._publish({
        level: "error",
        code: isTrap ? CoreErrorCodes.WASM_PANIC : (forced.code ?? CoreErrorCodes.FRAME_LOOP_ERROR),
        message,
        ...(forced.source !== undefined ? { source: forced.source } : {}),
        error: err,
        target: forced.target,
        context: { frame, hook },
      });
      return;
    }

    if (isTrap || forced?.level === "fatal") {
      if (isTrap) this._wasmPanicPublished = true;
      this._publish({
        level: "fatal",
        code: isTrap
          ? CoreErrorCodes.WASM_PANIC
          : (forced?.code ?? CoreErrorCodes.FRAME_LOOP_ERROR),
        message,
        source:
          forced?.source ?? (err instanceof GwenWasmPanicError ? "gwen_core.wasm" : "@gwenjs/core"),
        error: err,
        ...(target !== undefined ? { target } : {}),
        context: { frame, hook },
      });
      return;
    }

    if (target) {
      const phase = phaseForHook(hook);
      const plugin = this._pluginForTarget(target);
      if (plugin && this._consultRecover(plugin, err, phase, hook)) return;
      const source = target.name;
      this._publish({
        level: "error",
        code: CoreErrorCodes.PLUGIN_RUNTIME_ERROR,
        message: `[${source}] ${phase} threw: ${message}`,
        source,
        error: err,
        target,
        context: { frame, hook, phase },
      });
      if (target.kind === "plugin" || target.kind === "system") {
        const pluginName = target.kind === "plugin" ? target.id : target.name;
        this._firePluginError(pluginName, phase, err, hook);
      }
      return;
    }

    this._publish({
      level: "error",
      code: forced?.code ?? CoreErrorCodes.FRAME_LOOP_ERROR,
      message,
      source: forced?.source ?? "@gwenjs/core",
      error: err,
      context: { frame, hook },
    });
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

  private _recordRawFrameTime(rawSeconds: number): void {
    this._rawFrameTime = rawSeconds;
    if (!(rawSeconds > 0)) return;
    const sample = 1 / rawSeconds;
    if (!this._hasFpsSample) {
      this._fps = sample;
      this._hasFpsSample = true;
      return;
    }
    const alpha = 1 - Math.exp(-rawSeconds / 0.5);
    this._fps = alpha * sample + (1 - alpha) * this._fps;
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
    const frame = this._frameCountOwn;
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
    const message = error instanceof Error ? error.message : String(error);
    this._errorBus.emit({
      level: "error",
      code: CoreErrorCodes.PLUGIN_RUNTIME_ERROR,
      message: `[engine:memory-grow] ${message}`,
      source: "engine:memory-grow",
      error,
      context: { frame },
    });
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
      this._runWasmModules(dt);
      if (instrument) t5 = performance.now();

      // Memory sentinel — dev+debug only, and only when a SharedMemoryManager is active.
      if (instrument && this._sharedMemory) {
        try {
          this._sharedMemory.checkSentinels(this._bridge);
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err);
          this._reportCaught(err, "sentinel", {
            code: CoreErrorCodes.FRAME_LOOP_ERROR,
            message: `WASM memory sentinel violation: ${detail}`,
          });
        }
      }

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
      this._frameCountOwn++;
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
            frame: this._frameCountOwn,
          });
        }
        if (plugins > budget * 0.5) {
          this.logger.warn(`phase "plugins" exceeded 50% of frame budget`, {
            phase: "plugins",
            ms: plugins.toFixed(2),
            budgetMs: budget.toFixed(2),
            frame: this._frameCountOwn,
          });
        }
        if (wasm > budget * 0.5) {
          this.logger.warn(`phase "wasm" exceeded 50% of frame budget`, {
            phase: "wasm",
            ms: wasm.toFixed(2),
            budgetMs: budget.toFixed(2),
            frame: this._frameCountOwn,
          });
        }
        if (update > budget * 0.5) {
          this.logger.warn(`phase "update" exceeded 50% of frame budget`, {
            phase: "update",
            ms: update.toFixed(2),
            budgetMs: budget.toFixed(2),
            frame: this._frameCountOwn,
          });
        }
        if (render > budget * 0.5) {
          this.logger.warn(`phase "render" exceeded 50% of frame budget`, {
            phase: "render",
            ms: render.toFixed(2),
            budgetMs: budget.toFixed(2),
            frame: this._frameCountOwn,
          });
        }
        if (afterTick > budget * 0.5) {
          this.logger.warn(`phase "afterTick" exceeded 50% of frame budget`, {
            phase: "afterTick",
            ms: afterTick.toFixed(2),
            budgetMs: budget.toFixed(2),
            frame: this._frameCountOwn,
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
