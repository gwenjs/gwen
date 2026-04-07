/**
 * @file RFC-001 / RFC-008 — GwenEngine interface & createEngine() factory
 *
 * Provides the new `createEngine(options?) → Promise<GwenEngine>` API
 * described in RFC-001. Internally delegates to the existing `Engine` class
 * so no existing behaviour is changed.
 *
 * RFC-008 adds: 8-phase frame loop, `WasmModuleHandle`, `loadWasmModule`,
 * `getWasmModule`, and `startExternal` for external-loop integration.
 *
 * ⚠️  INTENTIONAL CO-LOCATION — Do not split the implementation.
 * V8 inlines calls between functions in the same compilation unit.
 * A previous refactor attempt that split this file caused a measurable perf
 * regression on the hot path (frame loop + plugin dispatch at ~1000 entities/frame).
 * Keep all engine implementation code co-located so the JIT can inline across
 * method boundaries. Type-only definitions (interfaces, error classes) have been
 * extracted to engine-types.ts and engine-errors.ts since they are erased at
 * compile time and have no impact on V8 inlining.
 *
 * NAVIGATION (use IDE region folding — Ctrl+Shift+[ / Cmd+Shift+[):
 *   engine-errors.ts                            — error classes & codes
 *   engine-types.ts                             — all public type contracts
 *   #region Internal helpers                    — ScopedHooksTracker
 *   #region Engine implementation               — GwenEngineImpl (frame loop, plugins, DI)
 *   #region Factory                             — createEngine()
 */

import { createHooks, type Hookable } from 'hookable';
import type { GwenRuntimeHooks, EngineErrorPayload } from './runtime-hooks.js';
import { engineContext } from '../context.js';
import { withCleanup } from '../cleanup-context.js';
import { createLogger } from '../logger/index';
import type { GwenLogger } from '../logger/index';
import { WasmRegionView, WasmRingBuffer } from './wasm-module-handle.js';
import { EntityManager, ComponentRegistry, QueryEngine } from '../core/ecs.js';
import { getWasmBridge } from './wasm-bridge.js';
import type { EntityId } from './engine-api.js';
import type { ComponentDefinition, ComponentSchema, InferComponent } from '../schema.js';
import type { ComponentDef, LiveQuery, EntityAccessor } from '../system.js';
import { buildTransformImports } from '../wasm/transform-imports.js';
import { SharedMemoryManager, TRANSFORM_STRIDE } from '../wasm/shared-memory.js';
import { validateEngineConfig } from './engine-config-validator.js';
import type { TweenPoolPolicy } from '../tween/tween-pool.js';

// ─── Re-exports from extracted type modules ─────────────────────────────────
// All public types were in this file before extraction. Re-export them so
// existing `import { ... } from './gwen-engine.js'` statements keep working.

export {
  GwenPluginNotFoundError,
  CoreErrorCodes,
} from './engine-errors.js';
export type {
  GwenPluginNotFoundErrorOptions,
  PluginErrorContext,
} from './engine-errors.js';

export {
  GWEN_PLUGIN_API_VERSION,
  checkPluginApiVersion,
} from './engine-types.js';
export type {
  WasmModuleOptions,
  WasmModuleHandle,
  PlacementBridge,
  EngineErrorBus,
  GwenEngineOptions,
  GwenProvides,
  GwenPlugin,
  EngineFramePhaseMs,
  EngineStats,
  GwenEngine,
} from './engine-types.js';

export type {
  WasmMemoryRegion,
  WasmMemoryOptions,
  WasmChannelOptions,
} from './wasm-module-handle.js';
export { WasmRegionView, WasmRingBuffer } from './wasm-module-handle.js';
export type { EngineErrorPayload } from './runtime-hooks.js';

// ─── Imports from extracted modules (used by implementation below) ──────────

import {
  GwenPluginNotFoundError,
  CoreErrorCodes,
} from './engine-errors.js';
import type { PluginErrorContext } from './engine-errors.js';

import {
  GWEN_PLUGIN_API_VERSION,
  checkPluginApiVersion,
} from './engine-types.js';
import type {
  WasmModuleOptions,
  WasmModuleHandle,
  PlacementBridge,
  EngineErrorBus,
  GwenEngineOptions,
  GwenProvides,
  GwenPlugin,
  EngineFramePhaseMs,
  EngineStats,
  GwenEngine,
} from './engine-types.js';

// #region Internal helpers

/**
 * Scoped hooks tracker — records (event, fn) pairs per plugin so they can be
 * bulk-removed when a plugin is unregistered.
 * @internal
 */
class ScopedHooksTracker {
  private _map = new Map<string, Array<{ event: string; fn: (...args: unknown[]) => unknown }>>();

  track(pluginName: string, event: string, fn: (...args: unknown[]) => unknown): void {
    if (!this._map.has(pluginName)) this._map.set(pluginName, []);
    this._map.get(pluginName)!.push({ event, fn });
  }

  removeAll(pluginName: string, hooks: Hookable<GwenRuntimeHooks>): void {
    const entries = this._map.get(pluginName);
    if (!entries) return;
    for (const { event, fn } of entries) {
      hooks.removeHook(event as keyof GwenRuntimeHooks, fn as never);
    }
    this._map.delete(pluginName);
  }

  clearAll(hooks: Hookable<GwenRuntimeHooks>): void {
    for (const pluginName of this._map.keys()) {
      this.removeAll(pluginName, hooks);
    }
  }
}

// #endregion

// #region Engine implementation

class GwenEngineImpl implements GwenEngine {
  // ─── Config ──────────────────────────────────────────────────────────────
  readonly maxEntities: number;
  readonly targetFPS: number;
  readonly maxDeltaSeconds: number;
  readonly variant: 'light' | 'physics2d' | 'physics3d';
  readonly debug: boolean;
  readonly tweenPoolSize: number;
  readonly tweenPoolPolicy: TweenPoolPolicy;
  readonly logger: GwenLogger;

  // ─── Internal state ───────────────────────────────────────────────────────
  private readonly _plugins: GwenPlugin[] = [];
  private readonly _pluginNames = new Set<string>();
  /** Dispose functions collected by withCleanup() during plugin setup — keyed by plugin name. */
  private readonly _pluginCleanups = new Map<string, () => void>();
  private readonly _services = new Map<string, unknown>();
  private readonly _tracker = new ScopedHooksTracker();
  private _advancing = false;
  private _deltaTime = 0;
  private _running = false;
  private _rafHandle = 0;
  private _lastFrameTime = 0;
  /** Error bus wired at construction time via `GwenEngineOptions.errorBus`. @internal */
  private readonly _errorBus: EngineErrorBus | null = null;

  // ─── WASM module registry (RFC-008) ───────────────────────────────────────
  /**
   * Map of loaded WASM module entries keyed by name.
   * Each entry holds the public handle and the optional per-frame step function.
   * @internal
   */
  private readonly _wasmModules = new Map<
    string,
    {
      handle: WasmModuleHandle<WebAssembly.Exports>;
      step?: (handle: WasmModuleHandle<WebAssembly.Exports>, dt: number) => void;
    }
  >();

  /**
   * Lazily-created shared memory manager for community WASM plugin transform access.
   * Created on first `loadWasmModule()` call. Null until then.
   * @internal
   */
  private _sharedMemory: SharedMemoryManager | null = null;

  // ─── Frame scheduler ─────────────────────────────────────────────────────
  /**
   * Schedule the next animation frame.
   * Uses `requestAnimationFrame` on the main thread; falls back to `setTimeout`
   * in Web Worker contexts where RAF is unavailable.
   */
  private _scheduleFrame(cb: (time: number) => void): number {
    if (typeof requestAnimationFrame !== 'undefined') {
      return requestAnimationFrame(cb);
    }
    // Worker fallback: no visual sync, but keeps the loop running.
    return setTimeout(() => cb(performance.now()), 0) as unknown as number;
  }

  /** Cancel a previously scheduled frame (RAF or setTimeout handle). */
  private _cancelFrame(handle: number): void {
    if (typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(handle);
    } else {
      clearTimeout(handle);
    }
  }

  // ─── Frame stats ─────────────────────────────────────────────────────────
  /**
   * Frame counter driven exclusively by `_runFrame` calls.
   * @internal
   */
  private _frameCountOwn = 0;
  /** Most recent FPS estimate: `1000 / dt` computed after each frame. @internal */
  private _fps = 0;
  /** Per-phase timing for the most recently completed frame. @internal */
  private _lastPhaseMs: EngineFramePhaseMs = {
    tick: 0,
    plugins: 0,
    physics: 0,
    wasm: 0,
    update: 0,
    render: 0,
    afterTick: 0,
    total: 0,
  };

  // ─── Hooks ───────────────────────────────────────────────────────────────
  readonly hooks: Hookable<GwenRuntimeHooks> = createHooks<GwenRuntimeHooks>();

  // ─── WASM bridge stub ─────────────────────────────────────────────────────
  readonly wasmBridge = {
    physics2d: {
      enabled: false,
      enable(_opts: unknown) {
        this.enabled = true;
      },
      disable() {
        this.enabled = false;
      },
      step(_dt: number) {},
    },
    physics3d: {
      enabled: false,
      enable(_opts: unknown) {
        this.enabled = true;
      },
      disable() {
        this.enabled = false;
      },
      step(_dt: number) {},
    },
  };

  // ─── ECS world (RFC-005) ─────────────────────────────────────────────────
  private readonly _entityManager: EntityManager;
  private readonly _componentRegistry: ComponentRegistry;
  private readonly _queryEngine: QueryEngine;

  constructor(opts: GwenEngineOptions) {
    this.maxEntities = opts.maxEntities ?? 10_000;
    this.targetFPS = opts.targetFPS ?? 60;
    this.maxDeltaSeconds = opts.maxDeltaSeconds ?? 0.1;
    this.variant = opts.variant ?? 'light';
    this.debug = opts.debug ?? false;
    this.tweenPoolSize = opts.tweenPoolSize ?? 256;
    this.tweenPoolPolicy = opts.tweenPoolPolicy ?? { onExhausted: 'grow' };
    this.logger = createLogger('gwen:core', this.debug, () => this._frameCountOwn);
    this.provide('logger', this.logger);
    this._entityManager = new EntityManager(this.maxEntities);
    this._componentRegistry = new ComponentRegistry();
    this._queryEngine = new QueryEngine();

    if (opts.errorBus) {
      this._errorBus = opts.errorBus;
      // Register as 'errors' service so plugins can inject it.
      this._services.set('errors', opts.errorBus);
      // Stop the engine gracefully before a fatal error is thrown.
      opts.errorBus.onFatal(() => {
        this.stop().catch(() => {});
      });
      // Install global window.onerror / unhandledrejection in production.
      if (
        typeof globalThis !== 'undefined' &&
        typeof (globalThis as Record<string, unknown>)['window'] !== 'undefined'
      ) {
        opts.errorBus.install?.();
      }
    }
  }

  // ─── Plugin runner ────────────────────────────────────────────────────────

  async use(plugin: GwenPlugin): Promise<void> {
    if (this._pluginNames.has(plugin.name)) return;

    const scopedHooks = this._createScopedHooks(plugin.name);
    const engineWithScopedHooks = this._withScopedHooks(scopedHooks);

    try {
      // Run setup inside engine context so useEngine() resolves to this instance.
      // engineContext.call() saves and restores the previous context (safe for nesting).
      let setupResult: void | Promise<void>;
      const [, dispose] = withCleanup(() => {
        setupResult = engineContext.call(this, () => plugin.setup(engineWithScopedHooks));
      });
      this._pluginCleanups.set(plugin.name, dispose);
      if (setupResult! instanceof Promise) await setupResult!;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this._errorBus?.emit({
        level: 'fatal',
        code: CoreErrorCodes.PLUGIN_SETUP_ERROR,
        message: `[${plugin.name}] setup failed: ${message}`,
        source: plugin.name,
        error: err,
      });
      throw err; // setup failure is fatal — re-throw
    }

    this._plugins.push(plugin);
    this._pluginNames.add(plugin.name);
    await this.hooks.callHook('plugin:registered', plugin.name);
    if (this.debug) {
      this.logger.debug(`plugin registered: ${plugin.name}`);
    }
  }

  async unuse(name: string): Promise<void> {
    const idx = this._plugins.findIndex((p) => p.name === name);
    if (idx === -1) return;

    const plugin = this._plugins[idx]!;
    this._pluginCleanups.get(name)?.();
    this._pluginCleanups.delete(name);
    await plugin.teardown?.();
    this._plugins.splice(idx, 1);
    this._pluginNames.delete(name);
    this._tracker.removeAll(name, this.hooks);
  }

  // ─── Typed provide/inject ─────────────────────────────────────────────────

  provide<K extends keyof GwenProvides>(key: K, value: GwenProvides[K]): void {
    this._services.set(key as string, value);
  }

  inject<K extends keyof GwenProvides>(key: K): GwenProvides[K] {
    if (!this._services.has(key as string)) {
      throw new GwenPluginNotFoundError({
        pluginName: key as string,
        hint: `Call engine.use(${key as string}Plugin()) before using this service.`,
        docsUrl: 'https://gwenengine.dev/docs/plugins',
      });
    }
    return this._services.get(key as string) as GwenProvides[K];
  }

  tryInject<K extends keyof GwenProvides>(key: K): GwenProvides[K] | undefined {
    return this._services.get(key as string) as GwenProvides[K] | undefined;
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
    return engineContext.call(this, fn);
  }

  /**
   * Sets this engine as the globally active context instance.
   * Prefer {@link run} for scoped context management.
   * Use `activate()` / `deactivate()` only when you control the lifecycle manually
   * (e.g., a custom game loop outside `advance()`).
   */
  activate(): void {
    engineContext.set(this, true);
  }

  /**
   * Clears this engine from the active global context.
   * Must be called after {@link activate} when the frame is complete.
   */
  deactivate(): void {
    engineContext.unset();
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    if (this._running) return;
    this._running = true;
    this._lastFrameTime = performance.now();

    await this.hooks.callHook('engine:init');
    await this.hooks.callHook('engine:start');

    // Drive the frame loop via _scheduleFrame (RAF on main thread, setTimeout in Workers).
    const loop = async (now: number) => {
      if (!this._running) return;

      // Throttle to targetFPS: skip frame if minimum interval hasn't elapsed.
      // Use a 0.5ms tolerance to account for RAF timing jitter.
      const frameBudgetMs = 1000 / this.targetFPS;
      if (now - this._lastFrameTime < frameBudgetMs - 0.5) {
        this._rafHandle = this._scheduleFrame(loop);
        return;
      }

      const rawDt = now - this._lastFrameTime;
      const dt = Math.min(rawDt, this.maxDeltaSeconds * 1000);
      this._lastFrameTime = now;
      this._deltaTime = dt;
      try {
        await this._runFrame(dt);
      } catch (err) {
        const payload: EngineErrorPayload = {
          code: CoreErrorCodes.FRAME_LOOP_ERROR,
          message: err instanceof Error ? err.message : String(err),
          cause: err,
          frame: this._frameCountOwn,
        };
        await this.hooks.callHook('engine:error', payload);
        this._errorBus?.emit({
          level: 'error',
          code: CoreErrorCodes.FRAME_LOOP_ERROR,
          message: payload.message,
          source: '@gwenjs/core',
          error: err,
          context: { frame: this._frameCountOwn },
        });
      } finally {
        if (this._running) this._rafHandle = this._scheduleFrame(loop);
      }
    };
    this._rafHandle = this._scheduleFrame(loop);
  }

  async stop(): Promise<void> {
    this._running = false;
    if (this._rafHandle) {
      this._cancelFrame(this._rafHandle);
      this._rafHandle = 0;
    }
    await this.hooks.callHook('engine:stop');
    this._tracker.clearAll(this.hooks);
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
   * engine.advance(16.67)
   * ```
   */
  async startExternal(): Promise<void> {
    this._running = true;
    await this.hooks.callHook('engine:init');
    await this.hooks.callHook('engine:start');
    // Intentionally skip RAF — the caller drives the loop via advance().
  }

  async advance(dt: number): Promise<void> {
    if (this._advancing) {
      throw new Error('[GwenEngine] advance() called re-entrantly — only one advance per frame.');
    }
    this._advancing = true;
    // Cap dt (ms) at maxDeltaSeconds converted to ms to prevent spiral-of-death.
    const cappedDt = Math.min(dt, this.maxDeltaSeconds * 1000);
    this._deltaTime = cappedDt;
    try {
      await this._runFrame(cappedDt);
    } catch (err) {
      const payload: EngineErrorPayload = {
        code: CoreErrorCodes.FRAME_LOOP_ERROR,
        message: err instanceof Error ? err.message : String(err),
        cause: err,
        frame: this._frameCountOwn,
      };
      await this.hooks.callHook('engine:error', payload);
      this._errorBus?.emit({
        level: 'error',
        code: CoreErrorCodes.FRAME_LOOP_ERROR,
        message: payload.message,
        source: '@gwenjs/core',
        error: err,
        context: { frame: this._frameCountOwn },
      });
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
   * @throws {Error} If `fetch` or `WebAssembly.instantiate` fails.
   */
  async loadWasmModule<Exports extends WebAssembly.Exports = WebAssembly.Exports>(
    options: WasmModuleOptions<Exports>,
  ): Promise<WasmModuleHandle<Exports>> {
    // Deduplication — same name returns existing handle without re-fetching.
    const existing = this._wasmModules.get(options.name);
    if (existing) {
      return existing.handle as WasmModuleHandle<Exports>;
    }

    let instance: WebAssembly.Instance;
    try {
      const response = await fetch(
        options.url instanceof URL ? options.url.toString() : options.url,
      );
      if (!response.ok) {
        throw new Error(
          `[GWEN] loadWasmModule("${options.name}"): fetch failed with status ${response.status} ${response.statusText}.`,
        );
      }
      const buffer = await response.arrayBuffer();
      // Lazily create shared memory manager so community plugins can read transform data.
      // Only initialize if the WASM bridge is active.
      const transformPtr = this._getOrCreateTransformPtr();
      // V1: always 2D stride. For 3D support, expose options.stride and thread it through here.
      // Build transform buffer accessors for community plugins (RFC-GAP2 V1)
      const gwenImports = buildTransformImports(
        transformPtr,
        /* stride */ TRANSFORM_STRIDE,
        /* maxEntities */ this.maxEntities,
      );
      const result = await WebAssembly.instantiate(buffer, { gwen: gwenImports });
      instance = result.instance;
    } catch (err) {
      throw new Error(
        `[GWEN] loadWasmModule("${options.name}"): failed to load WASM module from "${options.url}". ` +
          `Cause: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Check plugin API version compatibility if configured
    // Version check: side-effects only (warn/throw). Module loads regardless unless policy='throw'.
    void checkPluginApiVersion(
      instance.exports,
      options.name,
      options.expectedVersion,
      options.versionPolicy,
    );

    const memory =
      instance.exports['memory'] instanceof WebAssembly.Memory
        ? instance.exports['memory']
        : undefined;

    // Build region and channel maps from options.
    const regionMap = new Map((options.memory?.regions ?? []).map((r) => [r.name, r]));
    const channelMap = new Map(
      (options.channels ?? []).map((c) => {
        if (!memory) {
          throw new Error(
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
          throw new Error(
            `[GWEN] WASM region '${regionName}' not found in module '${options.name}'. ` +
              `Declare it in WasmModuleOptions.memory.regions.`,
          );
        }
        if (!memory) {
          throw new Error(
            `[GWEN] WASM module '${options.name}' does not export memory — cannot create region view.`,
          );
        }
        return new WasmRegionView(memory, def);
      },
      channel(channelName: string): WasmRingBuffer {
        const ch = channelMap.get(channelName);
        if (!ch) {
          throw new Error(
            `[GWEN] WASM channel '${channelName}' not found in module '${options.name}'. ` +
              `Declare it in WasmModuleOptions.channels.`,
          );
        }
        return ch;
      },
    };

    this._wasmModules.set(options.name, {
      handle: handle as WasmModuleHandle<WebAssembly.Exports>,
      // Cast through unknown to satisfy the Map's invariant generic type.
      step: options.step as
        | ((handle: WasmModuleHandle<WebAssembly.Exports>, dt: number) => void)
        | undefined,
    });

    return handle;
  }

  /**
   * Retrieve a previously loaded WASM module handle by name.
   *
   * @param name - The name supplied to {@link loadWasmModule}.
   * @returns The typed {@link WasmModuleHandle}.
   * @throws {Error} If no module has been loaded under `name`.
   */
  getWasmModule<Exports extends WebAssembly.Exports = WebAssembly.Exports>(
    name: string,
  ): WasmModuleHandle<Exports> {
    const entry = this._wasmModules.get(name);
    if (!entry) {
      throw new Error(
        `[GWEN] getWasmModule("${name}"): no WASM module loaded under that name. ` +
          `Call engine.loadWasmModule({ name: "${name}", url: ... }) first.`,
      );
    }
    return entry.handle as WasmModuleHandle<Exports>;
  }

  // ─── ECS entity management ────────────────────────────────────────────────

  /**
   * Create a new entity.
   * @returns A fresh {@link EntityId}.
   * @throws {Error} If the entity capacity is exceeded.
   */
  createEntity(): EntityId {
    return this._entityManager.create();
  }

  /**
   * Destroy an entity and remove all its components.
   *
   * @param id - The entity to destroy
   * @returns `true` if it was alive and is now destroyed
   */
  destroyEntity(id: EntityId): boolean {
    if (!this._entityManager.destroy(id)) return false;
    this._componentRegistry.removeAll(id);
    this._queryEngine.invalidate();
    return true;
  }

  /**
   * Check whether an entity is currently alive.
   *
   * @param id - The entity to check
   * @returns `true` if alive
   */
  isAlive(id: EntityId): boolean {
    return this._entityManager.isAlive(id);
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
  addComponent<D extends ComponentDefinition<ComponentSchema>>(
    id: EntityId,
    def: D,
    data: Partial<InferComponent<D>>,
  ): void {
    const merged = { ...def.defaults, ...data } as InferComponent<D>;
    this._componentRegistry.add(id, def, merged);
    this._queryEngine.invalidate();
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
    return this._componentRegistry.get<InferComponent<D>>(id, def);
  }

  /**
   * Check whether an entity has a specific component.
   *
   * @param id - Target entity
   * @param def - Component definition to check
   * @returns `true` if the component is present
   */
  hasComponent<D extends ComponentDefinition<ComponentSchema>>(id: EntityId, def: D): boolean {
    return this._componentRegistry.has(id, def);
  }

  /**
   * Remove a component from an entity.
   *
   * @param id - Target entity
   * @param def - Component definition to remove
   * @returns `true` if the component existed and was removed
   */
  removeComponent<D extends ComponentDefinition<ComponentSchema>>(id: EntityId, def: D): boolean {
    const removed = this._componentRegistry.remove(id, def);
    if (removed) this._queryEngine.invalidate();
    return removed;
  }

  // ─── ECS live query ───────────────────────────────────────────────────────

  /**
   * Create a live query that reflects the current ECS state on each iteration.
   *
   * The returned `Iterable` re-evaluates matching entities every time it is
   * iterated — no stale cache is exposed to the caller.
   *
   * @param components - Array of component definitions all matched entities must have
   * @returns A live {@link LiveQuery} of {@link EntityAccessor} objects
   */
  createLiveQuery<T extends ComponentDef>(components: T[]): LiveQuery<EntityAccessor> {
    // Capture specific members once — avoids both closure allocation on every
    // iteration start and the no-this-alias lint rule.
    const queryEngine = this._queryEngine;
    const entityManager = this._entityManager;
    const componentRegistry = this._componentRegistry;
    return {
      [Symbol.iterator](): Iterator<EntityAccessor> {
        const results = queryEngine.resolve(components, entityManager, componentRegistry);
        let i = 0;
        return {
          next(): IteratorResult<EntityAccessor> {
            if (i >= results.length) {
              return { done: true, value: undefined as unknown as EntityAccessor };
            }
            const id = results[i++]!;
            return {
              done: false,
              value: {
                id,
                get<S extends ComponentSchema, D extends ComponentDefinition<S>>(
                  def: D,
                ): InferComponent<D> | undefined {
                  return componentRegistry.get<InferComponent<D>>(id, def);
                },
              },
            };
          },
        };
      },
    };
  }

  // ─── Internal WASM bridge accessors ───────────────────────────────────────

  _getPlacementBridge(): PlacementBridge {
    // Return a graceful object that doesn't throw if WASM is uninitialized.
    // All methods are optional and use optional chaining at call sites.
    try {
      return getWasmBridge().engine() as unknown as PlacementBridge;
    } catch {
      // If WASM is not initialized, return an empty object.
      // Call sites use optional chaining (?.) so undefined methods silently fail.
      return {};
    }
  }

  // ─── Stats ────────────────────────────────────────────────────────────────

  get deltaTime(): number {
    return this._deltaTime;
  }
  /** Frame counter — increments by 1 for each completed `_runFrame` call. */
  get frameCount(): number {
    return this._frameCountOwn;
  }
  /** Most recent FPS estimate. Updated after every frame as `1000 / dt`. */
  getFPS(): number {
    return this._fps;
  }
  getStats(): EngineStats {
    const budgetMs = 1000 / this.targetFPS;
    return {
      fps: this._fps,
      deltaTime: this._deltaTime,
      frameCount: this._frameCountOwn,
      phaseMs: { ...this._lastPhaseMs },
      budgetMs,
      overBudget: this._lastPhaseMs.total > budgetMs,
    };
  }

  // ─── Shared memory transform pointer accessor ────────────────────────────

  /**
   * Get or create the transform buffer pointer for community WASM plugins.
   *
   * If the WASM bridge is not initialized, returns `0` (null pointer placeholder).
   * Otherwise lazily initializes `SharedMemoryManager` and returns its transform pointer.
   *
   * @returns The transform buffer pointer (base address in WASM linear memory)
   *          or `0` if the bridge is not yet initialized.
   * @internal
   */
  private _getOrCreateTransformPtr(): number {
    const bridge = getWasmBridge();
    if (!bridge.isActive()) {
      throw new Error(
        '[GWEN] loadWasmModule() was called before initWasm() completed. ' +
          'Await initWasm() (or createEngine()) before loading community WASM modules.',
      );
    }
    if (!this._sharedMemory) {
      this._sharedMemory = SharedMemoryManager.create(bridge, this.maxEntities);
    }
    return this._sharedMemory.transformBufferPtr;
  }

  // ─── 8-phase frame runner ─────────────────────────────────────────────────

  /**
   * Report an error thrown by a plugin lifecycle hook.
   *
   * Calls `plugin.onError` if defined, giving the plugin a chance to recover.
   * If the plugin does not call `context.recover()`, logs the error via the
   * engine logger and forwards it to the error bus and the `plugin:error` hook.
   *
   * @param plugin - The plugin whose hook threw.
   * @param phase - The lifecycle phase in which the error occurred.
   * @param error - The thrown value.
   */
  private async _reportPluginError(
    plugin: GwenPlugin,
    phase: PluginErrorContext['phase'],
    error: unknown,
  ): Promise<void> {
    let recovered = false;
    const context: PluginErrorContext = {
      phase,
      frame: this._frameCountOwn,
      recover: () => {
        recovered = true;
      },
    };

    try {
      plugin.onError?.(error, context);
    } catch {
      // onError itself threw — ignore to avoid infinite loops
    }

    if (!recovered) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`[${plugin.name}] ${phase} threw: ${message}`, {
        phase,
        frame: this._frameCountOwn,
      });
      this._errorBus?.emit({
        level: 'error',
        code: CoreErrorCodes.PLUGIN_RUNTIME_ERROR,
        message: `[${plugin.name}] ${phase} threw: ${message}`,
        source: plugin.name,
        error,
        context: { phase, frame: this._frameCountOwn },
      });
      await this.hooks.callHook('plugin:error', {
        pluginName: plugin.name,
        phase,
        error,
        frame: this._frameCountOwn,
      });
    }
  }

  private async _runFrame(dt: number): Promise<void> {
    // All 8 frame phases run inside this engine's context.
    // engineContext.set(this, true) makes useEngine() resolve to this instance
    // for the entire duration of the frame (across await points).
    // The _advancing guard (set before _runFrame is called) prevents re-entrance,
    // so it is safe to use set/unset here instead of call() for async compatibility.
    engineContext.set(this, true);
    const t0 = performance.now();
    try {
      // Phase 1 — engine:tick hook (fires before any plugin work)
      const t1 = performance.now();
      await this.hooks.callHook('engine:tick', dt);
      const t2 = performance.now();

      // Phase 2 — onBeforeUpdate (all plugins, registration order)
      for (const plugin of this._plugins) {
        try {
          plugin.onBeforeUpdate?.(dt);
        } catch (err) {
          await this._reportPluginError(plugin, 'onBeforeUpdate', err);
        }
      }
      const t3 = performance.now();

      // Phase 3 — built-in physics step (Cas A: wasmBridge physics)
      try {
        if (this.wasmBridge.physics2d.enabled) this.wasmBridge.physics2d.step(dt);
        if (this.wasmBridge.physics3d.enabled) this.wasmBridge.physics3d.step(dt);
      } catch (err) {
        const code =
          err instanceof WebAssembly.RuntimeError
            ? CoreErrorCodes.WASM_PANIC
            : CoreErrorCodes.FRAME_LOOP_ERROR;
        this._errorBus?.emit({
          level: 'fatal',
          code,
          message: `WASM step failed: ${err instanceof Error ? err.message : String(err)}`,
          source: 'gwen_core.wasm',
          error: err,
          context: { frame: this._frameCountOwn },
        });
      }
      const t4 = performance.now();

      // Phase 4 — community WASM modules step (Cas B: user WASM, registration order)
      for (const [name, entry] of this._wasmModules.entries()) {
        try {
          entry.step?.(entry.handle, dt);
        } catch (err) {
          const code =
            err instanceof WebAssembly.RuntimeError
              ? CoreErrorCodes.WASM_PANIC
              : CoreErrorCodes.FRAME_LOOP_ERROR;
          this._errorBus?.emit({
            level: 'error',
            code,
            message: `WASM module "${name}" step failed: ${err instanceof Error ? err.message : String(err)}`,
            source: `wasm:${name}`,
            error: err,
            context: { frame: this._frameCountOwn },
          });
        }
      }
      const t5 = performance.now();

      // Debug sentinel check — verifies WASM memory boundaries were not overrun.
      // Only runs in debug mode and only when a SharedMemoryManager is active.
      if (this.debug && this._sharedMemory) {
        try {
          const bridge = getWasmBridge();
          this._sharedMemory.checkSentinels(bridge);
        } catch (err) {
          this.logger.error('WASM memory sentinel violation', {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // Phase 5 — ECS query flush (dirty component marks resolved)
      // Handled internally by the WASM core; stub for future explicit flush API.

      // Phase 6 — onUpdate (all plugins, registration order)
      for (const plugin of this._plugins) {
        try {
          plugin.onUpdate?.(dt);
        } catch (err) {
          await this._reportPluginError(plugin, 'onUpdate', err);
        }
      }
      const t6 = performance.now();

      // Phase 7 — onAfterUpdate + onRender (all plugins, registration order)
      for (const plugin of this._plugins) {
        try {
          plugin.onAfterUpdate?.(dt);
        } catch (err) {
          await this._reportPluginError(plugin, 'onAfterUpdate', err);
        }
      }
      for (const plugin of this._plugins) {
        try {
          plugin.onRender?.();
        } catch (err) {
          await this._reportPluginError(plugin, 'onRender', err);
        }
      }
      const t7 = performance.now();

      // Phase 8 — update stats, then fire engine:afterTick hook
      this._frameCountOwn++;
      this._fps = dt > 0 ? 1000 / dt : 0;
      await this.hooks.callHook('engine:afterTick', dt);
      const t8 = performance.now();

      this._lastPhaseMs = {
        tick: t2 - t1,
        plugins: t3 - t2,
        physics: t4 - t3,
        wasm: t5 - t4,
        update: t6 - t5,
        render: t7 - t6,
        afterTick: t8 - t7,
        total: t8 - t0,
      };

      // Debug over-budget phase warning — logs when any individual phase
      // consumes more than 50% of the per-frame time budget.
      if (this.debug) {
        const budget = 1000 / this.targetFPS;
        for (const [phase, ms] of Object.entries(this._lastPhaseMs)) {
          if (phase === 'total') continue;
          if ((ms as number) > budget * 0.5) {
            this.logger.warn(`phase "${phase}" exceeded 50% of frame budget`, {
              phase,
              ms: (ms as number).toFixed(2),
              budgetMs: budget.toFixed(2),
              frame: this._frameCountOwn,
            });
          }
        }
      }
    } finally {
      engineContext.unset();
    }
  }

  // ─── Scoped hooks proxy ───────────────────────────────────────────────────
  //
  // RFC-001 (Plugin Lifecycle):
  // We provide `engineWithScopedHooks` (a Proxy of the engine) to `plugin.setup()`.
  // This proxy captures the plugin's name. Any hook registered via `engine.hooks.hook()`
  // by this plugin is trapped and tracked by `PluginHookTracker` using this captured name.
  //
  // CRITICAL async factory lifetime warning:
  // If `plugin.setup()` is async, or returning an async factory, the Proxy
  // instance (`engineWithScopedHooks`) is bound to the closure at invocation time.
  // Avoid leaking this proxy outside setup; subsequent system/feature
  // declarations should ideally use the actual resolved engine from context.
  //

  private _createScopedHooks(pluginName: string): Hookable<GwenRuntimeHooks> {
    const tracker = this._tracker;
    const realHooks = this.hooks;
    return new Proxy(realHooks, {
      get(target, prop) {
        if (prop === 'hook') {
          return (event: string, fn: (...args: unknown[]) => unknown) => {
            tracker.track(pluginName, event, fn);
            return (target as unknown as Record<string, unknown>)['hook'] instanceof Function
              ? (target.hook as (e: string, f: (...args: unknown[]) => unknown) => void)(
                  event as keyof GwenRuntimeHooks,
                  fn as never,
                )
              : undefined;
          };
        }
        return Reflect.get(target, prop);
      },
    });
  }

  private _withScopedHooks(scopedHooks: Hookable<GwenRuntimeHooks>): GwenEngine {
    return new Proxy(this, {
      get(target, prop) {
        if (prop === 'hooks') return scopedHooks;
        return Reflect.get(target, prop);
      },
    });
  }
}

// #endregion

// #region Factory ─────────────────────────────────────────────────────────────

/**
 * Create a GWEN engine instance.
 *
 * @param options - Engine configuration. All fields optional.
 * @returns A fully initialised {@link GwenEngine}.
 *
 * @example
 * ```typescript
 * import { createEngine } from '@gwenjs/core'
 * const engine = await createEngine({ maxEntities: 5_000, variant: 'physics2d' })
 * await engine.use(myPlugin())
 * engine.start()
 * ```
 */
export async function createEngine(options?: GwenEngineOptions): Promise<GwenEngine> {
  validateEngineConfig(options ?? {});
  return new GwenEngineImpl(options ?? {});
}

// #endregion
