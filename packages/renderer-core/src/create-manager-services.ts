/**
 * @file createManagerServices — one viewport, camera and layer manager per call.
 *
 * The render host (`gwen:viewports`) calls this, then `engine.provide`s the three keys.
 * This function does not provide anything. It is not a package export.
 */

import type { GwenEngine } from "@gwenjs/core";
import type { CameraManager } from "./camera-manager.js";
import { CameraManagerImpl } from "./camera-manager.js";
import { createViewportManager } from "./get-or-create-viewport-manager.js";
import { LayerManager } from "./layer-manager.js";
import type { ViewportManager } from "./viewport-manager.js";

/**
 * Create the three shared managers for one engine.
 * Registers `engine:tick` → {@link LayerManager.beginFrame} once.
 * The layer manager stays unbound until {@link LayerManager.bindRoot}.
 */
export function createManagerServices(engine: GwenEngine): {
  readonly viewportManager: ViewportManager;
  readonly cameraManager: CameraManager;
  readonly layerManager: LayerManager;
} {
  const viewportManager = createViewportManager(engine);
  const cameraManager = new CameraManagerImpl();
  const layerManager = new LayerManager(undefined, engine.logger.child("renderer-core"), engine);
  engine.hooks.hook("engine:tick", () => {
    layerManager.beginFrame();
  });
  return { viewportManager, cameraManager, layerManager };
}
