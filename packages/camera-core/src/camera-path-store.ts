// packages/camera-core/src/camera-path-store.ts
/**
 * @file cameraPathStore — maps camera EntityId to its active CameraPathData.
 *
 * CameraPath waypoints are objects — they cannot live in SoA buffers. This Map
 * holds the full path data alongside the lightweight CameraPath ECS component.
 *
 * Lifecycle:
 * - `set` is called by Camera*Handle.playPath().
 * - `delete` is called by Camera*Handle.playPath() when overwriting, or when the
 *   camera entity is destroyed (onCleanup).
 * - `CameraSystem` reads + mutates `elapsed` each frame to advance the path.
 */

import type { EntityId } from "@gwenjs/core";
import type { CameraPathData } from "./types.js";

export const cameraPathStore = new Map<EntityId, CameraPathData>();
