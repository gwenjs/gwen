/**
 * Transform3D — built-in 3D spatial component.
 *
 * Serialized as STRIDE 48 in the shared WASM transform buffer:
 * - `position` : vec3 (12 B) — world position in metres
 * - `rotation` : quat (16 B) — unit quaternion; identity = (0, 0, 0, 1)
 * - `scale`    : vec3 (12 B) — per-axis scale; default = (1, 1, 1)
 * - `flags`    : u32  ( 4 B) — internal WASM flags
 * - padding    :      ( 4 B) — 16-byte alignment
 *
 * @example
 * ```ts
 * import { Transform3D } from '@gwenjs/core';
 * import type { InferComponent } from '@gwenjs/core';
 *
 * type T3D = InferComponent<typeof Transform3D>;
 * // { position: { x, y, z }, rotation: { x, y, z, w }, scale: { x, y, z } }
 *
 * api.component.set(entityId, Transform3D, {
 *   position: { x: 0, y: 1, z: -5 },
 *   rotation: { x: 0, y: 0, z: 0, w: 1 },
 *   scale:    { x: 1, y: 1, z: 1 },
 * });
 * ```
 */

import { defineComponent, Types } from '../schema.js';

/**
 * Byte offsets for fields within a single 3D transform buffer slot (stride = 48).
 *
 * Use these with `DataView.getFloat32(base + TRANSFORM_OFFSETS.X, true)` for
 * zero-copy access to the WASM shared transform buffer.
 */
export const TRANSFORM_OFFSETS = {
  X: 0,
  Y: 4,
  Z: 8,
  QX: 12,
  QY: 16,
  QZ: 20,
  QW: 24,
  SCALE_X: 28,
  SCALE_Y: 32,
  SCALE_Z: 36,
  FLAGS: 40,
} as const;

export const Transform3D = defineComponent({
  name: 'Transform3D',
  schema: {
    position: Types.vec3,
    rotation: Types.quat,
    scale: Types.vec3,
  },
  defaults: {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
  },
});

/**
 * Read-only accessor helpers for the 3D transform WASM buffer.
 *
 * These bypass the ECS component layer and read directly from the
 * shared memory layout for hot-path rendering/physics use-cases.
 *
 * @param view   DataView over the 3D transform buffer region.
 * @param slot   Raw entity slot index.
 * @param stride Byte stride per slot — use `TRANSFORM3D_STRIDE` (48).
 */
export function readTransform3DPosition(
  view: DataView,
  slot: number,
  stride: number,
): { x: number; y: number; z: number } {
  const base = slot * stride;
  return {
    x: view.getFloat32(base + 0, true),
    y: view.getFloat32(base + 4, true),
    z: view.getFloat32(base + 8, true),
  };
}

export function readTransform3DRotation(
  view: DataView,
  slot: number,
  stride: number,
): { x: number; y: number; z: number; w: number } {
  const base = slot * stride;
  return {
    x: view.getFloat32(base + 12, true),
    y: view.getFloat32(base + 16, true),
    z: view.getFloat32(base + 20, true),
    w: view.getFloat32(base + 24, true),
  };
}

export function readTransform3DScale(
  view: DataView,
  slot: number,
  stride: number,
): { x: number; y: number; z: number } {
  const base = slot * stride;
  return {
    x: view.getFloat32(base + 28, true),
    y: view.getFloat32(base + 32, true),
    z: view.getFloat32(base + 36, true),
  };
}

export function writeTransform3DPosition(
  view: DataView,
  slot: number,
  stride: number,
  x: number,
  y: number,
  z: number,
): void {
  const base = slot * stride;
  view.setFloat32(base + 0, x, true);
  view.setFloat32(base + 4, y, true);
  view.setFloat32(base + 8, z, true);
}

export function writeTransform3DRotation(
  view: DataView,
  slot: number,
  stride: number,
  x: number,
  y: number,
  z: number,
  w: number,
): void {
  const base = slot * stride;
  view.setFloat32(base + 12, x, true);
  view.setFloat32(base + 16, y, true);
  view.setFloat32(base + 20, z, true);
  view.setFloat32(base + 24, w, true);
}

export function writeTransform3DScale(
  view: DataView,
  slot: number,
  stride: number,
  x: number,
  y: number,
  z: number,
): void {
  const base = slot * stride;
  view.setFloat32(base + 28, x, true);
  view.setFloat32(base + 32, y, true);
  view.setFloat32(base + 36, z, true);
}
