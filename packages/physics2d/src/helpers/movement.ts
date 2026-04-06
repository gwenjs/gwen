import type { EntityId } from '@gwenjs/core';
import type { Physics2DAPI } from '../types';

/**
 * Move a kinematic body by integrating velocity over delta time.
 *
 * Reads the current position via `getPosition`, computes the new position as
 * `pos + velocity * dt`, then calls `setKinematicPosition`. This is a
 * genre-agnostic primitive usable for top-down, shmup, or any other actor style.
 *
 * **No-op conditions:**
 * - `dt <= 0` or non-finite `dt`
 * - no body registered for the given slot
 *
 * @param physics - Physics2D service instance.
 * @param entityId - Packed EntityId of the entity to move.
 * @param velocity - Desired velocity vector in meters/second.
 * @param dt - Delta time in seconds. Must be positive.
 *
 * @example
 * ```ts
 * // In a top-down system:
 * moveKinematicByVelocity(physics, slot, { x: input.x * SPEED, y: input.y * SPEED }, dt);
 * ```
 */
export function moveKinematicByVelocity(
  physics: Physics2DAPI,
  entityId: EntityId,
  velocity: { x: number; y: number },
  dt: number,
): void {
  if (!Number.isFinite(dt) || dt <= 0) return;
  const pos = physics.getPosition(entityId);
  if (!pos) return;
  physics.setKinematicPosition(entityId, pos.x + velocity.x * dt, pos.y + velocity.y * dt);
}

/**
 * Apply an impulse in a given direction, normalizing the direction vector first.
 *
 * The `direction` vector is normalized internally before scaling by `magnitude`,
 * so callers can pass un-normalized input vectors (e.g. raw joystick or tile offsets).
 *
 * **No-op conditions:**
 * - `direction` is a zero vector
 * - `magnitude` is `0` or non-finite
 * - `direction` components are non-finite
 *
 * @param physics - Physics2D service instance.
 * @param entityId - Packed EntityId of the entity.
 * @param direction - Direction vector. Will be normalized. Zero vector is ignored.
 * @param magnitude - Impulse magnitude in N·s.
 *
 * @example
 * ```ts
 * // Knockback on hit:
 * applyDirectionalImpulse(physics, slot, { x: -1, y: 0.3 }, KNOCKBACK_FORCE);
 * ```
 */
export function applyDirectionalImpulse(
  physics: Physics2DAPI,
  entityId: EntityId,
  direction: { x: number; y: number },
  magnitude: number,
): void {
  const len = Math.hypot(direction.x, direction.y);
  if (len === 0 || !Number.isFinite(len) || !Number.isFinite(magnitude) || magnitude === 0) return;
  const nx = direction.x / len;
  const ny = direction.y / len;
  physics.applyImpulse(entityId, nx * magnitude, ny * magnitude);
}
