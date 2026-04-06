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
 * ⚠️  INTENTIONAL LARGE FILE — Do not split into separate modules.
 * V8 inlines calls between functions in the same compilation unit.
 * A previous refactor attempt that split this file caused a measurable perf
 * regression on the hot path (frame loop + plugin dispatch at ~1000 entities/frame).
 * Keep all engine code co-located so the JIT can inline across method boundaries.
 *
 * NAVIGATION (use IDE region folding — Ctrl+Shift+[ / Cmd+Shift+[):
 *   #region Types, interfaces & error classes   — all public contracts
 *   #region Internal helpers                    — ScopedHooksTracker
 *   #region Engine implementation               — GwenEngineImpl (frame loop, plugins, DI)
 *   #region Factory                             — createEngine()
 */

import { createHooks, type Hookable } from 'hookable';
import type { GwenRuntimeHooks, EngineErrorPayload } from './runtime-hooks.js';
import { engineContext } from '../context.js';
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
export type {
  WasmMemoryRegion,
  WasmMemoryOptions,
  WasmChannelOptions,
} from './wasm-module-handle.js';
export { WasmRegionView, WasmRingBuffer } from './wasm-module-handle.js';
export type { EngineErrorPayload } from './runtime-hooks.js';

// #region Types, interfaces & error classes

// ─── WASM module types (RFC-008) ─────────────────────────────────────────────

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

// ─── Internal bridge interfaces ──────────────────────────────────────────────

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

// ─── Public interfaces ───────────────────────────────────────────────────────

/**
 * Configuration options for {@link createEngine}.
 * All fields are optional — unspecified fields fall back to engine defaults.
 */
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

/** Error codes emitted by the GWEN core engine. */
export const CoreErrorCodes = {
  FRAME_LOOP_ERROR: 'CORE:FRAME_LOOP_ERROR',
  PLUGIN_SETUP_ERROR: 'CORE:PLUGIN_SETUP_ERROR',
  PLUGIN_RUNTIME_ERROR: 'CORE:PLUGIN_RUNTIME_ERROR',
  WASM_LOAD_ERROR: 'CORE:WASM_LOAD_ERROR',
  WASM_TIMEOUT: 'CORE:WASM_TIMEOUT',
  WASM_PANIC: 'CORE:WASM_PANIC',
} as const;

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
 * Options object accepted by the {@link GwenPluginNotFoundError} constructor.
 * Use this form when constructing the error from plugin composables.
 */
export interface GwenPluginNotFoundErrorOptions {
  /** The npm package name of the missing plugin. */
  pluginName: string;
  /** Human-readable hint explaining how to fix the issue. */
  hint: string;
  /** URL to the plugin's documentation. */
  docsUrl: string;
}

/**
 * Thrown when a required plugin/service has not been registered with the engine.
 *
 * Provides an actionable error message with a hint for fixing the problem
 * and a link to the plugin documentation.
 *
 * throw new GwenPluginNotFoundError({
 *   pluginName: 'physics2d',
 *   hint: 'Call engine.use(physics2dPlugin()) before accessing this service.',
 *   docsUrl: 'https://gwenengine.dev/docs/plugins'
 * })
 * throw new GwenPluginNotFoundError({
 *   pluginName: '@gwenjs/physics2d',
 *   hint: 'Add @gwenjs/physics2d to the modules array in gwen.config.ts',
 *   docsUrl: 'https://gwenengine.dev/modules/physics2d',
 * })
 * ```
 */
export class GwenPluginNotFoundError extends Error {
  readonly pluginName: string;
  /** Human-readable hint explaining how to fix the issue. */
  readonly hint: string;
  /** URL to relevant documentation. */
  readonly docsUrl: string;

  constructor(opts: GwenPluginNotFoundErrorOptions) {
    const hint =
      opts.hint || `Add the "${opts.pluginName}" plugin via engine.use() or in gwen.config.ts.`;
    const docsUrl = opts.docsUrl || 'https://gwenengine.dev/docs/plugins';
    super(`[GwenEngine] Plugin/service "${opts.pluginName}" not found. ${hint}`);
    this.name = 'GwenPluginNotFoundError';
    this.pluginName = opts.pluginName;
    this.hint = hint;
    this.docsUrl = docsUrl;
  }
}

/**
 * Context passed to a plugin's {@link GwenPlugin.onError} hook.
 */
export interface PluginErrorContext {
  /** Frame loop phase in which the error occurred. */
  phase: 'setup' | 'onBeforeUpdate' | 'onUpdate' | 'onAfterUpdate' | 'onRender' | 'teardown';
  /** Engine frame index at the time of the error. */
  frame: number;
  /**
   * Mark this error as handled.
   * When called, the error is **not** forwarded to the engine error bus.
   * The frame continues normally.
   */
  recover(): void;
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

// ─── Implementation ──────────────────────────────────────────────────────────

// #endregion

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
      const setupResult = engineContext.call(this, () => plugin.setup(engineWithScopedHooks));
      if (setupResult instanceof Promise) await setupResult;
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
