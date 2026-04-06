/**
 * @file RFC-009 — Composables for @gwenjs/physics2d.
 *
 * These composables must be called inside an active engine context:
 * - Inside `defineSystem()`
 * - Inside `engine.run(fn)`
 * - During a plugin lifecycle hook (setup, onUpdate, etc.)
 */

import { useEngine, GwenPluginNotFoundError } from '@gwenjs/core';
import type { EntityId } from '@gwenjs/core';
import type { Physics2DAPI } from './types';
// Side-effect import: augments GwenProvides with 'physics2d'
import './augment';

// ─── usePhysics2D ─────────────────────────────────────────────────────────────

/**
 * Returns the Physics 2D API service registered by `physics2dPlugin()`.
 *
 * Must be called inside an active engine context (inside `defineSystem()`,
 * `engine.run()`, or a plugin lifecycle hook).
 *
 * @returns The {@link Physics2DAPI} service instance.
 * @throws {GwenPluginNotFoundError} If `physics2dPlugin()` is not registered.
 *
 * @example
 * ```typescript
 * import { defineSystem, onUpdate } from '@gwenjs/core'
 * import { usePhysics2D } from '@gwenjs/physics2d'
 *
 * export const gravitySystem = defineSystem(() => {
 *   const physics = usePhysics2D()
 *
 *   onUpdate((dt) => {
 *     physics.applyImpulse(playerId, 0, -9.81 * dt)
 *   })
 * })
 * ```
 */
export function usePhysics2D(): Physics2DAPI {
  const engine = useEngine();

  // Try new RFC-001 provide/inject registry first.
  const newService = engine.tryInject('physics2d');
  if (newService) return newService;

  throw new GwenPluginNotFoundError({
    pluginName: '@gwenjs/physics2d',
    hint: 'Call engine.use(physics2dPlugin()) before starting the engine.',
    docsUrl: 'https://gwenengine.dev/plugins/physics2d',
  });
}

// ─── useRigidBody ─────────────────────────────────────────────────────────────

/**
 * Accesses the rigid body registered for `entityId`.
 * Returns the Physics 2D API so you can call rigid body methods directly.
 *
 * Must be called inside an active engine context.
 *
 * @param entityId - Entity whose rigid body you want to access.
 * @returns An object with the Physics2D API and the entity ID for convenience.
 * @throws {GwenPluginNotFoundError} If `physics2dPlugin()` is not registered.
 *
 * @example
 * ```typescript
 * export const moveSystem = defineSystem(() => {
 *   const rb = useRigidBody(playerId)
 *
 *   onUpdate((dt) => {
 *     rb.physics.applyImpulse(playerId, 100 * dt, 0)
 *   })
 * })
 * ```
 */
export function useRigidBody(entityId: EntityId): {
  entityId: EntityId;
  physics: Physics2DAPI;
} {
  const physics = usePhysics2D();
  return { entityId, physics };
}

// ─── useCollider ──────────────────────────────────────────────────────────────

/**
 * Accesses the Physics 2D API for managing a collider on `entityId`.
 *
 * Must be called inside an active engine context.
 *
 * @param entityId - Entity whose collider you want to interact with.
 * @returns An object with the Physics2D API and the entity ID for convenience.
 * @throws {GwenPluginNotFoundError} If `physics2dPlugin()` is not registered.
 *
 * @example
 * ```typescript
 * export const colliderSystem = defineSystem(() => {
 *   const col = useCollider(enemyId)
 *   onUpdate(() => {
 *     const hits = col.physics.queryAabb(x - 1, y - 1, x + 1, y + 1)
 *   })
 * })
 * ```
 */
export function useCollider(entityId: EntityId): {
  entityId: EntityId;
  physics: Physics2DAPI;
} {
  const physics = usePhysics2D();
  return { entityId, physics };
}
