// packages/renderer-core/src/get-or-create-camera-manager.ts
/**
 * @file getOrCreateCameraManager — read the camera service.
 *
 * `gwen:viewports` creates the manager. Plugin setup code reads it here.
 *
 * @example
 * ```ts
 * setup(engine) {
 *   const cameras = getOrCreateCameraManager(engine)
 * }
 * ```
 */

import type { GwenEngine } from "@gwenjs/core";
import type { CameraManager } from "./camera-manager.js";

/**
 * Read the shared {@link CameraManager} declared by `gwen:viewports`.
 *
 * Reads the service declared by gwen:viewports. Does not create it. Removal is #230 G2's.
 */
export function getOrCreateCameraManager(engine: GwenEngine): CameraManager {
  return engine.inject("cameraManager");
}
