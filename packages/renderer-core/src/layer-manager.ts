/**
 * @file LayerManager — orders and mounts renderer DOM elements.
 *
 * LayerManager is the single authority over DOM structure. It collects layers
 * from all registered renderers, sorts them by `order`, and mounts the resulting
 * elements into the provided root container. It also propagates resize events
 * and validates contract versions.
 */

import { createLogger } from "@gwenjs/core";
import type { IGwenLogger as GwenLogger } from "@gwenjs/schema";
import {
  EmptyLayersError,
  LayerOrderConflictError,
  RendererAlreadyRegisteredError,
  RendererContractVersionError,
  RendererErrorCodes,
  SurfaceInvalidError,
} from "./errors.js";
import type { RendererService } from "./types.js";
import { RENDERER_CONTRACT_VERSION } from "./types.js";
import { RendererStatsCollectorImpl, createRendererStats } from "./stats.js";
import type { RendererStats } from "./stats.js";

interface RegisteredRenderer {
  service: RendererService;
  collector: RendererStatsCollectorImpl;
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
 * manager.resize(800, 600)
 * ```
 */
export class LayerManager {
  private readonly _root: HTMLElement;
  private readonly _log: GwenLogger;
  private readonly _renderers = new Map<string, RegisteredRenderer>();
  private readonly _stats: RendererStats = createRendererStats();
  private _debugEnabled = false;

  constructor(root: HTMLElement, logger?: GwenLogger) {
    this._root = root;
    this._log = logger ?? createLogger("renderer-core:layer-manager", false);
  }

  /**
   * Reset per-frame global totals and per-renderer stats for the new frame.
   * Called automatically by {@link getOrCreateLayerManager} at the start of every
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
   * Called by the renderer-core plugin when `import.meta.env.DEV || engine.debug`.
   */
  enableStats(): void {
    this._debugEnabled = true;
    for (const { collector } of this._renderers.values()) {
      collector.enable();
    }
  }

  /**
   * Register a renderer service. Validates the contract version and checks for
   * duplicate names. Does not mount DOM elements — call {@link mount} separately.
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

    this._renderers.set(service.name, { service, collector });
  }

  /**
   * Mount all registered renderers into the root container.
   * Sorts layers by `order` and inserts DOM elements in that order.
   * Should be called once after all renderers are registered.
   */
  mount(): void {
    this._root.style.position = "relative";

    // Collect all (renderer, layerName, layerDef) tuples sorted by order
    const allLayers = this._collectSortedLayers();

    for (const { renderer, layerName, layerDef } of allLayers) {
      const el = renderer.service.getLayerElement(layerName);
      el.style.position = "absolute";
      el.style.inset = "0";
      el.style.zIndex = String(layerDef.order);
      el.setAttribute("data-gwen-layer", `${renderer.service.name}:${layerName}`);
      // Passthrough pointer events for overlay (screen-space) layers to avoid blocking gameplay input
      if (layerDef.coordinate !== "world") {
        el.style.pointerEvents = "none";
      }
      this._root.appendChild(el);
    }

    // Call mount() on each renderer after DOM is ready
    for (const renderer of this._renderers.values()) {
      renderer.service.mount(this._root);
      if (this._debugEnabled && renderer.service.setStatsCollector) {
        renderer.service.setStatsCollector(renderer.collector);
      }
    }
  }

  /**
   * Propagate a viewport resize to all registered renderers.
   * @param width  - New width in CSS pixels.
   * @param height - New height in CSS pixels.
   */
  resize(width: number, height: number): void {
    for (const { service } of this._renderers.values()) {
      service.resize(width, height);
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
    renderer.service.unmount();
    // Remove all DOM elements belonging to this renderer
    const toRemove = Array.from(
      this._root.querySelectorAll(`[data-gwen-layer^="${rendererName}:"]`),
    );
    for (const el of toRemove) el.remove();
    this._renderers.delete(rendererName);
  }

  /** Return the current stats snapshot. Only populated when stats are enabled. */
  getStats(): RendererStats {
    return this._stats;
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  private _collectSortedLayers(): Array<{
    renderer: RegisteredRenderer;
    layerName: string;
    layerDef: { order: number; coordinate?: "world" | "screen" };
  }> {
    const result: Array<{
      renderer: RegisteredRenderer;
      layerName: string;
      layerDef: { order: number; coordinate?: "world" | "screen" };
    }> = [];

    for (const renderer of this._renderers.values()) {
      for (const [layerName, layerDef] of Object.entries(renderer.service.layers)) {
        if (layerDef !== undefined) {
          result.push({ renderer, layerName, layerDef });
        }
      }
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
