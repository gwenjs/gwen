/**
 * STUB. One module-global map pair. The engine argument is ignored.
 */

import type { EntityId, GwenEngine } from "@gwenjs/core";
import { CameraEmptyPathError } from "./errors.js";
import type { CameraPathData } from "./types.js";

const viewports = new Map<EntityId, string>();
const paths = new Map<EntityId, CameraPathData>();

export function setCameraViewport(
  _engine: GwenEngine,
  cameraId: EntityId,
  viewportId: string,
): void {
  viewports.set(cameraId, viewportId);
}

export function getCameraViewport(_engine: GwenEngine, cameraId: EntityId): string | undefined {
  return viewports.get(cameraId);
}

export function setCameraPath(_engine: GwenEngine, cameraId: EntityId, path: CameraPathData): void {
  if (path.waypoints.length === 0) {
    throw new CameraEmptyPathError();
  }
  paths.set(cameraId, path);
}

export function getCameraPath(
  _engine: GwenEngine,
  cameraId: EntityId,
): CameraPathData | undefined {
  return paths.get(cameraId);
}

export function clearCameraPath(_engine: GwenEngine, cameraId: EntityId): void {
  paths.delete(cameraId);
}
