/**
 * @file getOrCreateLayerManager — read the layer service and bind its root.
 *
 * `gwen:viewports` creates the LayerManager. The first container passed here
 * is stored. A later call keeps that root.
 *
 * @example
 * ```ts
 * import { definePlugin } from '@gwenjs/kit/plugin'
 * import { getOrCreateLayerManager } from '@gwenjs/renderer-core'
 *
 * const canvasDefaults: { container?: HTMLElement } = {}
 *
 * export const CanvasRendererPlugin = definePlugin(
 *   { provides: [], options: { defaults: canvasDefaults } },
 *   (opts) => ({
 *     name: 'renderer:canvas',
 *     requires: { services: ['layerManager'] },
 *     setup(engine) {
 *       const manager = getOrCreateLayerManager(engine, opts.container ?? document.body)
 *       manager.register(canvasService)
 *       engine.hooks.hook('engine:init', () => manager.mount())
 *       engine.hooks.hook('engine:stop', () => manager.unregister('renderer:canvas'))
 *     },
 *   }),
 * )
 * ```
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
 * Read the shared {@link LayerManager} declared by `gwen:viewports` and bind
 * `container` when the manager has no root yet.
 *
 * The first call that finds an unbound manager stores `container`.
 * Later calls return the same instance and ignore `container`.
 *
 * Reads the service declared by gwen:viewports. Does not create it. Removal is #230 G2's.
 */
export function getOrCreateLayerManager(engine: GwenEngine, container: HTMLElement): LayerManager {
  const existing = engine.inject("layerManager");
  if (!(existing instanceof LayerManager)) {
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
  existing.bindRoot(container);
  return existing;
}
