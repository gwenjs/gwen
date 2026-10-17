/**
 * @file Engine public type contracts.
 *
 * Includes `checkPluginApiVersion`, which throws {@link GwenWasmAbiError}
 * `CORE:WASM_MODULE_ABI_MISMATCH` when the export is absent, not a function,
 * or differs from `GWEN_PLUGIN_API_VERSION`.
 */

import type { Hookable } from "hookable";
import type { GwenRuntimeHooks } from "./runtime-hooks";
import type { IGwenLogger } from "@gwenjs/schema";
import type { WasmRegionView, WasmRingBuffer } from "./wasm-module-handle";
import type { EntityId } from "./engine-api";
import type { ComponentDefinition, ComponentSchema, InferComponent } from "../schema";
import type { ComponentType } from "../types";
import type {
  ComponentDef,
  LiveQuery,
  EntityAccessor,
  Query,
} from "../system/runtime/define-system";
import type {
  GwenPlugin,
  GwenEngineBase,
  GwenErrorBusBase,
  GwenErrorPayload,
  GwenErrorTarget,
} from "@gwenjs/schema";
import type { WasmBridgeImpl } from "./wasm-bridge";
import type { EngineMemory } from "./engine-memory.js";
import type { TransformPair2D } from "./transform-pair.js";
import { DisposableRegistry } from "../disposable";
import { GwenWasmAbiError } from "./engine-errors.js";

// Re-export plugin-related types from @gwenjs/schema so plugin authors can import them from a single source.
export type { GwenPlugin, PluginErrorContext } from "@gwenjs/schema";

// ─── WASM module types ────────────────────────────────────────────

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
  readonly memory?: { regions: import("./wasm-module-handle.js").WasmMemoryRegion[] };
  /**
   * Ring-buffer channels for TS↔WASM message passing.
   * Each channel creates a {@link WasmRingBuffer} accessible via `handle.channel(name)`.
   */
  readonly channels?: import("./wasm-module-handle.js").WasmChannelOptions[];
  /**
   * Name of a `memory.regions` entry that receives the per-frame transform copy.
   * Absent means no copy, and `transform_buffer_ptr()` returns 0.
   */
  readonly transformRegion?: string;
  /**
   * Optional per-frame step callback.
   * Called during Phase 4 of every frame with the live handle and delta time in seconds.
   * @param handle - The live module handle with typed exports and memory.
   * @param dt - Delta time in seconds since the last frame.
   */
  readonly step?: (handle: WasmModuleHandle<Exports>, dt: number) => void;
}

/** Current GWEN plugin API version. Encoded as major * 1_000_000 + minor * 1_000 + patch. */
export const GWEN_PLUGIN_API_VERSION = 2_000_000; // v2.0.0

/**
 * Rejects a plugin instance whose ABI export differs from {@link GWEN_PLUGIN_API_VERSION}.
 *
 * Comparison is strict equality. An absent export, a non-function, or a
 * non-number is `actual: null`. There is no warn or ignore path.
 *
 * @param exports - Instantiated module exports
 * @param moduleName - Name passed to `loadWasmModule`
 * @throws {GwenWasmAbiError} `CORE:WASM_MODULE_ABI_MISMATCH`
 */
export function checkPluginApiVersion(exports: WebAssembly.Exports, moduleName: string): void {
  const versionFn = exports["gwen_plugin_api_version"];
  let actual: number | null = null;
  if (typeof versionFn === "function") {
    const returned: unknown = Reflect.apply(versionFn, undefined, []);
    if (typeof returned === "number") actual = returned;
  }
  if (actual === GWEN_PLUGIN_API_VERSION) return;
  throw new GwenWasmAbiError(moduleName, GWEN_PLUGIN_API_VERSION, actual);
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
 *
 * All methods are required — `getPlacementBridge()` throws before returning
 * if WASM is not initialised, so callers can assume a fully functional bridge.
 *
 * @internal — for use by scene composables only (`place.ts`, `use-layout.ts`).
 */
export interface PlacementBridge {
  /**
   * Attach a transform component to an entity (position, rotation, scale).
   * Must be called before any other transform operations on this entity.
   */
  add_entity_transform(
    index: number,
    x: number,
    y: number,
    rotation: number,
    scale_x: number,
    scale_y: number,
  ): void;

  /**
   * Set the parent of `child_index` to `parent_index`.
   * Pass `parent_index = 0xFFFFFFFF` to detach from any parent.
   */
  set_entity_parent(child_index: number, parent_index: number, keep_world_pos: boolean): void;

  /** Set an entity's local position without touching rotation or scale. */
  set_entity_local_position(index: number, x: number, y: number): void;

  /**
   * Destroy multiple entities by slot index in a single WASM call.
   * Also removes their transforms. Optional — falls back to per-entity destroy
   * when not available (e.g. older WASM build).
   */
  bulk_destroy?(indices: Uint32Array): void;
}

// ─── Public interfaces ──────────────────────────────────────────────────────

/**
 * Error bus used by the engine.
 *
 * Implemented by `createErrorBus()` in `@gwenjs/core` (re-exported from `@gwenjs/kit`).
 * Core does not import kit.
 *
 * @example
 * ```typescript
 * import { createErrorBus } from '@gwenjs/core'
 * const engine = await createEngine({ errorBus: createErrorBus() })
 * ```
 */
export interface EngineErrorBus extends GwenErrorBusBase {
  /**
   * Emit a structured error event.
   * Every `on` handler runs first. A fatal event then runs every `onFatal` callback.
   * Both run synchronously inside `emit`.
   * A handler that throws is caught. The other handlers still run.
   */
  emit(event: {
    level: "fatal" | "error" | "warning" | "info" | "verbose";
    code: string;
    message: string;
    source?: string;
    error?: unknown;
    context?: Record<string, unknown>;
    target?: GwenErrorTarget;
  }): void;
  /**
   * Register a listener for every event, including fatal. Runs before `onFatal`.
   * @returns Unsubscribe.
   */
  on(handler: (event: GwenErrorPayload) => void): () => void;
  /**
   * Register a callback that runs after `on` handlers when the level is `fatal`.
   * The engine does not register one that calls `stop()`.
   * @returns Unsubscribe.
   */
  onFatal(cb: () => void): () => void;
  /**
   * Install global `window.onerror` / `unhandledrejection` handlers.
   * Returns a function that removes them.
   * `createEngine()` calls this when `window` exists. `stop()` calls the result.
   */
  install?(): () => void;
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
  variant?: "light" | "physics2d" | "physics3d";

  /**
   * Error bus for structured engine errors.
   * When omitted, `createEngine()` creates one with `createErrorBus()`.
   * Pass an instance to share a bus or register handlers before startup.
   * The engine calls `on` to log and isolate.
   * `onFatal` moves a non-terminal engine to `faulted`. `stop()` is not called.
   * The engine subscribes in the constructor. `stop()` unsubscribes.
   * `start()` after `stop()` rejects. Create a new engine.
   * `createErrorBus()` is exported from `@gwenjs/core` and `@gwenjs/kit`.
   */
  errorBus?: EngineErrorBus;

  /**
   * Enable debug mode for the engine and all plugins.
   * Logger `debug` and `info` follow this flag in every build.
   * Per-frame sentinel checks, phase timing, and the isolation warning run only
   * when this is `true` and the build is a development build (`__GWEN_DEV__`).
   * Production builds skip them even when this is `true`.
   * @default false
   */
  debug?: boolean;

  /**
   * Pre-configured WasmBridgeImpl to use instead of creating a new one.
   * @internal — for testing only. Do not use in production code.
   */
  _bridge?: WasmBridgeImpl;

  /**
   * Maximum number of unique component-type query signatures to cache.
   * When full, the least-recently-used signature is evicted.
   * @default 256
   * @minimum 1
   */
  queryCacheSize?: number;
  /**
   * Fixed-timestep simulation rate in Hz.
   *
   * When non-zero, `start()` and `startExternal()` capture `1 / physicsHz` and
   * share one accumulator. Each display frame, from the scheduled loop or from
   * `advance(dt)`, runs 0 to `maxCatchupSteps` fixed steps and then one
   * `engine:render(alpha)`. `onUpdate` receives `1 / physicsHz`, scaled by
   * `timeScale`. `alpha` is the leftover fraction of a step and ignores
   * `timeScale`.
   *
   * `0` keeps the variable loop: one step per display frame and `engine:render(1)`.
   *
   * The 1.0 reproducibility statement for these fixed steps is the Determinism note in the engine essentials.
   *
   * @default 0 (variable dt — standard game loop)
   * @see maxCatchupSteps
   */
  physicsHz?: number;

  /**
   * Maximum number of fixed simulation steps dispatched in a single display frame.
   *
   * Prevents the spiral-of-death: if the machine falls behind (e.g. tab
   * hidden), the frame runs at most this many steps. Whole steps still left
   * in the accumulator are dropped.
   *
   * @default 2
   * @see physicsHz
   */
  maxCatchupSteps?: number;
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
/**
 * Augmentable registry of loaded WASM module names to their export types.
 * Module authors augment this by hand, the same way as {@link GwenProvides}.
 * Generation from the registration call is not done here.
 */
export interface GwenWasmModules {}

export interface GwenProvides {
  /** The engine-level error bus. Inject via `engine.inject('errors')`. */
  errors: EngineErrorBus;
  /** The engine-level structured logger. Inject via `engine.inject('logger')`. */
  logger: IGwenLogger;
  /**
   * The per-engine TweenManager singleton. Provided by TweenPlugin.
   * Retrieve via `engine.inject('tween:manager')` or `getTweenManager(engine)`.
   */
  "tween:manager": import("../tween/runtime/tween-manager.js").TweenManager;
  /** Per-engine WASM bridge. Retrieve via `engine.tryInject("wasm:bridge")`. @internal */
  "wasm:bridge": WasmBridgeImpl;
  /** Linear-memory views. Same object as `engine.memory`. */
  memory: EngineMemory;
}

/**
 * Interpolation state for the display frame currently running.
 * The same object is returned for the life of the engine.
 */
export interface EngineFrame {
  /** Value passed to the latest `engine:render`. `1` before the first render. */
  readonly alpha: number;
  /** `true` after `start()` or `startExternal()` captured `physicsHz > 0`. */
  readonly fixedStep: boolean;
  /**
   * Fixed steps run in the current display frame, from 0 to `maxCatchupSteps`.
   * `1` after a variable (`physicsHz === 0`) frame.
   */
  readonly steps: number;
  /** `true` only while `engine:render` handlers run. */
  readonly rendering: boolean;
  /**
   * History views. `null` when `physicsHz` is 0, before the fixed seed,
   * and after `stop()`.
   */
  readonly transforms2D: TransformPair2D | null;
}

/**
 * Per-phase timing for one display frame, in milliseconds.
 * Measured with `performance.now()` around each phase of `_runFrame`.
 * With `physicsHz > 0`, each field is the sum of the simulation steps in that
 * display frame. `render` is the single render pass. `total` covers the steps
 * and that pass.
 */
export interface EngineFramePhaseMs {
  /** Duration of the `engine:tick` hook. */
  tick: number;
  /** `engine:before-update`, including the physics step and kinematic sync. */
  plugins: number;
  /** Community WASM module steps. */
  wasm: number;
  /** `update_transforms` and the `engine:update` hook. */
  update: number;
  /** `engine:after-update`, plus the display frame's `engine:render` pass. */
  render: number;
  /** Duration of the `engine:afterTick` hook. */
  afterTick: number;
  /** Steps of this display frame, including its render pass. */
  total: number;
}

/**
 * Runtime statistics snapshot returned by `engine.getStats()`.
 */
export interface EngineStats {
  /** Smoothed frames per second from the raw frame duration. Ignores `timeScale`. */
  fps: number;
  /** Uncapped, unscaled frame duration in seconds. Same value as `engine.rawFrameTime`. */
  rawFrameTime: number;
  /** Last step duration in seconds, after the cap and `timeScale`. */
  deltaTime: number;
  /** Completed `_runFrame` calls. In fixed mode, one per simulation step. */
  frameCount: number;
  /** Alive entities at the time of the call. */
  entityCount: number;
  /**
   * WASM linear-memory size in bytes.
   * Omitted when the bridge has no memory.
   */
  wasmMemoryBytes?: number;
  /** Frame time budget in ms (`1000 / targetFPS`). */
  budgetMs: number;
  /**
   * Per-phase timings for the latest display frame.
   * Present only when `__GWEN_DEV__` and `engine.debug` are both true.
   */
  phaseMs?: EngineFramePhaseMs;
  /** Present only when `phaseMs` is present. `true` when `phaseMs.total` exceeds `budgetMs`. */
  overBudget?: boolean;
}

/**
 * Lifecycle state of a {@link GwenEngine}.
 * There is no `paused` state. `timeScale = 0` pauses simulation time.
 */
export type GwenEngineState = "idle" | "starting" | "running" | "stopping" | "stopped" | "faulted";

/** Why {@link GwenEngine} moved from one {@link GwenEngineState} to another. */
export type GwenEngineStateChangeReason = "USER" | "WASM_PANIC" | "FATAL_ERROR";

/**
 * Payload of the `engine:state-change` hook.
 * Emitted once per real transition. A no-op does not emit.
 */
export interface EngineStateChangePayload {
  readonly from: GwenEngineState;
  readonly to: GwenEngineState;
  readonly reason: GwenEngineStateChangeReason;
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
export interface GwenEngine extends GwenEngineBase {
  /** Current lifecycle state. Starts at `idle`. Getter only. */
  readonly state: GwenEngineState;
  // ─── Plugin runner ──────────────────────────────────────────────────────
  /**
   * Register and initialise a plugin. Deduplicates by `plugin.name`.
   * Allowed in `idle` and `running` only; rejects with `GwenEngineStateError` in
   * `starting`, `stopping`, `stopped` and `faulted`.
   */
  use(plugin: GwenPlugin): Promise<void>;
  /**
   * Tear down and unregister a plugin by name. Safe to call with unknown names.
   * Allowed in `idle` and `running` only; rejects with `GwenEngineStateError` in
   * `starting`, `stopping`, `stopped` and `faulted`.
   */
  unuse(name: string): Promise<void>;

  // ─── Typed provide/inject (narrows GwenEngineBase to typed keys) ────────
  provide<K extends keyof GwenProvides>(key: K, value: GwenProvides[K]): void;
  inject<K extends keyof GwenProvides>(key: K): GwenProvides[K];
  tryInject<K extends keyof GwenProvides>(key: K): GwenProvides[K] | undefined;

  // ─── Hooks (narrows HookBusBase to full Hookable) ────────────────────────
  readonly hooks: Hookable<GwenRuntimeHooks>;

  readonly logger: IGwenLogger;

  /** Structured error bus. Always present. Same object as `inject("errors")`. */
  readonly errors: EngineErrorBus;

  /**
   * Targets skipped after an error, in the order they were isolated.
   * Returns a copy. A saved array does not change after `reenable` or a later isolation.
   */
  isolated(): readonly GwenErrorTarget[];

  /**
   * Clear isolation for `id`.
   * @returns `false` when that id is not isolated.
   */
  reenable(id: string): boolean;

  /** Linear-memory views. Always present. Same object as `inject("memory")`. */
  readonly memory: EngineMemory;

  /**
   * Display-frame state. One object for the life of the engine.
   * `transforms2D` is `null` until a fixed-step seed installs the history views.
   */
  readonly frame: EngineFrame;

  // ─── Context ─────────────────────────────────────────────────────────────
  run<T>(fn: () => T): T;
  activate(): void;
  deactivate(): void;

  // ─── Lifecycle ───────────────────────────────────────────────────────────
  start(): Promise<void>;
  stop(): Promise<void>;
  startExternal(): Promise<void>;
  advance(dt: number): Promise<void>;

  // ─── WASM modules ────────────────────────────────────────────────────────
  loadWasmModule<Exports extends WebAssembly.Exports = WebAssembly.Exports>(
    options: WasmModuleOptions<Exports>,
  ): Promise<WasmModuleHandle<Exports>>;
  getWasmModule<K extends keyof GwenWasmModules>(name: K): WasmModuleHandle<GwenWasmModules[K]>;

  // ─── ECS ─────────────────────────────────────────────────────────────────
  createEntity(): EntityId;
  destroyEntity(id: EntityId): boolean;
  isAlive(id: EntityId): boolean;
  canSpawn(count: number): boolean;
  /**
   * Rust type id for a component name, owned by this engine.
   * Registering the same name again returns the same id.
   */
  getOrRegisterComponent(type: ComponentType): number;
  /** Component names registered on this engine, and their type ids. */
  registeredComponentTypes(): ReadonlyMap<ComponentType, number>;
  addComponent<D extends ComponentDefinition<ComponentSchema>>(
    id: EntityId,
    def: D,
    data: Partial<InferComponent<D>>,
  ): void;
  getComponent<D extends ComponentDefinition<ComponentSchema>>(
    id: EntityId,
    def: D,
  ): Readonly<InferComponent<D>> | undefined;
  hasComponent<D extends ComponentDefinition<ComponentSchema>>(id: EntityId, def: D): boolean;
  removeComponent<D extends ComponentDefinition<ComponentSchema>>(id: EntityId, def: D): boolean;
  createQuery<const C extends readonly ComponentDef[]>(
    components: C,
    _precomputedKey?: string,
  ): Query<C>;
  /**
   * @deprecated For systems, use {@link createQuery} and iterate by chunk.
   * The signature is unchanged. This method does not warn.
   */
  createLiveQuery<const C extends readonly ComponentDef[]>(
    components: C,
    _precomputedKey?: string,
  ): LiveQuery<EntityAccessor<C>>;
  getPlacementBridge(): PlacementBridge;

  // ─── Config ──────────────────────────────────────────────────────────────
  readonly variant: "light" | "physics2d" | "physics3d";
  readonly debug: boolean;
  readonly maxEntities: number;
  readonly targetFPS: number;
  readonly maxDeltaSeconds: number;
  /**
   * Global time multiplier applied to every frame's delta time.
   *
   * - `1` — normal speed (default)
   * - `0` — paused (all systems receive `dt = 0`)
   * - `0.5` — half speed (slow motion)
   * - `2` — double speed
   *
   * Clamped to `[0, 100]` at runtime — values outside this range are silently
   * clamped. Applied after the `maxDeltaSeconds` safety cap.
   *
   * @example
   * ```ts
   * // Bullet time
   * engine.timeScale = 0.2
   * // Resume
   * engine.timeScale = 1
   * // Pause
   * engine.timeScale = 0
   * ```
   */
  timeScale: number;

  // ─── Disposables (concrete type for internal use) ─────────────────────────
  /**
   * Named LIFO registry of engine-level disposables.
   * Typed as `DisposableRegistry` (concrete class) here; exposed as
   * `DisposableRegistryBase` via `GwenEngineBase` to plugin authors.
   */
  readonly disposables: DisposableRegistry;

  // ─── Stats ───────────────────────────────────────────────────────────────
  /** Scaled simulation dt in seconds, after the maxDeltaSeconds cap and timeScale. */
  readonly deltaTime: number;
  /** Uncapped, unscaled wall-frame duration in seconds. */
  readonly rawFrameTime: number;
  readonly frameCount: number;
  /** Smoothed frames per second from the raw wall-frame duration. */
  getFPS(): number;
  getStats(): EngineStats;
}
