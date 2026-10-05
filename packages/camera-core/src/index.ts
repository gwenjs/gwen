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
 * } from '@gwenjs/camera-core'
 * ```
 */

// Error codes and classes
export {
  CameraErrorCodes,
  type CameraErrorCode,
  CameraViewportNotFoundError,
  CameraEmptyPathError,
} from "./errors";

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
} from "./types";

// ECS components
export { Camera, FollowTarget, CameraBounds, CameraShake, CameraPath } from "./components";

// System and plugin
export { CameraSystem } from "./camera-system";
export { CameraCorePlugin } from "./camera-core-plugin";

export { OrthographicCameraPrefab, PerspectiveCameraPrefab } from "./camera-prefabs";
export { useCamera } from "./use-camera";
export type { Camera2DOpts, Camera3DOpts } from "./use-camera";
export type {
  CameraHandleBase,
  Camera2DHandle,
  Camera3DHandle,
  BoundsOpts2D,
  BoundsOpts3D,
} from "./camera-handle";

// XR cameras
export { XRCameraPrefab } from "./xr-camera-prefab";
export { useXRCamera } from "./use-xr-camera";
export type { XRCameraOpts } from "./use-xr-camera";
export type { XRViewData, XRCameraHandle } from "./xr-camera-handle";

// ── GwenRuntimeHooks augmentation — camera:* hooks ───────────────────────────
// viewport:* hooks are declared in @gwenjs/renderer-core.
import type { EntityId } from "@gwenjs/core";

declare module "@gwenjs/schema" {
  interface GwenRuntimeHooks {
    /**
     * Fired the first time a camera becomes active on a viewport.
     * Not fired again until the camera is deactivated and a new one activates.
     */
    "camera:activate": (payload: { viewportId: string; entityId: EntityId }) => void;
    /**
     * Fired when the previously active camera on a viewport loses its active state
     * and no replacement camera is found for that frame.
     */
    "camera:deactivate": (payload: { viewportId: string }) => void;
    /**
     * Fired when the active camera on a viewport changes from one entity to another.
     * Not fired on initial activation — use `camera:activate` for that.
     */
    "camera:switch": (payload: { viewportId: string; from: EntityId; to: EntityId }) => void;
  }
}
