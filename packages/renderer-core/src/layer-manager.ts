/**
 * @file LayerManager — orders and mounts renderer DOM elements.
 *
 * LayerManager is the single authority over DOM structure. It collects layers
 * from all registered renderers, sorts them by `order`, and mounts the resulting
 * elements into the provided root container. It also propagates resize events
 * and validates contract versions.
 */

import { createLogger } from "@gwenjs/core";
import type { GwenEngine } from "@gwenjs/core";
import { GwenError, type IGwenLogger as GwenLogger } from "@gwenjs/schema";
import {
  EmptyLayersError,
  LayerOrderConflictError,
  RendererAlreadyRegisteredError,
  RendererContractVersionError,
  RendererErrorCodes,
  SurfaceInvalidError,
} from "./errors.js";
import type { RendererService, RenderView, SurfaceRendererService } from "./types.js";
import { RENDERER_CONTRACT_VERSION } from "./types.js";
import { RendererStatsCollectorImpl, createRendererStats } from "./stats.js";
import type { RendererStats } from "./stats.js";
import { writeCameraViews } from "./write-camera-views.js";

interface RegisteredRenderer {
  service: RendererService;
  collector: RendererStatsCollectorImpl;
  /** True only after `mount()` has run for this registration. */
  mounted: boolean;
}

/**
 * Manages the lifecycle and DOM ordering of all registered renderer plugins.
 *
 * @example
 * ```ts
 * const manager = new LayerManager(document.getElementById('gwen-root')!)
 * manager.register(canvasService)
 * manager.register(htmlService)
 * manager.mount()        // call once after all renderers are registered
 * manager.resize(800, 600, 1)
 * ```
 */
function isSurfaceRenderer(service: RendererService): service is SurfaceRendererService {
  return service.kind === "surface";
}

/** True for any element that carries inline style, an HTML element or an SVG one, from any realm. */
function hasInlineStyle(element: Element): element is Element & ElementCSSInlineStyle {
  return "style" in element;
}

/** The message of a thrown value, whatever it is. */
function describeFailure(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function makeRenderView(): RenderView {
  return {
    viewportId: "",
    eye: "none",
    viewMatrix: new Float32Array(16),
    projectionMatrix: new Float32Array(16),
    pixelRect: { x: 0, y: 0, width: 0, height: 0 },
  };
}

export class LayerManager {
  private _root: HTMLElement | undefined;
  private readonly _log: GwenLogger;
  private readonly _engine: GwenEngine | undefined;
  private readonly _renderers = new Map<string, RegisteredRenderer>();
  private readonly _stats: RendererStats = createRendererStats();
  private readonly _views: RenderView[] = [];
  private readonly _frameViews: RenderView[] = [];
  private _debugEnabled = false;
  private _unhookRender: (() => void) | undefined;
  /** True once `mount()` ran with a root: a renderer registered now is mounted at once. */
  private _live = false;
  /** The last `resize()` arguments, replayed to a renderer mounted afterwards. */
  private _lastSize: readonly [number, number, number] | undefined;

  constructor(root?: HTMLElement, logger?: GwenLogger, engine?: GwenEngine) {
    this._root = root;
    this._log = logger ?? createLogger("renderer-core:layer-manager");
    this._engine = engine;
    if (engine !== undefined) {
      this._unhookRender = engine.hooks.hook("engine:render", () => {
        this._renderSurfaceViews();
      });
    }
  }

  /**
   * Store `root` when none is stored yet. A later call keeps the first root.
   */
  bindRoot(root: HTMLElement): void {
    if (this._root !== undefined) return;
    this._root = root;
  }

  /**
   * Remove the `engine:render` hook, then unregister every renderer: each one is
   * unmounted and its DOM nodes are removed. A renderer whose `unmount()` throws is
   * logged and the others are still released.
   */
  dispose(): void {
    this._unhookRender?.();
    this._unhookRender = undefined;
    this._live = false;
    for (const name of this._renderers.keys()) {
      try {
        this.unregister(name);
      } catch (error) {
        this._log.error(`Renderer "${name}" failed to unmount: ${describeFailure(error)}`);
      }
    }
  }

  /**
   * Reset per-frame global totals and per-renderer stats for the new frame.
   * Called automatically by the render host (`gwen:viewports`) at the start of every
   * tick via `engine.hooks.hook('engine:tick', ...)`. Plugin authors do not need
   * to call this manually.
   *
   * When stats are disabled this is a no-op.
   */
  beginFrame(): void {
    if (!this._debugEnabled) return;
    this._stats.totalRenderTimeMs = 0;
    this._stats.totalDrawCalls = 0;
    this._stats.totalEntitiesRendered = 0;
    for (const { collector } of this._renderers.values()) {
      collector.beginFrame();
    }
  }

  /**
   * Enable stats collection for all current and future renderers.
   * Called by the render host when `__GWEN_DEV__ && engine.debug`.
   */
  enableStats(): void {
    this._debugEnabled = true;
    for (const { collector } of this._renderers.values()) {
      collector.enable();
    }
  }

  /**
   * Register a renderer service. Validates the contract version and checks for
   * duplicate names. Before {@link mount} it mounts nothing. After {@link mount}
   * it mounts the renderer at once and sends it the last {@link resize}.
   *
   * @throws {RendererAlreadyRegisteredError} If a renderer with the same name is already registered.
   * @throws {RendererContractVersionError}   If the renderer's contractVersion mismatches.
   * @throws {EmptyLayersError}               If the renderer declares zero layers.
   * @throws {SurfaceInvalidError}            If a surface renderer does not have one world layer.
   * @throws {LayerOrderConflictError}        If a surface layer shares an order with another layer.
   */
  register(service: RendererService): void {
    if (this._renderers.has(service.name)) {
      throw new RendererAlreadyRegisteredError(service.name);
    }

    if (Object.keys(service.layers).length === 0) {
      throw new EmptyLayersError(service.name);
    }

    if (service.contractVersion !== RENDERER_CONTRACT_VERSION) {
      throw new RendererContractVersionError(
        service.name,
        service.contractVersion,
        RENDERER_CONTRACT_VERSION,
      );
    }

    if (service.kind === "surface") {
      this._assertSurfaceLayers(service);
    }

    this._checkOrderConflicts(service);

    const collector = new RendererStatsCollectorImpl(service.name, this._stats);
    if (this._debugEnabled) collector.enable();

    const entry: RegisteredRenderer = { service, collector, mounted: false };
    this._renderers.set(service.name, entry);
    if (this._live) this._mountOne(entry);
  }

  /**
   * Mount the registered renderers that are not mounted yet into the root container.
   * A second call mounts nothing twice. A renderer whose `mount()` throws is reported
   * on `engine.errors` and unregistered; the others are still mounted.
   * With no root bound it does nothing.
   */
  mount(): void {
    const root = this._root;
    if (root === undefined) return;
    root.style.position = "relative";
    this._live = true;
    for (const renderer of this._renderers.values()) {
      if (renderer.mounted) continue;
      this._mountOne(renderer);
    }
  }

  /**
   * Propagate a viewport resize to all registered renderers.
   * @param width  - New width in CSS pixels.
   * @param height - New height in CSS pixels.
   * @param dpr    - Device pixel ratio forwarded to each renderer. Omitted forwards `1`.
   */
  resize(width: number, height: number, dpr = 1): void {
    this._lastSize = [width, height, dpr];
    for (const { service } of this._renderers.values()) {
      service.resize(width, height, dpr);
    }
  }

  /**
   * Unregister a renderer by name. Calls unmount() and removes its DOM elements.
   * Safe to call with an unknown name.
   * @param rendererName - The `name` property of the RendererService to remove.
   */
  unregister(rendererName: string): void {
    const renderer = this._renderers.get(rendererName);
    if (!renderer) return;
    try {
      renderer.service.unmount();
    } finally {
      this._removeNodes(rendererName);
      this._renderers.delete(rendererName);
    }
  }

  /** Return the current stats snapshot. Only populated when stats are enabled. */
  getStats(): RendererStats {
    return this._stats;
  }

  /** `true` when a renderer with this name is registered. */
  has(name: string): boolean {
    return this._renderers.has(name);
  }

  /**
   * Write `{ x: factor.x, y: factor.y }` onto each registered renderer's own
   * `layers[layer]` object. That object is mutated in place and is shared by
   * every holder, including another renderer or another engine given the same
   * `LayerDef`. A frozen `LayerDef` throws `TypeError`.
   * @throws {GwenError} `RENDERER:UNKNOWN_LAYER` when no registered renderer
   * declares `layer`. When `__GWEN_DEV__` is on, the hint lists the registered
   * renderer names.
   */
  setParallax(layer: string, factor: { x: number; y: number }): void {
    let found = false;
    for (const { service } of this._renderers.values()) {
      const def = service.layers[layer];
      if (def === undefined) continue;
      found = true;
      def.parallax = { x: factor.x, y: factor.y };
    }
    if (!found) {
      const registered = [...this._renderers.keys()];
      const listed = registered.length === 0 ? "none" : registered.join(", ");
      throw new GwenError(
        RendererErrorCodes.UNKNOWN_LAYER,
        `No registered renderer declares layer "${layer}".`,
        {
          composable: "setParallax",
          hint: __GWEN_DEV__ ? `Registered renderers: ${listed}.` : undefined,
        },
      );
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  /**
   * Place a layer element, call `mount()`, place the surface canvas and replay the last
   * size. A throw is reported and the renderer is unregistered.
   */
  private _mountOne(renderer: RegisteredRenderer): void {
    const root = this._root;
    if (root === undefined) return;
    const service = renderer.service;
    const layers = this._sortedLayers(renderer);
    try {
      if (service.kind !== "surface") {
        for (const { layerName, layerDef } of layers)
          this._placeLayer(renderer, layerName, layerDef);
      }
      service.mount(root);
      if (this._debugEnabled && service.setStatsCollector) {
        service.setStatsCollector(renderer.collector);
      }
      if (service.kind === "surface") {
        // A surface canvas does not exist until that renderer's mount().
        for (const { layerName, layerDef } of layers)
          this._placeLayer(renderer, layerName, layerDef);
      }
      if (this._lastSize !== undefined) service.resize(...this._lastSize);
      renderer.mounted = true;
    } catch (error) {
      this._reportMountFailure(service.name, error);
      try {
        this.unregister(service.name);
      } catch (unmountError) {
        this._log.error(
          `Renderer "${service.name}" failed to unmount after a failed mount: ${describeFailure(unmountError)}`,
        );
      }
    }
  }

  /** Put a failed mount on `engine.errors`. A thrown `GwenError` keeps its own code. */
  private _reportMountFailure(rendererName: string, error: unknown): void {
    const code = error instanceof GwenError ? error.code : RendererErrorCodes.MOUNT_FAILED;
    const message = `Renderer "${rendererName}" failed to mount and was unregistered: ${describeFailure(error)}`;
    this._log.error(message);
    this._engine?.errors.emit({
      level: "error",
      code,
      message,
      source: "@gwenjs/renderer-core",
      error,
      context: { renderer: rendererName },
      target: { kind: "plugin", id: "gwen:viewports", name: "gwen:viewports" },
    });
  }

  private _removeNodes(rendererName: string): void {
    const root = this._root;
    if (root === undefined) return;
    // Remove all DOM elements belonging to this renderer
    const toRemove = Array.from(root.querySelectorAll(`[data-gwen-layer^="${rendererName}:"]`));
    for (const el of toRemove) el.remove();
  }

  private _placeLayer(
    renderer: RegisteredRenderer,
    layerName: string,
    layerDef: { order: number; coordinate?: "world" | "screen" },
  ): void {
    const el = renderer.service.getLayerElement(layerName);
    el.style.position = "absolute";
    el.style.inset = "0";
    el.style.zIndex = String(layerDef.order);
    el.setAttribute("data-gwen-layer", `${renderer.service.name}:${layerName}`);
    // Passthrough pointer events for overlay (screen-space) layers to avoid blocking gameplay input
    if (layerDef.coordinate !== "world") {
      el.style.pointerEvents = "none";
    }
    const root = this._root;
    if (root === undefined) return;
    let before: Element | null = null;
    for (const child of root.children) {
      const z = hasInlineStyle(child) ? Number.parseInt(child.style.zIndex, 10) : Number.NaN;
      if (Number.isFinite(z) && z > layerDef.order) {
        before = child;
        break;
      }
    }
    root.insertBefore(el, before);
  }

  /**
   * LayerManager calls `renderViews` once per `engine:render` for each mounted surface,
   * with `engine.frame.alpha` of that display frame.
   */
  private _renderSurfaceViews(): void {
    const engine = this._engine;
    if (engine === undefined) return;
    let hasMountedSurface = false;
    for (const renderer of this._renderers.values()) {
      if (renderer.mounted && renderer.service.kind === "surface") {
        hasMountedSurface = true;
        break;
      }
    }
    if (!hasMountedSurface) return;

    let count = writeCameraViews(engine, this._views);
    if (count > this._views.length) {
      while (this._views.length < count) this._views.push(makeRenderView());
      count = writeCameraViews(engine, this._views);
    }
    this._frameViews.length = count;
    for (let index = 0; index < count; index += 1) {
      const view = this._views[index];
      if (view !== undefined) this._frameViews[index] = view;
    }
    const alpha = engine.frame.alpha;
    for (const renderer of this._renderers.values()) {
      if (!renderer.mounted || !isSurfaceRenderer(renderer.service)) continue;
      renderer.service.renderViews(this._frameViews, alpha);
    }
  }

  /** The layers of one renderer, sorted by `order`. */
  private _sortedLayers(renderer: RegisteredRenderer): Array<{
    layerName: string;
    layerDef: { order: number; coordinate?: "world" | "screen" };
  }> {
    const result: Array<{
      layerName: string;
      layerDef: { order: number; coordinate?: "world" | "screen" };
    }> = [];
    for (const [layerName, layerDef] of Object.entries(renderer.service.layers)) {
      if (layerDef !== undefined) result.push({ layerName, layerDef });
    }
    return result.sort((a, b) => a.layerDef.order - b.layerDef.order);
  }

  private _assertSurfaceLayers(service: RendererService): void {
    const entries = Object.entries(service.layers).filter((entry) => entry[1] !== undefined);
    const only = entries.length === 1 ? entries[0] : undefined;
    if (only === undefined || only[1].coordinate !== "world") {
      throw new SurfaceInvalidError(service.name);
    }
  }

  private _checkOrderConflicts(incoming: RendererService): void {
    const incomingOrders = new Map<number, string>();
    const warnedIncoming = new Set<number>();
    const incomingSurface = incoming.kind === "surface";

    for (const [name, def] of Object.entries(incoming.layers)) {
      if (def === undefined) continue;
      const existing = incomingOrders.get(def.order);
      if (existing !== undefined) {
        if (incomingSurface) {
          throw new LayerOrderConflictError(
            `${incoming.name}:${existing}`,
            `${incoming.name}:${name}`,
            def.order,
          );
        }
        if (!warnedIncoming.has(def.order)) {
          this._log.warn(
            `[${RendererErrorCodes.LAYER_ORDER_CONFLICT}] ` +
              `Layer order conflict within "${incoming.name}": ` +
              `"${existing}" and "${name}" both use order ${def.order}. ` +
              `Adjust one layer's order to silence this warning.`,
          );
          warnedIncoming.add(def.order);
        }
        continue;
      }
      incomingOrders.set(def.order, name);
    }

    for (const { service } of this._renderers.values()) {
      const otherSurface = service.kind === "surface";
      for (const [layerName, layerDef] of Object.entries(service.layers)) {
        if (layerDef === undefined) continue;
        const incomingLayerName = incomingOrders.get(layerDef.order);
        if (incomingLayerName === undefined) continue;
        if (incomingSurface || otherSurface) {
          throw new LayerOrderConflictError(
            `${service.name}:${layerName}`,
            `${incoming.name}:${incomingLayerName}`,
            layerDef.order,
          );
        } else {
          this._log.warn(
            `[${RendererErrorCodes.LAYER_ORDER_CONFLICT}] ` +
              `Layer order conflict: "${service.name}:${layerName}" and ` +
              `"${incoming.name}:${incomingLayerName}" both use order ${layerDef.order}. ` +
              `Rendering in registration order. Adjust one layer's order to silence this warning.`,
          );
        }
      }
    }
  }
}
