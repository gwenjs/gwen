// packages/camera-core/src/types.ts
/**
 * @file Shared option types and value objects for camera-core, camera2d, camera3d.
 */

import type { EntityId } from "@gwenjs/core";
import type { Vec3 } from "@gwenjs/math";

/** Easing function names accepted by CameraWaypoint and BlendOpts. */
export type EasingName =
  | "linear"
  | "easeIn"
  | "easeOut"
  | "easeInOut"
  | "easeInQuad"
  | "easeOutQuad"
  | "easeInOutQuad"
  | "easeInCubic"
  | "easeOutCubic"
  | "easeInOutCubic";

/** A single waypoint on a camera travelling path. Shared by camera2d and camera3d. */
export interface CameraWaypoint {
  /** Target position. 2D cameras use z = 0. */
  position: Vec3;
  /** Target rotation in euler radians. 2D cameras use only z. */
  rotation?: Vec3;
  /**
   * If provided, overrides `rotation` — the camera orients toward this point/entity.
   * Only meaningful for 3D cameras.
   */
  lookAt?: Vec3 | EntityId; // Vec3 | EntityId (bigint branded)
  /** Target zoom (orthographic cameras). */
  zoom?: number;
  /** Target fov in radians (perspective cameras). */
  fov?: number;
  /** Transition duration in seconds. */
  duration: number;
  easing?: EasingName;
}

/** Options passed to `playPath()`. */
export interface PathOpts {
  loop?: boolean;
  onComplete?: () => void;
  onWaypoint?: (index: number) => void;
}

/** Runtime state for a camera path in progress — stored alongside the CameraPath component. */
export interface CameraPathData {
  waypoints: CameraWaypoint[];
  opts: PathOpts;
  /** Elapsed time in the current segment (seconds). */
  elapsed: number;
}

/** Options for blend transitions between cameras. */
export interface BlendOpts {
  duration: number;
  easing?: EasingName;
  onComplete?: () => void;
}

/** Options accepted by `useFollowTarget`. */
export interface FollowOpts {
  lerp?: number;
  offset?: Vec3;
  /** 3D only: auto-orient toward the target. */
  lookAt?: boolean;
}

/** Options accepted by `useShake`. */
export interface ShakeOpts {
  decay?: number;
  maxOffset?: Vec3;
}

/** Handle returned by `useShake`. */
export interface ShakeHandle {
  /** Add trauma [0–1]. Values accumulate up to 1, then decay each frame. */
  trauma(amount: number): void;
}
