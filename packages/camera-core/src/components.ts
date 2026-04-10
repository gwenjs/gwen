// packages/camera-core/src/components.ts
/**
 * @file ECS component definitions for the camera system.
 *
 * All SoA arrays are indexed by EntityId.
 * String data (viewportId) and object data (CameraPathData) live in separate
 * Maps — see camera-viewport-map.ts and camera-path-store.ts.
 */

import { defineComponent, Types } from "@gwenjs/core";

/**
 * Core camera component. One per camera entity.
 *
 * projectionType: 0 = orthographic, 1 = perspective
 * active: 0 = inactive, 1 = active
 *
 * The `viewportId` string is stored in `cameraViewportMap` (camera-viewport-map.ts),
 * not here — strings cannot live in SoA buffers.
 */
export const Camera = defineComponent({
  name: "Camera",
  schema: {
    active:         Types.u32,
    priority:       Types.f32,
    x:              Types.f32,
    y:              Types.f32,
    z:              Types.f32,
    rotX:           Types.f32,
    rotY:           Types.f32,
    rotZ:           Types.f32,
    projectionType: Types.u32,  // 0 = orthographic, 1 = perspective
    zoom:           Types.f32,  // orthographic
    fov:            Types.f32,  // perspective, radians
    near:           Types.f32,
    far:            Types.f32,
  },
});

/**
 * Follow-target behaviour. When present on a camera entity, `CameraSystem`
 * lerps the camera position toward the target entity's Camera x/y/z each frame.
 *
 * Mutually exclusive with `CameraPath` — adding FollowTarget removes CameraPath and vice versa.
 */
export const FollowTarget = defineComponent({
  name: "FollowTarget",
  schema: {
    entityId: Types.u32,
    lerp:     Types.f32,
    offsetX:  Types.f32,
    offsetY:  Types.f32,
    offsetZ:  Types.f32,
  },
});

/**
 * Spatial clamp. `CameraSystem` clamps `Camera.x/y/z` to [min, max] after
 * applying follow/path each frame.
 */
export const CameraBounds = defineComponent({
  name: "CameraBounds",
  schema: {
    minX: Types.f32,
    minY: Types.f32,
    minZ: Types.f32,
    maxX: Types.f32,
    maxY: Types.f32,
    maxZ: Types.f32,
  },
});

/**
 * Trauma-based screen shake.
 *
 * - `trauma` accumulates (clamped to [0,1]) and decays by `decay` per second.
 * - `CameraSystem` computes a shake offset each frame proportional to trauma²
 *   and adds it to the final `CameraState.worldTransform` **without** modifying
 *   `Camera.x/y/z` — so the underlying position remains stable.
 */
export const CameraShake = defineComponent({
  name: "CameraShake",
  schema: {
    trauma:  Types.f32,
    decay:   Types.f32,
    maxX:    Types.f32,
    maxY:    Types.f32,
  },
});

/**
 * Path-following behaviour. The actual waypoints and options are stored in
 * `cameraPathStore` (camera-path-store.ts). This component tracks position
 * in the path.
 *
 * Mutually exclusive with `FollowTarget`.
 */
export const CameraPath = defineComponent({
  name: "CameraPath",
  schema: {
    index:    Types.u32,
    progress: Types.f32,
  },
});
