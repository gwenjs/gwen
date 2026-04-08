/**
 * @file getOrCreateLayerManager — lazy singleton factory.
 *
 * Renderer plugins call this function instead of `new LayerManager(root)`.
 * It creates the LayerManager on first call (bound to the engine's logger and
 * service registry), then returns the same instance on subsequent calls.
 *
 * This means the end user never has to install a separate RendererCorePlugin —
 * the wiring happens transparently when the first renderer plugin installs itself.
 */

import type { GwenEngine } from "@gwenjs/core";
import { LayerManager } from "./layer-manager.js";

/**
 * Return the shared {@link LayerManager} for this engine instance, creating it
 * if it does not yet exist.
 *
 * The first renderer plugin to call this function determines the `container`.
 * Subsequent plugins receive the same instance — their `container` argument is
 * ignored. Register all renderer plugins before calling `LayerManager.mount()`.
 *
 * The LayerManager is automatically bound to `engine.logger` so all renderer
 * warnings flow through the single engine log sink.
 *
 * @example
 * ```ts
 * import { definePlugin } from '@gwenjs/kit/plugin'
 * import { getOrCreateLayerManager } from '@gwenjs/renderer-core'
 *
 * export const CanvasRendererPlugin = definePlugin<{ container?: HTMLElement }>((opts) => ({
 *   name: 'renderer:canvas',
 *   setup(engine) {
 *     const manager = getOrCreateLayerManager(engine, opts.container ?? document.body)
 *     manager.register(canvasService)
 *     engine.onStart(() => manager.mount())
 *     engine.onDestroy(() => manager.unregister('renderer:canvas'))
 *   },
 * }))
 * ```
 */
export function getOrCreateLayerManager(engine: GwenEngine, container: HTMLElement): LayerManager {
  const existing = engine.tryInject("layerManager");
  if (existing) return existing;

  const manager = new LayerManager(container, engine.logger.child("renderer-core"));
  engine.provide("layerManager", manager);
  return manager;
}
