/**
 * Movement helper utilities for the Physics3D plugin.
 *
 * All helpers are pure functions that operate on the public `Physics3DAPI` —
 * no direct WASM dependency.
 */

import type { EntityId } from '@gwenjs/core';
import type { Physics3DAPI, Physics3DVec3, Physics3DQuat } from '../types';

/**
 * Move a kinematic body by integrating velocity over delta time.
 *
 * Computes the new position as `currentPos + velocity * dt`, then calls
 * `setKinematicPosition`. Rotation is passed through unchanged unless
 * `currentRot` is explicitly provided.
 *
 * **No-op conditions:**
 * - `dt <= 0` or non-finite `dt`
 * - No body registered for the entity
 *
 * @param physics   - Physics3D service instance.
 * @param entityId  - Packed EntityId of the entity to move.
 * @param currentPos - Current world-space position in metres.
 * @param currentRot - Current orientation (pass-through to `setKinematicPosition`).
 * @param velocity  - Desired velocity vector in m/s.
 * @param deltaTime - Frame delta time in seconds. Must be positive.
 *
 * @example
 * ```ts
 * moveKinematicByVelocity(physics3d, entityId, pos, rot, { x: 5, y: 0, z: 0 }, dt);
 * ```
 */
export function moveKinematicByVelocity(
  physics: Physics3DAPI,
  entityId: EntityId,
  currentPos: Physics3DVec3,
  currentRot: Physics3DQuat,
  velocity: Physics3DVec3,
  deltaTime: number,
): void {
  if (!Number.isFinite(deltaTime) || deltaTime <= 0) return;
  physics.setKinematicPosition(
    entityId,
    {
      x: currentPos.x + velocity.x * deltaTime,
      y: currentPos.y + velocity.y * deltaTime,
      z: currentPos.z + velocity.z * deltaTime,
    },
    currentRot,
  );
}

/**
 * Apply an impulse in a given direction, normalizing the direction vector first.
 *
 * The `direction` vector is normalized internally before scaling by `magnitude`,
 * so callers can pass raw un-normalized vectors (e.g. joystick input or tile offsets).
 *
 * **No-op conditions:**
 * - `direction` is a zero vector or has non-finite components
 * - `magnitude` is `0` or non-finite
 *
 * @param physics   - Physics3D service instance.
 * @param entityId  - Packed EntityId of the entity.
 * @param direction - Direction vector. Will be normalized. Zero vector is ignored.
 * @param magnitude - Impulse magnitude in N·s.
 *
 * @example
 * ```ts
 * applyDirectionalImpulse(physics3d, entityId, { x: 0, y: 1, z: 0 }, JUMP_FORCE);
 * ```
 */
export function applyDirectionalImpulse(
  physics: Physics3DAPI,
  entityId: EntityId,
  direction: Physics3DVec3,
  magnitude: number,
): void {
  const len = Math.hypot(direction.x, direction.y, direction.z);
  if (len === 0 || !Number.isFinite(len) || !Number.isFinite(magnitude) || magnitude === 0) {
    return;
  }
  const nx = direction.x / len;
  const ny = direction.y / len;
  const nz = direction.z / len;
  physics.applyImpulse(entityId, { x: nx * magnitude, y: ny * magnitude, z: nz * magnitude });
}
