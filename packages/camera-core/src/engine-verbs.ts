/**
 * Public per-engine camera verbs.
 * Each call reads or writes the stores from `getCameraStores`.
 * `CameraSystem` and `useCamera` use those same stores.
 */

import type { GwenEngine } from "@gwenjs/core";
import type { EntityId } from "@gwenjs/schema";
import { getCameraStores } from "./camera-stores.js";
import { CameraEmptyPathError } from "./errors.js";
import type { CameraPathData } from "./types.js";

/** Bind `cameraId` to `viewportId` on `engine`. Does not check that the viewport exists. */
export function setCameraViewport(
  engine: GwenEngine,
  cameraId: EntityId,
  viewportId: string,
): void {
  getCameraStores(engine).viewports.set(cameraId, viewportId);
}

/** Viewport id bound to `cameraId` on `engine`, or `undefined` when none is bound. */
export function getCameraViewport(engine: GwenEngine, cameraId: EntityId): string | undefined {
  return getCameraStores(engine).viewports.get(cameraId);
}

/**
 * Store `path` on `engine` for `cameraId`, by reference.
 * Throws `CameraEmptyPathError` when `path.waypoints` is empty.
 */
export function setCameraPath(engine: GwenEngine, cameraId: EntityId, path: CameraPathData): void {
  if (path.waypoints.length === 0) {
    throw new CameraEmptyPathError();
  }
  getCameraStores(engine).paths.set(cameraId, path);
}

/** Path stored for `cameraId` on `engine`, or `undefined` when none is set. */
export function getCameraPath(engine: GwenEngine, cameraId: EntityId): CameraPathData | undefined {
  return getCameraStores(engine).paths.get(cameraId);
}

/** Drop the path stored for `cameraId` on `engine`. No path is a no-op. */
export function clearCameraPath(engine: GwenEngine, cameraId: EntityId): void {
  getCameraStores(engine).paths.delete(cameraId);
}
