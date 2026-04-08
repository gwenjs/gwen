/**
 * @file defineRendererService — ergonomic factory for RendererService implementations.
 *
 * Handles all boilerplate automatically:
 * - contractVersion injection
 * - DOM element creation and caching per layer
 * - UnknownLayerError on undeclared layers
 * - setStatsCollector wiring (no-op until LayerManager enables stats)
 */

import { RENDERER_CONTRACT_VERSION } from "./types.js";
import type { RendererService, LayerDef } from "./types.js";
import { UnknownLayerError } from "./errors.js";
import type { RendererLayerStats, RendererStatsCollector } from "./stats.js";

// ─── Public types ─────────────────────────────────────────────────────────────

/** Context passed to the `mount` callback. */
export interface RendererMountContext {
  /** The root container the LayerManager mounted into. */
  container: HTMLElement;
  /** Returns the cached DOM element for a declared layer. */
  getLayer(name: string): HTMLElement;
}

/** Stats context passed to the `flush` callback. No-op when stats are disabled. */
export interface RendererFlushContext {
  /** Report total wall-clock time for this render call. */
  reportFrameTime(ms: number): void;
  /** Report per-layer stats (draw calls, entity count, DOM nodes…). */
  reportLayer(layerName: string, stats: Partial<RendererLayerStats>): void;
}

/**
 * Definition object passed to `defineRendererService`.
 * Describes what the renderer does — boilerplate is handled for you.
 */
export interface RendererServiceDef {
  /** Unique renderer identifier. Must match the `GwenProvides` key. */
  name: string;
  /** Layer declarations. Keys are layer names, values define order and coordinate space. */
  layers: Record<string, LayerDef>;
  /**
   * Called once per declared layer to create its DOM element.
   * The result is cached — subsequent `getLayerElement()` calls return the same element.
   */
  createElement(layerName: string): HTMLElement;
  /** Called after all layer elements have been inserted into the DOM. */
  mount(ctx: RendererMountContext): void;
  /** Called when the renderer is unregistered. Must release all resources. */
  unmount(): void;
  /** Called on viewport resize. */
  resize(width: number, height: number): void;
  /**
   * Called each frame from the plugin's `onRender` hook via `service.flush()`.
   * Use `ctx.reportFrameTime` and `ctx.reportLayer` to report stats — they are
   * no-ops when stats are disabled, so no guard is needed.
   */
  flush?(ctx: RendererFlushContext): void;
}

/** A fully-wired RendererService with an additional `flush()` method for frame rendering. */
export type ManagedRendererService = RendererService & {
  /**
   * Trigger the renderer's frame render. Call from the plugin's `onRender` hook.
   * Passes a stats context — no-op when stats are disabled.
   */
  flush(): void;
};

// ─── Implementation ───────────────────────────────────────────────────────────

/**
 * Define a renderer service factory.
 *
 * Returns a function that accepts your options and produces a fully-wired
 * `RendererService`. Handles contract version, element caching,
 * `UnknownLayerError`, and stats collector wiring automatically.
 *
 * @example
 * ```ts
 * export const MyTechRenderer = defineRendererService<{ layers: Record<string, LayerDef> }>(
 *   (opts) => ({
 *     name: 'renderer:mytech',
 *     layers: opts.layers,
 *
 *     createElement(layerName) {
 *       return document.createElement('canvas')
 *     },
 *
 *     mount({ getLayer }) {
 *       const canvas = getLayer('game') as HTMLCanvasElement
 *       renderer = new MyTech({ canvas })
 *     },
 *
 *     unmount() { renderer?.dispose() },
 *     resize(w, h) { renderer?.setSize(w, h) },
 *
 *     flush({ reportFrameTime }) {
 *       const t = performance.now()
 *       renderer?.render()
 *       reportFrameTime(performance.now() - t)
 *     },
 *   })
 * )
 *
 * // In the plugin:
 * const service = MyTechRenderer({ layers: { game: { order: 10 } } })
 * ```
 */
export function defineRendererService<Options>(
  factory: (opts: Options) => RendererServiceDef,
): (opts: Options) => ManagedRendererService {
  return (opts: Options): ManagedRendererService => {
    const def = factory(opts);
    const elementCache = new Map<string, HTMLElement>();
    let collector: RendererStatsCollector | undefined;

    const flushCtx: RendererFlushContext = {
      reportFrameTime: (ms) => collector?.reportFrameTime(ms),
      reportLayer: (name, stats) => collector?.reportLayer(name, stats),
    };

    return {
      name: def.name,
      contractVersion: RENDERER_CONTRACT_VERSION,
      layers: def.layers,

      getLayerElement(layerName: string): HTMLElement {
        if (!(layerName in def.layers)) {
          throw new UnknownLayerError(layerName, def.name);
        }
        let el = elementCache.get(layerName);
        if (!el) {
          el = def.createElement(layerName);
          elementCache.set(layerName, el);
        }
        return el;
      },

      mount(container: HTMLElement): void {
        def.mount({
          container,
          getLayer: (name) => {
            if (!(name in def.layers)) throw new UnknownLayerError(name, def.name);
            return elementCache.get(name)!;
          },
        });
      },

      unmount(): void {
        def.unmount();
        elementCache.clear();
        collector = undefined;
      },

      resize(width: number, height: number): void {
        def.resize(width, height);
      },

      setStatsCollector(c: RendererStatsCollector): void {
        collector = c;
      },

      flush(): void {
        def.flush?.(flushCtx);
      },
    };
  };
}
