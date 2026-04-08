/**
 * @file Renderer stats collection.
 *
 * Stats are only active when `enabled` is true (set by LayerManager when
 * `import.meta.env.DEV || engine.debug` is truthy). In production builds
 * without debug mode, all calls are no-ops and Vite tree-shakes the hot path.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

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
 * Full renderer stats snapshot — augments EngineStats via declaration merging.
 * Available from `engine.getStats().renderers` when stats are enabled.
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

/** Creates a fresh, zero-initialised RendererStats object. */
export function createRendererStats(): RendererStats {
  return {
    renderers: {},
    totalRenderTimeMs: 0,
    totalDrawCalls: 0,
    totalEntitiesRendered: 0,
    history: {
      frameTimeMs: new Float32Array(60),
      drawCalls: new Uint32Array(60),
      head: 0,
    },
  };
}

// ─── Collector ───────────────────────────────────────────────────────────────

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

/** @internal Concrete implementation used by LayerManager. */
export class RendererStatsCollectorImpl implements RendererStatsCollector {
  private _enabled = false;
  private readonly _rendererName: string;
  private readonly _stats: RendererStats;
  private _currentFrameDrawCalls = 0;

  constructor(rendererName: string, stats: RendererStats) {
    this._rendererName = rendererName;
    this._stats = stats;
  }

  /** Enable stats collection. Called by LayerManager when debug mode is active. */
  enable(): void {
    this._enabled = true;
    if (!this._stats.renderers[this._rendererName]) {
      this._stats.renderers[this._rendererName] = {
        type: this._rendererName.replace("renderer:", ""),
        frameTimeMs: 0,
        layers: {},
      };
    }
  }

  /** Reset per-renderer data. Called by LayerManager at the start of each frame. */
  beginFrame(): void {
    if (!this._enabled) return;
    this._currentFrameDrawCalls = 0;
    const r = this._stats.renderers[this._rendererName];
    if (r) {
      r.frameTimeMs = 0;
      for (const layer of Object.values(r.layers)) {
        layer.drawCalls = 0;
        layer.entityCount = 0;
        layer.frameTimeMs = 0;
      }
    }
    // Note: global totals (totalDrawCalls, totalRenderTimeMs, totalEntitiesRendered)
    // are NOT reset here. They accumulate across all renderers per frame and must be
    // reset by the frame orchestrator (LayerManager) before any renderer reports.
  }

  reportLayer(layerName: string, partial: Partial<RendererLayerStats>): void {
    if (!this._enabled) return;
    const r = this._stats.renderers[this._rendererName];
    if (!r) return;
    const layer = r.layers[layerName];
    if (!layer) {
      r.layers[layerName] = {
        order: 0,
        coordinate: "screen",
        entityCount: 0,
        drawCalls: 0,
        domNodes: 0,
        visible: true,
        frameTimeMs: 0,
      };
    }
    Object.assign(r.layers[layerName]!, partial);
    this._currentFrameDrawCalls += partial.drawCalls ?? 0;
    this._stats.totalDrawCalls += partial.drawCalls ?? 0;
    this._stats.totalEntitiesRendered += partial.entityCount ?? 0;
  }

  reportFrameTime(ms: number): void {
    if (!this._enabled) return;
    const r = this._stats.renderers[this._rendererName];
    if (r) r.frameTimeMs = ms;
    this._stats.totalRenderTimeMs += ms;
    const { history } = this._stats;
    history.frameTimeMs[history.head] = ms;
    history.drawCalls[history.head] = this._currentFrameDrawCalls;
    history.head = (history.head + 1) % 60;
  }
}
