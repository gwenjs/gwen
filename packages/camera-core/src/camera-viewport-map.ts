// packages/camera-core/src/camera-viewport-map.ts
/**
 * @file cameraViewportMap — maps camera EntityId to its viewport id string.
 *
 * Strings cannot be stored in SoA components. This Map is the authoritative
 * source for which viewport a camera entity targets.
 *
 * Lifecycle:
 * - `set` is called by use2DCamera() / use3DCamera() at creation.
 * - `delete` is called inside the onCleanup() registered by use2DCamera() / use3DCamera().
 * - `CameraSystem` reads it each frame.
 */

import type { EntityId } from "@gwenjs/core";

export const cameraViewportMap = new Map<EntityId, string>();
