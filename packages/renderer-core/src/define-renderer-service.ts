/**
 * @file defineRendererService — ergonomic factory for RendererService implementations.
 *
 * Handles all boilerplate automatically:
 * - `contractVersion` injection
 * - DOM element creation and caching per layer
 * - `UnknownLayerError` on undeclared layers
 * - `setStatsCollector` wiring (`reportFrameTime`/`reportLayer` are no-ops until
 *   `LayerManager` enables stats)
 *
 * Renderer plugins that need to expose additional methods (e.g. `allocateHandle`
 * for composable use) can declare them in the `extension` field of the definition
 * object. They are merged into the returned `ManagedRendererService` instance and
 * reflected in the return type via the `TExtension` generic.
 *
 * Contract properties (`name`, `contractVersion`, `layers`, `getLayerElement`,
 * `mount`, `unmount`, `resize`, `setStatsCollector`, `flush`) always take
 * precedence and cannot be overridden via `extension`.
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
 *
 * Describes what the renderer does — boilerplate is handled for you. The optional
 * `extension` field lets you attach renderer-specific methods (e.g. `allocateHandle`)
 * that will be merged into the returned `ManagedRendererService` and reflected in
 * its TypeScript type via the `TExtension` generic.
 *
 * @typeParam TExtension - Shape of the additional methods/properties merged into
 *   the returned service. Defaults to `{}` (no extension).
 */
export interface RendererServiceDef<TExtension extends object = {}> {
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
  /**
   * Additional methods or properties to expose on the managed service instance.
   *
   * Use this when a renderer plugin needs to expose infrastructure for its
   * composables (e.g. `allocateHandle`) without reimplementing the full
   * `RendererService` boilerplate.
   *
   * The values are merged into the returned object before contract properties,
   * so contract keys (`name`, `contractVersion`, `layers`, `getLayerElement`,
   * `mount`, `unmount`, `resize`, `setStatsCollector`, `flush`) always win on
   * collision.
   *
   * @example
   * ```ts
   * export const MyRenderer = defineRendererService<
   *   MyOptions,
   *   { allocateHandle(layer: string, key: string): MyHandle }
   * >((opts) => {
   *   const layers = buildLayerMap(opts)
   *   return {
   *     name: 'renderer:my',
   *     layers: opts.layers,
   *     createElement: (name) => layers.get(name)!.element,
   *     mount: () => {},
   *     unmount: () => { layers.forEach((l) => l.destroy()) },
   *     resize: () => {},
   *     extension: {
   *       allocateHandle(layer, key) {
   *         return new MyHandle(layers.get(layer)!, key)
   *       },
   *     },
   *   }
   * })
   * ```
   */
  extension?: TExtension;
}

/**
 * A fully-wired `RendererService` with an additional `flush()` method for
 * frame rendering. Returned by `defineRendererService`.
 */
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
 * `ManagedRendererService`. Handles contract version, DOM element caching,
 * `UnknownLayerError`, and stats collector wiring automatically.
 *
 * ### Basic usage
 *
 * ```ts
 * export const MyTechRenderer = defineRendererService<MyTechOptions>((opts) => ({
 *   name: 'renderer:mytech',
 *   layers: opts.layers,
 *
 *   createElement(layerName) {
 *     return document.createElement('canvas')
 *   },
 *
 *   mount({ getLayer }) {
 *     const canvas = getLayer('game') as HTMLCanvasElement
 *     renderer = new MyTech({ canvas })
 *   },
 *
 *   unmount() { renderer?.dispose() },
 *   resize(w, h) { renderer?.setSize(w, h) },
 *
 *   flush({ reportFrameTime }) {
 *     const t = performance.now()
 *     renderer?.render()
 *     reportFrameTime(performance.now() - t)
 *   },
 * }))
 *
 * // In the plugin:
 * const service = MyTechRenderer({ layers: { game: { order: 10 } } })
 * ```
 *
 * ### Extending the service with renderer-specific methods
 *
 * Use the `extension` field when composables need to call renderer-internal
 * methods via `useService`. The extension type flows through to the return
 * type automatically — no `Object.assign`, no boilerplate reimplementation.
 *
 * ```ts
 * export type HTMLRendererService = ReturnType<typeof HTMLRenderer>
 *
 * export const HTMLRenderer = defineRendererService<
 *   HTMLOptions,
 *   { allocateHandle(layer: string, key: string): HTMLHandle }
 * >((opts) => {
 *   const htmlLayers = buildHTMLLayerMap(opts.layers)
 *
 *   return {
 *     name: 'renderer:html',
 *     layers: opts.layers,
 *     createElement: (name) => htmlLayers.get(name)!.element,
 *     mount: () => {},
 *     unmount: () => { htmlLayers.forEach((l) => l.element.remove()) },
 *     resize: () => {},
 *
 *     extension: {
 *       allocateHandle(layer, key) {
 *         const l = htmlLayers.get(layer)
 *         if (!l) throw new UnknownLayerError(layer, 'renderer:html')
 *         return new HTMLHandleImpl(l, key)
 *       },
 *     },
 *   }
 * })
 *
 * // In the composable:
 * export function useHTML(layerName: string): HTMLHandle {
 *   const service = useService('renderer:html') as HTMLRendererService
 *   const handle = service.allocateHandle(layerName, String(entityId))
 *   onDestroy(() => handle.unmount())
 *   return handle
 * }
 * ```
 *
 * @typeParam Options    - The options object accepted by the returned factory function.
 * @typeParam TExtension - Additional methods/properties merged into the returned service.
 *   Defaults to `{}`. Can be inferred when both generics are omitted.
 */
export function defineRendererService<Options, TExtension extends object = {}>(
  factory: (opts: Options) => RendererServiceDef<TExtension>,
): (opts: Options) => ManagedRendererService & TExtension {
  return (opts: Options): ManagedRendererService & TExtension => {
    const def = factory(opts);
    const elementCache = new Map<string, HTMLElement>();
    let collector: RendererStatsCollector | undefined;

    const flushCtx: RendererFlushContext = {
      reportFrameTime: (ms) => collector?.reportFrameTime(ms),
      reportLayer: (name, stats) => collector?.reportLayer(name, stats),
    };

    // Extension methods are spread first so that contract properties always win
    // on collision (name, contractVersion, layers, getLayerElement, mount, unmount,
    // resize, setStatsCollector, flush).
    return {
      ...(def.extension as TExtension),

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
    } as ManagedRendererService & TExtension;
  };
}
