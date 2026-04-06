/**
 * Query helper utilities for the Physics3D plugin.
 *
 * Convenience wrappers around `Physics3DAPI` for common read patterns.
 * All helpers are pure functions — no WASM dependency.
 */

import type { EntityId } from '@gwenjs/core';
import type { Physics3DAPI, Physics3DBodySnapshot } from '../types';

/**
 * Read a compact read-only snapshot of one 3D physics body.
 *
 * Returns `undefined` when the entity has no registered body.
 *
 * @param physics  - Physics3D service instance (`api.services.get('physics3d')`).
 * @param entityId - Packed EntityId of the entity.
 * @returns A {@link Physics3DBodySnapshot} with nullable `position`, `rotation`,
 *          `linearVelocity`, and `angularVelocity` fields.
 *
 * @example
 * ```ts
 * const snap = getBodySnapshot(physics3d, entityId);
 * if (snap) console.log(snap.position);
 * ```
 */
export function getBodySnapshot(
  physics: Physics3DAPI,
  entityId: EntityId,
): Physics3DBodySnapshot | undefined {
  return physics.getBodySnapshot(entityId);
}

/**
 * Compute the scalar linear speed of a 3D physics body in m/s.
 *
 * Returns `0` if no body is registered or linear velocity is unavailable.
 *
 * @param physics  - Physics3D service instance.
 * @param entityId - Packed EntityId.
 * @returns Speed in m/s as a non-negative scalar.
 *
 * @example
 * ```ts
 * const speed = getSpeed(physics3d, entityId);
 * if (speed > MAX_SPEED) physics3d.setLinearVelocity(entityId, { x: 0, y: 0, z: 0 });
 * ```
 */
export function getSpeed(physics: Physics3DAPI, entityId: EntityId): number {
  const vel = physics.getLinearVelocity(entityId);
  if (!vel) return 0;
  return Math.hypot(vel.x, vel.y, vel.z);
}

/**
 * Check whether a sensor is currently active for a given entity.
 *
 * @param physics  - Physics3D service instance.
 * @param entityId - Packed EntityId.
 * @param sensorId - Stable numeric sensor identifier (e.g. `SENSOR_ID_FOOT`).
 * @returns `true` when the sensor has at least one active contact.
 *
 * @example
 * ```ts
 * if (isSensorActive(physics3d, entityId, SENSOR_ID_FOOT)) {
 *   allowJump();
 * }
 * ```
 */
export function isSensorActive(
  physics: Physics3DAPI,
  entityId: EntityId,
  sensorId: number,
): boolean {
  return physics.getSensorState(entityId, sensorId).isActive;
}
