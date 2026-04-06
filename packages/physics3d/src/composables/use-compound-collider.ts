/**
 * @file useCompoundCollider() — attaches multiple primitive shapes to the
 * current entity's rigid body as a single compound collider.
 *
 * ## Why use a compound collider instead of a trimesh on a dynamic body?
 *
 * Rapier3D runs narrowphase tests on every (body, collider) pair per frame.
 * A trimesh with 1 000 triangles costs O(1 000) tests per contact pair.
 * A compound body with 8 primitive shapes costs O(8) — roughly **125× faster**
 * at equivalent visual fidelity for most game objects.
 *
 * > **Warning:** Do _not_ use trimesh colliders on dynamic rigid bodies.
 * > Trimesh shapes are only stable on static/fixed bodies. For dynamic objects
 * > (cars, robots, characters) always compose primitive shapes with
 * > `useCompoundCollider`.
 */
import type { CompoundColliderHandle3D, CompoundColliderOptions3D } from '../types';
import { usePhysics3D } from '../composables';
import { _getActorEntityId } from '@gwenjs/core/scene';
import type { EntityId } from '@gwenjs/core';

export type { CompoundColliderOptions3D };

/**
 * Attach multiple primitive colliders to the current entity's rigid body.
 *
 * Must be called after {@link useStaticBody} or {@link useDynamicBody} has
 * registered a body for this entity, inside a `defineActor` callback.
 *
 * In WASM mode all shapes are sent in a **single round-trip** via the
 * `physics3d_add_compound_collider` batch binding — there is no per-shape
 * overhead for large compound bodies.
 *
 * In local-simulation mode (no WASM available) each shape is inserted
 * individually via the standard collider pipeline.
 *
 * @param options - Ordered list of primitive shapes and optional shared
 *   layer/mask configuration.
 * @returns A {@link CompoundColliderHandle3D} containing stable IDs for each
 *   shape (in `options.shapes` order) and a `remove()` method that detaches
 *   all shapes at once.
 * @throws {Error} If the current entity has no registered rigid body.
 * @throws {GwenPluginNotFoundError} If `@gwenjs/physics3d` is not registered.
 *
 * @example
 * ```typescript
 * // Car chassis (box) + 4 sphere wheels — one compound body
 * const CarActor = defineActor(CarPrefab, () => {
 *   useDynamicBody({ mass: 1200 })
 *   useCompoundCollider({
 *     shapes: [
 *       { type: 'box', halfX: 1.0, halfY: 0.3, halfZ: 2.0, offsetY: 0.3 },       // chassis
 *       { type: 'sphere', radius: 0.35, offsetX: -0.9, offsetZ:  1.6 },           // wheel FL
 *       { type: 'sphere', radius: 0.35, offsetX:  0.9, offsetZ:  1.6 },           // wheel FR
 *       { type: 'sphere', radius: 0.35, offsetX: -0.9, offsetZ: -1.6 },           // wheel RL
 *       { type: 'sphere', radius: 0.35, offsetX:  0.9, offsetZ: -1.6 },           // wheel RR
 *     ],
 *   })
 * })
 * ```
 *
 * @example
 * ```typescript
 * // Robot with a capsule torso and two box arms
 * const RobotActor = defineActor(RobotPrefab, () => {
 *   useDynamicBody({ mass: 80 })
 *   const compound = useCompoundCollider({
 *     shapes: [
 *       { type: 'capsule', radius: 0.2, halfHeight: 0.5 },                        // torso
 *       { type: 'box', halfX: 0.1, halfY: 0.4, halfZ: 0.1, offsetX: -0.35 },    // left arm
 *       { type: 'box', halfX: 0.1, halfY: 0.4, halfZ: 0.1, offsetX:  0.35 },    // right arm
 *     ],
 *   })
 *   // compound.colliderIds → [id0, id1, id2]
 *   // compound.remove()   → detaches all 3 shapes
 * })
 * ```
 *
 * @since 1.0.0
 */
export function useCompoundCollider(options: CompoundColliderOptions3D): CompoundColliderHandle3D {
  const physics = usePhysics3D();
  const entityId = _getActorEntityId() as unknown as EntityId;

  const handle = physics.addCompoundCollider(entityId, options);
  if (!handle) {
    throw new Error(
      '[GWEN:useCompoundCollider] No rigid body found for this entity. ' +
        'Call useDynamicBody() or useStaticBody() before useCompoundCollider().',
    );
  }

  return handle;
}
