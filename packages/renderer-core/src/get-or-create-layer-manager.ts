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
import { GwenError } from "@gwenjs/schema";
import { RendererErrorCodes } from "./errors.js";
import { LayerManager } from "./layer-manager.js";

// Renderer stats are exposed by the shared LayerManager at runtime via
// `layerManager.getStats()`. This package does not attach renderer stats to
// `engine.getStats()` — type-augmenting EngineStats would imply runtime
// population that never happens.

/**
 * Return the shared {@link LayerManager} for this engine instance, creating it
 * if it does not yet exist.
 *
 * The first renderer plugin to call this function determines the `container`.
 * Subsequent plugins receive the same instance — their `container` argument is
 * ignored. Register all renderer plugins before calling `LayerManager.mount()`.
 *
 * The LayerManager is automatically bound to `engine.logger` so all renderer
 * warnings flow through the engine logger.
 *
 * @example
 * ```ts
 * import { definePlugin } from '@gwenjs/kit/plugin'
 * import { getOrCreateLayerManager } from '@gwenjs/renderer-core'
 *
 * export const CanvasRendererPlugin = definePlugin((opts?: { container?: HTMLElement }) => ({
 *   name: 'renderer:canvas',
 *   setup(engine) {
 *     const manager = getOrCreateLayerManager(engine, opts?.container ?? document.body)
 *     manager.register(canvasService)
 *     engine.hooks.hook('engine:init', () => manager.mount())
 *     engine.hooks.hook('engine:stop', () => manager.unregister('renderer:canvas'))
 *   },
 * }))
 * ```
 */
export function getOrCreateLayerManager(engine: GwenEngine, container: HTMLElement): LayerManager {
  const existing = engine.tryInject("layerManager");
  if (existing instanceof LayerManager) return existing;
  if (existing !== undefined) {
    throw new GwenError(
      RendererErrorCodes.FOREIGN_LAYER_MANAGER,
      "The provided layerManager is not a LayerManager from this package.",
      {
        composable: "getOrCreateLayerManager",
        hint: __GWEN_DEV__
          ? "Call getOrCreateLayerManager before providing layerManager, or provide the LayerManager this package created."
          : undefined,
      },
    );
  }

  const manager = new LayerManager(container, engine.logger.child("renderer-core"), engine);
  engine.provide("layerManager", manager);

  // Reset per-frame stats totals at the start of every tick.
  // Registered once (LayerManager is a singleton per engine) so multiple renderer
  // plugins calling getOrCreateLayerManager() do not double-register the hook.
  engine.hooks.hook("engine:tick", () => manager.beginFrame());

  return manager;
}
