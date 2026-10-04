/**
 * @file Engine public type contracts.
 *
 * Extracted from gwen-engine.ts — all interfaces and type-only constants
 * used by consumers of the GwenEngine API. These are erased at compile time
 * and have no impact on V8 inlining of the implementation in gwen-engine.ts.
 */

import type { Hookable } from "hookable";
import type { GwenRuntimeHooks } from "./runtime-hooks";
import type { IGwenLogger } from "@gwenjs/schema";
import type { WasmRegionView, WasmRingBuffer } from "./wasm-module-handle";
import type { EntityId } from "./engine-api";
import type { ComponentDefinition, ComponentSchema, InferComponent } from "../schema";
import type { ComponentDef, LiveQuery, EntityAccessor } from "../system/runtime/define-system";
import type {
  GwenPlugin,
  GwenEngineBase,
  GwenErrorBusBase,
  GwenErrorPayload,
} from "@gwenjs/schema";
import type { WasmBridgeImpl } from "./wasm-bridge";
import { DisposableRegistry } from "../disposable";

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
  readonly versionPolicy?: "warn" | "throw" | "ignore";
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
  policy: "warn" | "throw" | "ignore" = "warn",
): boolean {
  const versionFn = exports["gwen_plugin_api_version"];
  if (typeof versionFn !== "function") {
    return true; // No version export — old plugin, skip check
  }
  const actual = (versionFn as () => number)();
  if (actual === expectedVersion) {
    return true;
  }
  const msg = `[GWEN] Plugin "${moduleName}" was compiled against API version ${actual} but engine expects ${expectedVersion}.`;
  if (policy === "throw") {
    throw new Error(msg);
  }
  if (policy === "warn") {
    // eslint-disable-next-line no-console
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
  }): void;
  /** Register a listener for every event, including fatal. Runs before `onFatal`. */
  on(handler: (event: GwenErrorPayload) => void): void;
  /** Register a callback that runs after `on` handlers when the level is `fatal`. */
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
  variant?: "light" | "physics2d" | "physics3d";

  /**
   * Error bus for structured engine errors.
   * When omitted, `createEngine()` creates one with `createErrorBus()`.
   * Pass an instance to share a bus or register handlers before startup.
   * `createErrorBus()` is exported from `@gwenjs/core` and `@gwenjs/kit`.
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
   * When non-zero, `engine.start()` switches from a variable-dt loop to a
   * fixed-step accumulator loop. Each real frame accumulates elapsed time and
   * dispatches as many fixed-dt steps as needed to consume it.
   *
   * Set this to your physics simulation rate (e.g. `60` for 60 Hz). Systems
   * registered with `onUpdate` receive `1 / physicsHz` as `dt` regardless of
   * actual frame pacing.
   *
   * @default 0 (variable dt — standard game loop)
   * @see maxCatchupSteps
   */
  physicsHz?: number;

  /**
   * Maximum number of fixed simulation steps dispatched in a single real frame.
   *
   * Prevents the spiral-of-death: if the machine falls behind (e.g. tab
   * hidden), accumulated time is capped so the engine does not attempt to
   * catch up indefinitely.
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
export interface GwenEngine extends GwenEngineBase {
  // ─── Plugin runner ──────────────────────────────────────────────────────
  /** Register and initialise a plugin. Deduplicates by `plugin.name`. */
  use(plugin: GwenPlugin): Promise<void>;
  /** Tear down and unregister a plugin by name. Safe to call with unknown names. */
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

  // ─── Context ─────────────────────────────────────────────────────────────
  run<T>(fn: () => T): T;
  activate(): void;
  deactivate(): void;

  // ─── Lifecycle ───────────────────────────────────────────────────────────
  start(): Promise<void>;
  stop(): Promise<void>;
  startExternal(): Promise<void>;
  advance(dt: number): Promise<void>;

  // ─── WASM bridge ─────────────────────────────────────────────────────────
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
  loadWasmModule<Exports extends WebAssembly.Exports = WebAssembly.Exports>(
    options: WasmModuleOptions<Exports>,
  ): Promise<WasmModuleHandle<Exports>>;
  getWasmModule<Exports extends WebAssembly.Exports = WebAssembly.Exports>(
    name: string,
  ): WasmModuleHandle<Exports>;

  // ─── ECS ─────────────────────────────────────────────────────────────────
  createEntity(): EntityId;
  destroyEntity(id: EntityId): boolean;
  isAlive(id: EntityId): boolean;
  canSpawn(count: number): boolean;
  addComponent<D extends ComponentDefinition<ComponentSchema>>(
    id: EntityId,
    def: D,
    data: Partial<InferComponent<D>>,
  ): void;
  getComponent<D extends ComponentDefinition<ComponentSchema>>(
    id: EntityId,
    def: D,
  ): InferComponent<D> | undefined;
  hasComponent<D extends ComponentDefinition<ComponentSchema>>(id: EntityId, def: D): boolean;
  removeComponent<D extends ComponentDefinition<ComponentSchema>>(id: EntityId, def: D): boolean;
  createLiveQuery<T extends ComponentDef>(
    components: T[],
    _precomputedKey?: string,
  ): LiveQuery<EntityAccessor>;
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
  readonly deltaTime: number;
  readonly frameCount: number;
  getFPS(): number;
  getStats(): EngineStats;
}
