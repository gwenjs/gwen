// packages/renderer-core/src/camera-types.ts
/**
 * @file Shared camera and viewport type contracts.
 *
 * Consumed by camera-core, camera2d, camera3d, renderer-html, and renderer-webgl.
 * No runtime dependencies — types only.
 */

import type { Vec3 } from "@gwenjs/math";

/**
 * Position and orientation of a camera in world space.
 * For 2D cameras, z = 0 and rotation.x = rotation.y = 0.
 */
export interface WorldTransform {
  position: Vec3;
  /** Euler angles in radians. 2D cameras: only z (rotation) is used. */
  rotation: Vec3;
}

/**
 * How the world is projected onto the screen.
 *
 * `aspect` is intentionally absent — the renderer always derives it from the
 * viewport pixel dimensions at render time.
 */
export type CameraProjection =
  | {
      type: "orthographic";
      /** World units per pixel. 1 = 1 unit per pixel. @default 1 */
      zoom: number;
      /** Near clip plane. @default -1 */
      near: number;
      /** Far clip plane. @default 1 */
      far: number;
    }
  | {
      type: "perspective";
      /** Vertical field of view in radians. @default Math.PI / 3 */
      fov: number;
      /** Near clip plane. @default 0.1 */
      near: number;
      /** Far clip plane. @default 1000 */
      far: number;
    };

/**
 * Normalised screen region [0–1] that a viewport occupies.
 *
 * @example Full screen: `{ x: 0, y: 0, width: 1, height: 1 }`
 * @example Left half:   `{ x: 0, y: 0, width: 0.5, height: 1 }`
 */
export interface ViewportRegion {
  /** Left edge, 0–1. */
  x: number;
  /** Top edge, 0–1. */
  y: number;
  /** Width, 0–1. */
  width: number;
  /** Height, 0–1. */
  height: number;
}

/** A registered viewport: its id and current screen region. */
export interface ViewportContext {
  /** Unique string identifier, e.g. `'main'`, `'p1'`, `'minimap'`. */
  id: string;
  region: ViewportRegion;
}

/**
 * The complete camera state for one viewport, as written by `CameraSystem`
 * and read by renderers each frame.
 */
export interface CameraState {
  worldTransform: WorldTransform;
  projection: CameraProjection;
  /** Which viewport this camera is bound to. */
  viewportId: string;
  active: boolean;
  /**
   * When multiple cameras target the same viewport, the one with the highest
   * priority wins. Equal priority: last write wins.
   */
  priority: number;
}
