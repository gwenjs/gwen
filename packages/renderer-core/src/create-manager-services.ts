/**
 * @file createManagerServices — one viewport, camera and layer manager per call.
 *
 * `gwen:viewports` calls this, then `engine.provide`s the three keys.
 * This function does not provide anything.
 */

import type { GwenEngine } from "@gwenjs/core";
import type { LayerHost } from "@gwenjs/schema";
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
  readonly layerManager: LayerHost;
} {
  const viewportManager = createViewportManager(engine);
  const cameraManager = new CameraManagerImpl();
  const layerManager = new LayerManager(undefined, engine.logger.child("renderer-core"), engine);
  engine.hooks.hook("engine:tick", () => {
    layerManager.beginFrame();
  });
  return { viewportManager, cameraManager, layerManager };
}
