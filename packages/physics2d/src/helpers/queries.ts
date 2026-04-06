import type { EntityId } from '@gwenjs/core';
import type { Physics2DAPI, PhysicsEntitySnapshot } from '../types';

/**
 * Read a compact read-only snapshot of one physics body.
 *
 * @param physics - Physics2D service instance (`api.services.get('physics')`).
 * @param entityId - Packed EntityId of the entity.
 * @returns A {@link PhysicsEntitySnapshot} with nullable `position` and `velocity`.
 */
export function getBodySnapshot(physics: Physics2DAPI, entityId: EntityId): PhysicsEntitySnapshot {
  return {
    entityId,
    position: physics.getPosition(entityId),
    velocity: physics.getLinearVelocity(entityId),
  };
}

/**
 * Check whether a sensor is currently active for a given entity.
 *
 * @param physics - Physics2D service instance.
 * @param entityId - Packed EntityId.
 * @param sensorId - Stable numeric sensor identifier (e.g. `SENSOR_ID_FOOT`).
 */
export function isSensorActive(
  physics: Physics2DAPI,
  entityId: EntityId,
  sensorId: number,
): boolean {
  return physics.getSensorState(entityId, sensorId).isActive;
}

/**
 * Compute the scalar speed of a physics body (m/s).
 *
 * @param physics - Physics2D service instance.
 * @param entityId - Packed EntityId.
 */
export function getSpeed(physics: Physics2DAPI, entityId: EntityId): number {
  const vel = physics.getLinearVelocity(entityId);
  if (!vel) return 0;
  return Math.hypot(vel.x, vel.y);
}
