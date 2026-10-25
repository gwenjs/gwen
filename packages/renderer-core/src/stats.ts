/**
 * @file Renderer stats collection.
 *
 * Stats are only active when `enabled` is true (set by LayerManager when
 * `__GWEN_DEV__ && engine.debug` is truthy). Production builds omit that
 * gate, so the hot path stays inactive unless a caller enables stats itself.
 */

import type {
  RendererLayerStats,
  RendererRendererStats,
  RendererStats,
  RendererStatsCollector,
} from "@gwenjs/schema";

export type {
  RendererLayerStats,
  RendererRendererStats,
  RendererStats,
  RendererStatsCollector,
} from "@gwenjs/schema";

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
    // are NOT reset here. They accumulate across all renderers within a single frame.
    // LayerManager.beginFrame() resets them once per tick before any renderer reports.
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
