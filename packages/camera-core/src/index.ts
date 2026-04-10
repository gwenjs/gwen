// packages/camera-core/src/index.ts
/**
 * @file Public API for `@gwenjs/camera-core`.
 *
 * @example
 * ```ts
 * import {
 *   Camera,
 *   FollowTarget,
 *   CameraShake,
 *   CameraCorePlugin,
 *   CameraErrorCodes,
 *   cameraViewportMap,
 *   cameraPathStore,
 * } from '@gwenjs/camera-core'
 * ```
 */

// Error codes and classes
export {
  CameraErrorCodes,
  type CameraErrorCode,
  CameraViewportNotFoundError,
  CameraEmptyPathError,
} from "./errors.js";

// Shared value types
export type {
  EasingName,
  CameraWaypoint,
  PathOpts,
  CameraPathData,
  BlendOpts,
  FollowOpts,
  ShakeOpts,
  ShakeHandle,
} from "./types.js";

// ECS components
export { Camera, FollowTarget, CameraBounds, CameraShake, CameraPath } from "./components.js";

// Side-car stores (consumed by camera2d and camera3d handles)
export { cameraViewportMap } from "./camera-viewport-map.js";
export { cameraPathStore } from "./camera-path-store.js";

// System and plugin
export { CameraSystem } from "./camera-system.js";
export { CameraCorePlugin } from "./camera-core-plugin.js";

// ── GwenRuntimeHooks augmentation — camera:* hooks ───────────────────────────
// viewport:* hooks are declared in @gwenjs/renderer-core.
import type {} from "@gwenjs/core";

declare module "@gwenjs/core" {
  interface GwenRuntimeHooks {
    /**
     * Fired the first time a camera becomes active on a viewport.
     * Not fired again until the camera is deactivated and a new one activates.
     */
    "camera:activate": (payload: { viewportId: string; entityId: number }) => void;
    /**
     * Fired when the previously active camera on a viewport loses its active state
     * and no replacement camera is found for that frame.
     */
    "camera:deactivate": (payload: { viewportId: string }) => void;
    /**
     * Fired when the active camera on a viewport changes from one entity to another.
     * Not fired on initial activation — use `camera:activate` for that.
     */
    "camera:switch": (payload: { viewportId: string; from: number; to: number }) => void;
  }
}
