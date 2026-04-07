/**
 * @file Engine public type contracts.
 *
 * Extracted from gwen-engine.ts — all interfaces and type-only constants
 * used by consumers of the GwenEngine API. These are erased at compile time
 * and have no impact on V8 inlining of the implementation in gwen-engine.ts.
 */

import type { Hookable } from 'hookable';
import type { GwenRuntimeHooks } from './runtime-hooks.js';
import type { GwenLogger } from '../logger/index';
import type { WasmRegionView, WasmRingBuffer } from './wasm-module-handle.js';
import type { EntityId } from './engine-api.js';
import type { ComponentDefinition, ComponentSchema, InferComponent } from '../schema.js';
import type { ComponentDef, LiveQuery, EntityAccessor } from '../system.js';
import type { TweenPoolPolicy } from '../tween/tween-pool.js';
import type { PluginErrorContext } from './engine-errors.js';

// Re-export so consumers can access via this module
export type { PluginErrorContext } from './engine-errors.js';

// ─── WASM module types (RFC-008) ────────────────────────────────────────────

/**
 * Options for loading a community WASM module via {@link GwenEngine.loadWasmModule}.
 *
 * @template Exports - Shape of the module's exported functions/memories.
 *
 * @example
 * ```typescript
 * const handle = await engine.loadWasmModule<{ step: (dt: number) => void }>({
 *   name: 'myMod',
 *   url: new URL('./my-mod.wasm', import.meta.url),
 *   step: (h, dt) => (h.exports as { step: (dt: number) => void }).step(dt),
 * })
 * ```
 */
export interface WasmModuleOptions<Exports extends WebAssembly.Exports = WebAssembly.Exports> {
  /** Unique name used to retrieve the module later via {@link GwenEngine.getWasmModule}. */
  readonly name: string;
  /** URL of the `.wasm` binary. Accepts a `URL` object or a string. */
  readonly url: URL | string;
  /**
   * Named memory regions to expose via `handle.region(name)`.
   * Each region creates a {@link WasmRegionView} backed by WASM linear memory.
   */
  readonly memory?: { regions: import('./wasm-module-handle.js').WasmMemoryRegion[] };
  /**
   * Ring-buffer channels for TS↔WASM message passing.
   * Each channel creates a {@link WasmRingBuffer} accessible via `handle.channel(name)`.
   */
  readonly channels?: import('./wasm-module-handle.js').WasmChannelOptions[];
  /**
   * Optional per-frame step callback.
   * Called during Phase 4 of every frame with the live handle and delta time in milliseconds.
   * @param handle - The live module handle with typed exports and memory.
   * @param dt - Delta time in milliseconds since the last frame.
   */
  readonly step?: (handle: WasmModuleHandle<Exports>, dt: number) => void;
  /**
   * Expected plugin API version (encoded as major * 1_000_000 + minor * 1_000 + patch).
   * When provided, the engine compares this against the `gwen_plugin_api_version` export.
   * Defaults to GWEN_PLUGIN_API_VERSION if omitted.
   *
   * @example
   * ```typescript
   * // Check against version 1.2.3
   * expectedVersion: 1_002_003
   * ```
   */
  readonly expectedVersion?: number;
  /**
   * Policy for version mismatches:
   * - 'warn' (default): logs a console.warn but continues loading
   * - 'throw': throws an Error, preventing the module from loading
   * - 'ignore': silently continues regardless of version
   */
  readonly versionPolicy?: 'warn' | 'throw' | 'ignore';
}

/** Current GWEN plugin API version. Encoded as major * 1_000_000 + minor * 1_000 + patch. */
export const GWEN_PLUGIN_API_VERSION = 1_000_000; // v1.0.0

/**
 * Checks the plugin API version exported by a WASM module against the expected version.
 *
 * @param exports - The WebAssembly module exports to inspect
 * @param moduleName - Module name for error/warning messages
 * @param expectedVersion - The version to check against (defaults to GWEN_PLUGIN_API_VERSION)
 * @param policy - How to handle mismatches: 'warn' | 'throw' | 'ignore'
 * @returns true if versions match or no version export found, false if mismatch with 'warn'/'ignore'
 * @throws {Error} When policy is 'throw' and versions don't match
 *
 * @example
 * ```typescript
 * checkPluginApiVersion(instance.exports, 'myPlugin', 1_000_000, 'throw');
 * // Throws if the plugin's gwen_plugin_api_version doesn't match 1.0.0
 * ```
 */
export function checkPluginApiVersion(
  exports: WebAssembly.Exports,
  moduleName: string,
  expectedVersion = GWEN_PLUGIN_API_VERSION,
  policy: 'warn' | 'throw' | 'ignore' = 'warn',
): boolean {
  const versionFn = exports['gwen_plugin_api_version'];
  if (typeof versionFn !== 'function') {
    return true; // No version export — old plugin, skip check
  }
  const actual = (versionFn as () => number)();
  if (actual === expectedVersion) {
    return true;
  }
  const msg = `[GWEN] Plugin "${moduleName}" was compiled against API version ${actual} but engine expects ${expectedVersion}.`;
  if (policy === 'throw') {
    throw new Error(msg);
  }
  if (policy === 'warn') {
    console.warn(msg);
  }
  return false;
}

/**
 * A live, typed handle to a loaded WASM module.
 * Provides access to exports and, when present, the module's linear memory.
 *
 * @template Exports - Shape of the module's exported functions/memories.
 *
 * @example
 * ```typescript
 * const handle = engine.getWasmModule<{ update: () => void }>('myMod')
 * handle.exports.update()
 * if (handle.memory) {
 *   const view = new Float32Array(handle.memory.buffer)
 * }
 * ```
 */
export interface WasmModuleHandle<Exports extends WebAssembly.Exports = WebAssembly.Exports> {
  /** The unique name this module was registered under. */
  readonly name: string;
  /** Typed exports from the instantiated WASM module. */
  readonly exports: Exports;
  /**
   * The module's linear memory export, if the WASM binary exports `"memory"`.
   * `undefined` when the binary does not export memory.
   *
   * @remarks
   * After `memory.grow()`, all `TypedArray` views backed by `memory.buffer` are
   * detached. Always create a fresh view per access and never cache it across frames.
   */
  readonly memory: WebAssembly.Memory | undefined;
  /**
   * Returns a live typed view accessor for a named memory region.
   * Throws if the region was not declared in `WasmModuleOptions.memory.regions`.
   *
   * @param regionName - The name declared in the module options.
   * @returns A {@link WasmRegionView} backed by WASM linear memory.
   */
  region(regionName: string): WasmRegionView;
  /**
   * Returns the ring-buffer channel with the given name.
   * Throws if the channel was not declared in `WasmModuleOptions.channels`.
   *
   * @param channelName - The name declared in the module options.
   * @returns A {@link WasmRingBuffer} for TS↔WASM message passing.
   */
  channel(channelName: string): WasmRingBuffer;
}

// ─── Internal bridge interfaces ─────────────────────────────────────────────

/**
 * Minimal bridge surface needed by scene placement composables.
 * Exposes only the transform methods required by {@link placeActor}, {@link placeGroup},
 * {@link placePrefab}, and {@link useLayout}.
 *
 * @internal — for use by scene composables only (place.ts, use-layout.ts)
 *
 * @remarks
 * This interface is intentionally minimal to decouple scene composables from the full
 * {@link WasmBridge} surface. Use {@link GwenEngine._getPlacementBridge} to access.
 */
export interface PlacementBridge {
  /**
   * Attach a transform component to an entity (position, rotation, scale).
   * Must be called before any other transform operations on this entity.
   */
  add_entity_transform?(
    index: number,
    x: number,
    y: number,
    rotation: number,
    scale_x: number,
    scale_y: number,
  ): void;

  /**
   * Set the parent of `child_index` to `parent_index`.
   * Pass `parent_index = 0xFFFFFFFF` (`2^32 - 1`) to detach from any parent.
   */
  set_entity_parent?(child_index: number, parent_index: number, keep_world_pos: boolean): void;

  /** Set an entity's local position. */
  set_entity_local_position?(index: number, x: number, y: number): void;

  /**
   * Destroy multiple entities by slot index in a single WASM call.
   * Also removes their transforms.
   */
  bulk_destroy?(indices: Uint32Array): void;
}

// ─── Public interfaces ──────────────────────────────────────────────────────

/**
 * Minimal error bus interface required by the engine.
 *
 * Intentionally kept small to avoid a circular dependency with `@gwenjs/kit`.
 * The `GwenErrorBus` class in `@gwenjs/kit` satisfies this interface.
 *
 * @example
 * ```typescript
 * import { createErrorBus } from '@gwenjs/kit'
 * const engine = await createEngine({ errorBus: createErrorBus() })
 * ```
 */
export interface EngineErrorBus {
  /**
   * Emit a structured error event.
   * Matches the signature of `GwenErrorBus.emit()` in `@gwenjs/kit`.
   */
  emit(event: {
    level: 'fatal' | 'error' | 'warning' | 'info' | 'verbose';
    code: string;
    message: string;
    source?: string;
    error?: unknown;
    context?: Record<string, unknown>;
  }): void;
  /** Register a callback to invoke before a fatal error is thrown. */
  onFatal(cb: () => void): void;
  /** Install global `window.onerror` / `unhandledrejection` handlers. */
  install?(): void;
}

/**
 * Configuration options for {@link createEngine}.
 * All fields are optional — unspecified fields fall back to engine defaults.
 */
export interface GwenEngineOptions {
  /**
   * Maximum number of simultaneously alive entities.
   * Used at WASM init time to pre-allocate storage.
   * @default 10_000
   */
  maxEntities?: number;

  /**
   * Target frames per second for the internal RAF game loop.
   * Ignored when using an external loop via {@link GwenEngine.advance}.
   * @default 60
   */
  targetFPS?: number;

  /**
   * Maximum delta time in seconds. Prevents spiral-of-death after tab suspension.
   * @default 0.1
   */
  maxDeltaSeconds?: number;

  /**
   * WASM variant to load.
   * @default 'light'
   */
  variant?: 'light' | 'physics2d' | 'physics3d';

  /**
   * Optional error bus instance. When provided the engine emits all internal
   * errors through it and calls `engine.stop()` on fatal errors.
   *
   * Create one with `createErrorBus()` from `@gwenjs/kit`.
   */
  errorBus?: EngineErrorBus;

  /**
   * Enable debug mode for the engine and all plugins.
   * When `true`: activates verbose logging, per-frame sentinel checks,
   * phase timing warnings, and plugin setup logs.
   * @default false
   */
  debug?: boolean;

  /**
   * Number of pre-allocated tween slots.
   * @default 256
   */
  tweenPoolSize?: number;

  /**
   * Growth and exhaustion policy for the tween pool.
   * Controls what happens when all tween slots are in use.
   * @default `{ onExhausted: 'grow' }`
   */
  tweenPoolPolicy?: TweenPoolPolicy;
}

/**
 * Augmentable interface for the typed provide/inject registry.
 * Plugin packages extend this via declaration merging.
 *
 * @example
 * ```typescript
 * // In @gwenjs/physics2d:
 * declare module '@gwenjs/core' {
 *   interface GwenProvides {
 *     physics2d: Physics2DAPI
 *   }
 * }
 * ```
 */
export interface GwenProvides {
  /** The engine-level error bus. Inject via `engine.inject('errors')`. */
  errors: EngineErrorBus;
  /** The engine-level structured logger. Inject via `engine.inject('logger')`. */
  logger: GwenLogger;
}

/**
 * A GWEN plugin. Registered via {@link GwenEngine.use}.
 *
 * @example
 * ```typescript
 * const myPlugin: GwenPlugin = {
 *   name: 'my-plugin',
 *   setup(engine) {
 *     engine.provide('myService', new MyService())
 *   },
 *   onUpdate(dt) { ... },
 * }
 * ```
 */
export interface GwenPlugin {
  /** Unique plugin identifier. Used for deduplication and lookup. */
  name: string;
  /** Called once when the plugin is registered via `engine.use()`. */
  setup(engine: GwenEngine): void | Promise<void>;
  /** Called when the plugin is removed via `engine.unuse()`. */
  teardown?(): void | Promise<void>;
  /** Called every frame before physics/WASM step. */
  onBeforeUpdate?(dt: number): void;
  /** Called every frame after the WASM step. */
  onUpdate?(dt: number): void;
  /** Called every frame after `onUpdate`. */
  onAfterUpdate?(dt: number): void;
  /** Called every frame at the render phase. */
  onRender?(): void;
  /**
   * Called when an error is thrown inside this plugin's lifecycle hooks.
   * Implement to handle or recover from plugin-specific errors gracefully.
   *
   * Call `context.recover()` to suppress forwarding to the engine error bus.
   *
   * @example
   * ```typescript
   * onError(error, context) {
   *   if (context.phase === 'onRender' && error instanceof DOMException) {
   *     context.recover() // canvas context lost — handled
   *   }
   * }
   * ```
   */
  onError?(error: unknown, context: PluginErrorContext): void;
}

/**
 * Per-phase timing breakdown for a single frame (in milliseconds).
 * Measured with `performance.now()` around each phase of `_runFrame`.
 */
export interface EngineFramePhaseMs {
  /** Duration of the `engine:tick` hook. */
  tick: number;
  /** Combined duration of all plugin `onBeforeUpdate()` calls. */
  plugins: number;
  /** Duration of the built-in physics2d + physics3d step. */
  physics: number;
  /** Combined duration of all community WASM module steps. */
  wasm: number;
  /** Combined duration of all plugin `onUpdate()` calls. */
  update: number;
  /** Combined duration of all plugin `onAfterUpdate()` + `onRender()` calls. */
  render: number;
  /** Duration of the `engine:afterTick` hook. */
  afterTick: number;
  /** Total `_runFrame` duration (wall-clock, includes async overhead). */
  total: number;
}

/**
 * Runtime statistics snapshot.
 */
export interface EngineStats {
  fps: number;
  deltaTime: number;
  frameCount: number;
  /** Per-phase timing for the most recent completed frame. */
  phaseMs: EngineFramePhaseMs;
  /** Frame time budget in ms derived from `targetFPS` (e.g. 16.67 ms at 60 FPS). */
  budgetMs: number;
  /** `true` if the last frame's total duration exceeded the budget. */
  overBudget: boolean;
}

/**
 * The GWEN engine instance returned by {@link createEngine}.
 *
 * @example Standalone (no framework)
 * ```typescript
 * import { createEngine } from '@gwenjs/core'
 * const engine = await createEngine({ maxEntities: 5_000 })
 * await engine.use(MyPlugin())
 * engine.start()
 * ```
 */
export interface GwenEngine {
  // ─── Plugin runner ──────────────────────────────────────────────────────
  /** Register and initialise a plugin. Deduplicates by `plugin.name`. */
  use(plugin: GwenPlugin): Promise<void>;
  /** Tear down and unregister a plugin by name. Safe to call with unknown names. */
  unuse(name: string): Promise<void>;

  // ─── Typed provide/inject ───────────────────────────────────────────────
  /** Register a named value in the typed service registry. */
  provide<K extends keyof GwenProvides>(key: K, value: GwenProvides[K]): void;
  /** Retrieve a value from the registry, throwing {@link GwenPluginNotFoundError} if absent. */
  inject<K extends keyof GwenProvides>(key: K): GwenProvides[K];
  /** Retrieve a value from the registry, returning `undefined` if absent. */
  tryInject<K extends keyof GwenProvides>(key: K): GwenProvides[K] | undefined;

  // ─── WASM bridge stub ───────────────────────────────────────────────────
  /** Low-level WASM bridge. Physics2D/3D filled in by RFC-009. */
  readonly wasmBridge: {
    physics2d: {
      enabled: boolean;
      enable(opts: unknown): void;
      disable(): void;
      step(dt: number): void;
    };
    physics3d: {
      enabled: boolean;
      enable(opts: unknown): void;
      disable(): void;
      step(dt: number): void;
    };
  };

  // ─── Context (unctx — RFC-005) ──────────────────────────────────────────
  /** Execute `fn` within this engine's context. `useEngine()` resolves inside `fn`. */
  run<T>(fn: () => T): T;
  /** Set this engine as the global active context. */
  activate(): void;
  /** Clear this engine from the active context. */
  deactivate(): void;

  // ─── Lifecycle ──────────────────────────────────────────────────────────
  /** Initialise all plugins and start the RAF loop. */
  start(): Promise<void>;
  /** Stop the RAF loop and tear down all plugins. */
  stop(): Promise<void>;
  /**
   * Start the engine without launching a RAF loop.
   * Use this when an external host (e.g. React Three Fiber's `useFrame`, a
   * test harness) drives the loop and calls {@link GwenEngine.advance} manually.
   *
   * @example
   * ```typescript
   * await engine.startExternal()
   * useFrame(({ clock }) => engine.advance(clock.getDelta() * 1000))
   * ```
   */
  startExternal(): Promise<void>;
  /**
   * Manually advance one tick (external loop mode).
   * Delta time in **milliseconds** is capped at `maxDeltaSeconds * 1000`.
   * Throws if called re-entrantly.
   * @param dt - Delta time in **milliseconds** since the last frame.
   */
  advance(dt: number): Promise<void>;

  // ─── WASM modules (RFC-008) ──────────────────────────────────────────────
  /**
   * Fetch and instantiate a community WASM module (Cas B).
   * Registers it under `options.name` and returns a typed handle.
   * Calling twice with the same name returns the same handle without re-fetching.
   *
   * @param options - Load options including URL and optional per-frame step.
   * @returns A live {@link WasmModuleHandle} with typed exports and memory access.
   * @throws {Error} If the fetch or instantiation fails.
   *
   * @example
   * ```typescript
   * const handle = await engine.loadWasmModule({
   *   name: 'audio',
   *   url: new URL('./audio.wasm', import.meta.url),
   *   step: (h, dt) => (h.exports as { tick: (dt: number) => void }).tick(dt),
   * })
   * ```
   */
  loadWasmModule<Exports extends WebAssembly.Exports = WebAssembly.Exports>(
    options: WasmModuleOptions<Exports>,
  ): Promise<WasmModuleHandle<Exports>>;
  /**
   * Retrieve a previously loaded WASM module by name.
   *
   * @param name - The name used when calling {@link GwenEngine.loadWasmModule}.
   * @returns The live {@link WasmModuleHandle}.
   * @throws {Error} If no module with the given name has been loaded.
   *
   * @example
   * ```typescript
   * const audio = engine.getWasmModule<AudioExports>('audio')
   * audio.exports.playSound(42)
   * ```
   */
  getWasmModule<Exports extends WebAssembly.Exports = WebAssembly.Exports>(
    name: string,
  ): WasmModuleHandle<Exports>;

  // ─── ECS (RFC-005) ──────────────────────────────────────────────────────
  // ─── Entity management ──────────────────────────────────────────────────
  /**
   * Create a new entity and return its unique ID.
   * @returns A fresh {@link EntityId} guaranteed to be alive.
   */
  createEntity(): EntityId;

  /**
   * Destroy an entity and remove all its components.
   *
   * @param id - The entity to destroy
   * @returns `true` if the entity was alive and has been destroyed, `false` if it was already dead
   */
  destroyEntity(id: EntityId): boolean;

  /**
   * Check whether an entity is still alive (i.e. has not been destroyed).
   *
   * @param id - The entity to check
   * @returns `true` if alive
   */
  isAlive(id: EntityId): boolean;

  // ─── Component management ────────────────────────────────────────────────
  /**
   * Attach a component to an entity, merging supplied data over the definition defaults.
   *
   * @param id - Target entity
   * @param def - Component definition produced by {@link defineComponent}
   * @param data - Partial component data — merged with `def.defaults`
   */
  addComponent<D extends ComponentDefinition<ComponentSchema>>(
    id: EntityId,
    def: D,
    data: Partial<InferComponent<D>>,
  ): void;

  /**
   * Retrieve the component data for an entity.
   *
   * @param id - Target entity
   * @param def - Component definition to look up
   * @returns The component data, or `undefined` if the entity does not have it
   */
  getComponent<D extends ComponentDefinition<ComponentSchema>>(
    id: EntityId,
    def: D,
  ): InferComponent<D> | undefined;

  /**
   * Check whether an entity has a specific component attached.
   *
   * @param id - Target entity
   * @param def - Component definition to check
   * @returns `true` if the component is present
   */
  hasComponent<D extends ComponentDefinition<ComponentSchema>>(id: EntityId, def: D): boolean;

  /**
   * Remove a component from an entity.
   *
   * @param id - Target entity
   * @param def - Component definition to remove
   * @returns `true` if the component was present and has been removed
   */
  removeComponent<D extends ComponentDefinition<ComponentSchema>>(id: EntityId, def: D): boolean;

  /**
   * Create a live query over the ECS world. Called by `useQuery()`.
   * Returns an iterable that reflects the current ECS state each time you iterate.
   *
   * @param components - Component selectors to match against.
   * @returns A live iterable of {@link EntityAccessor} objects.
   */
  createLiveQuery<T extends ComponentDef>(components: T[]): LiveQuery<EntityAccessor>;

  // ─── Internal WASM bridge accessors ───────────────────────────────────────

  /**
   * @internal — Get a typed accessor for placement-related WASM bridge methods.
   * Reserved for scene composables (place.ts, use-layout.ts). Do not use elsewhere.
   * @returns A {@link PlacementBridge} exposing only transform methods.
   */
  _getPlacementBridge(): PlacementBridge;

  // ─── Hooks ──────────────────────────────────────────────────────────────
  /** Typed hookable lifecycle instance. */
  readonly hooks: Hookable<GwenRuntimeHooks>;

  // ─── Config ─────────────────────────────────────────────────────────────
  readonly maxEntities: number;
  readonly targetFPS: number;
  readonly maxDeltaSeconds: number;
  /**
   * Identifies which core WASM binary is actively loaded running the engine.
   *
   * This is a **read-only reflection** of the state established during engine creation.
   * It is not a runtime configuration property. The loaded variant dictates whether
   * physics hooks (via `wasmBridge`) use fast native Rust code or TypeScript fallbacks.
   */
  readonly variant: 'light' | 'physics2d' | 'physics3d';

  /** Whether debug mode is active. Reflects the `debug` option passed to `createEngine()`. */
  readonly debug: boolean;

  /** Number of pre-allocated tween slots. Reflects `tweenPoolSize` from `createEngine()`. */
  readonly tweenPoolSize: number;

  /** Growth and exhaustion policy for the tween pool. Reflects `tweenPoolPolicy` from `createEngine()`. */
  readonly tweenPoolPolicy: TweenPoolPolicy;

  /**
   * Structured logger for this engine instance.
   * Call `engine.logger.child('@my/plugin')` to get a scoped child logger.
   * The logger is also injectable: `engine.inject('logger')`.
   */
  readonly logger: GwenLogger;

  // ─── Stats ──────────────────────────────────────────────────────────────
  readonly deltaTime: number;
  readonly frameCount: number;
  getFPS(): number;
  getStats(): EngineStats;
}
