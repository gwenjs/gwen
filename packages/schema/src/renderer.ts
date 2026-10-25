/// <reference lib="dom" />
/**
 * @file Renderer service and host-manager contracts.
 *
 * Types, plus the two frozen constants. Implementations live in
 * `@gwenjs/renderer-core`. This module has no `@gwenjs/*` dependency.
 *
 * @module
 */

/** Current renderer contract version. Bump on a breaking change to {@link RendererService}. */
export const RENDERER_CONTRACT_VERSION = 2;

/** Column-major 4×4 matrix length used by {@link RenderView}. */
export const RENDER_VIEW_MATRIX_LENGTH = 16;

/**
 * Renderer kind.
 * Omitted on {@link RendererService} means `"layers"` (one DOM node per layer).
 */
export type RendererKind = "layers" | "surface";

/**
 * Declares a single named rendering slot within a renderer plugin.
 *
 * @example
 * ```ts
 * const layers = {
 *   background: { order: 0, coordinate: 'screen' },
 *   game:       { order: 10 },
 *   hud:        { order: 100, coordinate: 'screen' },
 * }
 * ```
 */
export interface LayerDef {
  /**
   * Rendering depth. Lower values render first (behind). Higher values render last (in front).
   * Must be unique across registered renderers. LayerManager warns on a conflict between
   * layer renderers. An equal order between a surface layer and any other layer throws
   * `RENDERER:LAYER_ORDER_CONFLICT`. A HUD layer must use a strictly greater order.
   */
  order: number;
  /**
   * Coordinate space for this layer.
   * - `'screen'` — positions are in CSS pixels relative to the viewport (default)
   * - `'world'`  — positions are in world units; the renderer must project them to screen space
   * @default 'screen'
   */
  coordinate?: "world" | "screen";
  /**
   * Whether this layer belongs to a specific viewport or is rendered globally.
   *
   * - `'viewport'` — the layer is instanced once per viewport and receives the
   *   corresponding camera transform. Default for `coordinate: 'world'` layers.
   * - `'global'` — the layer is mounted once for the entire screen (e.g. a HUD
   *   that sits above all viewports). Default for `coordinate: 'screen'` layers.
   *
   * @default `'viewport'` when `coordinate === 'world'`, `'global'` otherwise
   */
  scope?: "viewport" | "global";
  /**
   * Optional parallax factor. {@link LayerHost.setParallax} writes `{ x, y }` here.
   * Drawing with that factor is outside this contract.
   */
  parallax?: { readonly x: number; readonly y: number };
}

/**
 * One rendered view: a viewport camera or an XR eye.
 * Caller-owned and reused. `writeCameraViews` fills it and does not allocate a new one.
 */
export interface RenderView {
  /** Filled by `writeCameraViews`. The matrix and `pixelRect` objects stay put. */
  viewportId: string;
  /** Same union as `XRViewData.eye`. Non-XR views use `"none"`. */
  eye: "left" | "right" | "none";
  /** Length {@link RENDER_VIEW_MATRIX_LENGTH}, column-major, world → view. The buffer is reused, not replaced. */
  readonly viewMatrix: Float32Array;
  /** Length {@link RENDER_VIEW_MATRIX_LENGTH}, column-major. The buffer is reused, not replaced. */
  readonly projectionMatrix: Float32Array;
  /** Device pixels. Origin top-left. The object is reused, not replaced. */
  readonly pixelRect: { x: number; y: number; width: number; height: number };
}

/** Per-layer stats snapshot for one frame. */
export interface RendererLayerStats {
  /** Render depth (mirrors LayerDef.order). */
  order: number;
  /** Coordinate space (mirrors LayerDef.coordinate). */
  coordinate: "world" | "screen";
  /** Number of live entities contributing to this layer this frame. */
  entityCount: number;
  /** Number of GPU draw calls issued by this layer this frame (0 for HTML layers). */
  drawCalls: number;
  /** Number of active DOM nodes in this layer (0 for canvas/WebGL layers). */
  domNodes: number;
  /** Whether this layer is currently visible. */
  visible: boolean;
  /** Wall-clock time in ms spent flushing this layer this frame. */
  frameTimeMs: number;
}

/** Per-renderer stats snapshot. */
export interface RendererRendererStats {
  /** Renderer type string (e.g. `'html'`, `'canvas'`, `'webgl'`, `'r3f'`). */
  type: string;
  /** Total wall-clock time in ms spent in this renderer's onRender() this frame. */
  frameTimeMs: number;
  /** Per-layer breakdown. */
  layers: Record<string, RendererLayerStats>;
}

/**
 * Full renderer stats snapshot.
 * Available from `engine.inject('layerManager').getStats()` when stats are enabled.
 */
export interface RendererStats {
  /** Per-renderer breakdown. Keys are GwenProvides keys (e.g. `'renderer:canvas'`). */
  renderers: Record<string, RendererRendererStats>;
  /** Total wall-clock render time across all renderers this frame. */
  totalRenderTimeMs: number;
  /** Total GPU draw calls across all renderers this frame. */
  totalDrawCalls: number;
  /** Total entities rendered across all layers and renderers this frame. */
  totalEntitiesRendered: number;
  /**
   * Ring buffer history for the last 60 frames.
   * Use `head` to find the most-recently written slot: `history.frameTimeMs[(head - 1 + 60) % 60]`.
   */
  history: {
    /** Frame render time in ms for each of the last 60 frames. */
    frameTimeMs: Float32Array;
    /** Total draw calls for each of the last 60 frames. */
    drawCalls: Uint32Array;
    /** Index of the next slot to be written. Wraps at 60. */
    head: number;
  };
}

/**
 * Injected by LayerManager into each renderer after mount().
 * Renderers call these methods during their onRender() to report stats.
 */
export interface RendererStatsCollector {
  /**
   * Report stats for one layer. Partial — only provide the fields you measured.
   * @param layerName - The layer key as declared in RendererService.layers.
   * @param stats     - Partial layer stats for this frame.
   */
  reportLayer(layerName: string, stats: Partial<RendererLayerStats>): void;
  /**
   * Report total wall-clock time for this renderer's onRender() call.
   * Automatically advances the global ring-buffer head.
   * @param ms - Duration in milliseconds.
   */
  reportFrameTime(ms: number): void;
}

/**
 * The interface every GWEN renderer plugin must implement.
 *
 * Register the implementation via `engine.provide('renderer:<name>', service)`.
 * The LayerManager validates the contract version and mounts the DOM elements.
 *
 * A method `resize(width, height)` is assignable here: the third parameter may be omitted.
 *
 * @example
 * ```ts
 * class MyRendererService implements RendererService {
 *   readonly name = 'renderer:my'
 *   readonly contractVersion = RENDERER_CONTRACT_VERSION
 *   readonly layers = { game: { order: 10 } }
 *   mount(container: HTMLElement) { ... }
 *   unmount() { ... }
 *   resize(w: number, h: number, dpr: number) { ... }
 *   getLayerElement(name: string): HTMLElement { ... }
 * }
 * ```
 */
export interface RendererService {
  /** Unique key matching the GwenProvides declaration (e.g. `'renderer:canvas'`). */
  readonly name: string;
  /**
   * Must equal {@link RENDERER_CONTRACT_VERSION}.
   * LayerManager throws `RendererContractVersionError` on mismatch.
   */
  readonly contractVersion: number;
  /**
   * Omitted means `"layers"`. `"surface"` opts into {@link SurfaceRendererService}.
   */
  readonly kind?: RendererKind;
  /**
   * Named layers managed by this renderer. At least one layer is required.
   * Each entry becomes a DOM element mounted by LayerManager.
   */
  readonly layers: Readonly<Record<string, LayerDef>>;
  /**
   * Called by LayerManager after all layer DOM elements have been inserted into
   * the shared root container. The `container` argument is that shared root —
   * use it to read dimensions, attach resize observers, or initialise a WebGL
   * context that targets the full viewport.
   * @param container - The shared root container passed to LayerManager.
   */
  mount(container: HTMLElement): void;
  /** Called by LayerManager when the engine shuts down. Must free all resources. */
  unmount(): void;
  /**
   * Called by LayerManager whenever the game viewport is resized.
   * @param width  - New width in CSS pixels.
   * @param height - New height in CSS pixels.
   * @param dpr    - Device pixel ratio. A two-parameter implementation may ignore it.
   */
  resize(width: number, height: number, dpr: number): void;
  /**
   * Returns the DOM element for a named layer.
   * A {@link SurfaceRendererService} returns an `HTMLCanvasElement`.
   * Throws `UnknownLayerError` if `layerName` was not declared in `layers`.
   * @param layerName - A key from the `layers` record.
   */
  getLayerElement(layerName: string): HTMLElement;
  /**
   * Optional. Called by LayerManager after mount() to inject the stats collector.
   * When provided, the renderer should call `collector.reportLayer()` each frame.
   * Only called when `__GWEN_DEV__ && engine.debug` is true.
   */
  setStatsCollector?(collector: RendererStatsCollector): void;
}

/**
 * A renderer that owns exactly one drawing surface.
 * It creates that canvas in `mount` and removes it in `unmount`.
 */
export interface SurfaceRendererService extends RendererService {
  readonly kind: "surface";
  /** Exactly one entry, `coordinate: "world"` (keeps pointer events). */
  readonly layers: Readonly<Record<string, LayerDef>>;
  /** Canvas created by the renderer in `mount()`, removed in `unmount()`. */
  getLayerElement(layerName: string): HTMLCanvasElement;
  /**
   * Called by `LayerManager` once per `engine:render` after the surface is mounted.
   * `views` is the written prefix of the `writeCameraViews` buffer.
   * `alpha` is `1` until #79 supplies `engine.frame`.
   */
  renderViews(views: readonly RenderView[], alpha: number): void;
}

/** Structural 3-component vector. Schema does not depend on `@gwenjs/math`. */
export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/**
 * Position and orientation of a camera in world space.
 * For 2D cameras, z = 0 and rotation.x = rotation.y = 0.
 */
export interface WorldTransform {
  position: Vec3Like;
  /** Euler angles in radians, YXZ. 2D cameras: only z (rotation) is used. */
  rotation: Vec3Like;
}

/**
 * How the world is projected onto the screen.
 *
 * `aspect` is intentionally absent — the renderer always derives it from the
 * viewport pixel dimensions at render time.
 */
export type CameraProjection =
  | {
      type: "orthographic";
      /** World units per pixel. 1 = 1 unit per pixel. @default 1 */
      zoom: number;
      /** Near clip plane. @default -1 */
      near: number;
      /** Far clip plane. @default 1 */
      far: number;
    }
  | {
      type: "perspective";
      /** Vertical field of view in radians. @default Math.PI / 3 */
      fov: number;
      /** Near clip plane. @default 0.1 */
      near: number;
      /** Far clip plane. @default 1000 */
      far: number;
    };

/**
 * Normalised screen region [0–1] that a viewport occupies.
 *
 * @example Full screen: `{ x: 0, y: 0, width: 1, height: 1 }`
 * @example Left half:   `{ x: 0, y: 0, width: 0.5, height: 1 }`
 */
export interface ViewportRegion {
  /** Left edge, 0–1. */
  x: number;
  /** Top edge, 0–1. */
  y: number;
  /** Width, 0–1. */
  width: number;
  /** Height, 0–1. */
  height: number;
}

/** A registered viewport: its id and current screen region. */
export interface ViewportContext {
  /** Unique string identifier, e.g. `'main'`, `'p1'`, `'minimap'`. */
  id: string;
  region: ViewportRegion;
}

/**
 * The complete camera state for one viewport, as written by `CameraSystem`
 * and read by renderers each frame.
 */
export interface CameraState {
  worldTransform: WorldTransform;
  projection: CameraProjection;
  /** Which viewport this camera is bound to. */
  viewportId: string;
  active: boolean;
  /**
   * When multiple cameras target the same viewport, the one with the highest
   * priority wins. Equal priority: last write wins.
   */
  priority: number;
}

/**
 * Host that registers renderer services and reads their stats.
 * `@gwenjs/renderer-core` `LayerManager` implements this.
 */
export interface LayerHost {
  /** Register a renderer service. */
  register(service: RendererService): void;
  /** Unregister a renderer by its `name`. */
  unregister(name: string): void;
  /** `true` when a renderer with this `name` is registered. */
  has(name: string): boolean;
  /** Current renderer stats snapshot. */
  getStats(): RendererStats;
  /**
   * Write `{ x: factor.x, y: factor.y }` onto each registered renderer's own
   * `layers[layer]` object. That object is mutated in place and is shared by
   * every holder of it. A frozen object throws `TypeError`.
   * Throws `RENDERER:UNKNOWN_LAYER` when no registered renderer declares `layer`.
   */
  setParallax(layer: string, factor: { x: number; y: number }): void;
}

/**
 * Source of truth for the active camera state per viewport, updated each frame.
 *
 * @example
 * ```ts
 * const cameras = useCameraManager()
 * const state = cameras.get('main')
 * if (state?.active) { ... }
 * ```
 */
export interface CameraStateStore {
  /**
   * Write the camera state for a viewport. Respects priority:
   * if an existing state has strictly higher priority, this call is a no-op.
   */
  set(viewportId: string, state: CameraState): void;
  /** Read the current camera state for a viewport, or `undefined` if none. */
  get(viewportId: string): CameraState | undefined;
  /** All current states. The returned map is live — do not mutate it. */
  getAll(): ReadonlyMap<string, CameraState>;
  /**
   * Clear all states. Called by CameraSystem at the start of each frame before
   * writing new states so stale entries do not persist.
   */
  clearFrame(): void;
}

/**
 * Registry of named screen regions.
 *
 * @example
 * ```ts
 * const viewports = useViewportManager()
 * viewports.set('p1', { x: 0, y: 0, width: 0.5, height: 1 })
 * viewports.set('p2', { x: 0.5, y: 0, width: 0.5, height: 1 })
 * viewports.remove('main')
 * ```
 */
export interface ViewportStore {
  /**
   * Register or update a viewport. Emits `viewport:add` on first registration,
   * `viewport:resize` on update.
   */
  set(id: string, region: ViewportRegion): void;
  /** Remove a viewport. Emits `viewport:remove`. No-op for unknown ids. */
  remove(id: string): void;
  /** Read a viewport context, or `undefined` if not registered. */
  get(id: string): ViewportContext | undefined;
  /** All registered viewports. The returned map is live — do not mutate it. */
  getAll(): ReadonlyMap<string, ViewportContext>;
}

/**
 * Pixel dimensions of a named viewport.
 * Computed as `containerSize × normalizedRegion`, updated on container resize.
 */
export interface ViewportPixels {
  width: number;
  height: number;
}

/**
 * Axis-aligned world-space bounds for a viewport.
 * Valid for orthographic cameras without rotation.
 * External camera plugins extend this type with `declare module "@gwenjs/schema"`.
 *
 * @remarks
 * Populated by the registered {@link ViewportBoundsProvider} each frame (in `engine:afterTick`).
 * `undefined` when no provider is registered or when the provider returns `undefined`
 * (e.g. no active camera, unsupported projection type).
 */
export interface ViewportBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/**
 * The stable object returned by `useScreen()`.
 *
 * Mutated in place every frame — never recreated. Safe to capture in closures
 * and async callbacks. All consumers sharing the same viewport id get the same
 * object reference.
 *
 * @example
 * ```ts
 * const screen = useScreen('main')
 *
 * onUpdate(() => {
 *   // Clamp player to world bounds
 *   if (screen.bounds) {
 *     Position.x[id] = Math.max(screen.bounds.minX, Math.min(screen.bounds.maxX, Position.x[id]))
 *   }
 * })
 * ```
 */
export interface ViewportScreenInfo {
  /**
   * Pixel dimensions of this viewport (container width/height × normalized region).
   * Updated whenever the container resizes.
   */
  readonly pixels: ViewportPixels;
  /**
   * Device pixel ratio at last resize event.
   * Updated whenever the container resizes.
   */
  readonly dpr: number;
  /**
   * World-space bounds for this viewport.
   * Updated every frame in `engine:afterTick` by the registered `ViewportBoundsProvider`.
   * `undefined` if no bounds provider is installed or the provider returned `undefined`.
   */
  readonly bounds: ViewportBounds | undefined;
}

/**
 * Computes world-space bounds for a viewport given its pixel dimensions.
 *
 * Implemented by camera plugins (`camera-core`, `camera2d`, `camera3d`) and registered
 * via `getOrCreateScreenService(engine).registerBoundsProvider(provider)`.
 *
 * @example Orthographic implementation (camera-core)
 * ```ts
 * const provider: ViewportBoundsProvider = {
 *   compute(viewportId, pixelW, pixelH) {
 *     const cam = cameraManager.get(viewportId)
 *     if (!cam?.active || cam.projection.type !== 'orthographic') return undefined
 *     const ww = pixelW / cam.projection.zoom
 *     const wh = pixelH / cam.projection.zoom
 *     return {
 *       minX: cam.worldTransform.position.x - ww / 2,
 *       maxX: cam.worldTransform.position.x + ww / 2,
 *       minY: cam.worldTransform.position.y - wh / 2,
 *       maxY: cam.worldTransform.position.y + wh / 2,
 *     }
 *   }
 * }
 * ```
 */
export interface ViewportBoundsProvider {
  /**
   * Compute world-space bounds for the given viewport.
   *
   * @param viewportId - The viewport identifier (e.g. `'main'`).
   * @param pixelWidth - Current pixel width of the viewport.
   * @param pixelHeight - Current pixel height of the viewport.
   * @returns Bounds object, or `undefined` if bounds cannot be computed
   *   (no active camera, unsupported projection type, etc.).
   */
  compute(viewportId: string, pixelWidth: number, pixelHeight: number): ViewportBounds | undefined;
}

/**
 * Runtime interface for the screen service.
 * Accessible to plugin authors via `getOrCreateScreenService(engine)`.
 * Game code should use `useScreen()` instead.
 */
export interface ScreenInfoStore {
  /**
   * Register a bounds provider. Last registered wins.
   * Called by camera plugins during `setup(engine)`.
   */
  registerBoundsProvider(provider: ViewportBoundsProvider): void;

  /** Returns `true` if a bounds provider has been registered. */
  hasBoundsProvider(): boolean;

  /**
   * Compute bounds for a specific viewport on demand.
   * Primarily used in tests to verify provider behaviour.
   */
  computeBoundsFor(viewportId: string, pixelW: number, pixelH: number): ViewportBounds | undefined;

  /**
   * Update the container size and recalculate pixel dimensions for all tracked viewports.
   * Called by `ScreenPlugin` on container resize.
   *
   * @param width - New container width in CSS pixels.
   * @param height - New container height in CSS pixels.
   * @param dpr - Optional device pixel ratio. Omitted: {@link devicePixelRatio} stays unchanged.
   */
  setContainerSize(width: number, height: number, dpr?: number): void;

  /**
   * Device pixel ratio.
   * `1` before any `setContainerSize` call, then the `dpr` last passed.
   */
  readonly devicePixelRatio: number;

  /**
   * Return or create the stable `ViewportScreenInfo` for a viewport id.
   * Creates with zero dimensions if the viewport is not yet registered in `ViewportManager`
   * (optimistic — pixels are updated when `setContainerSize` is next called).
   */
  getOrCreateInfo(viewportId: string): ViewportScreenInfo;

  /**
   * Remove the cached info for a viewport. Called by `ScreenPlugin` on `viewport:remove`.
   * The removed info is no longer updated by `setContainerSize` or `computeAllBounds`.
   */
  removeViewport(viewportId: string): void;

  /**
   * Compute and mutate bounds in place for all tracked viewports.
   * Called once per frame by `ScreenPlugin` via `engine:afterTick`.
   */
  computeAllBounds(): void;
}
