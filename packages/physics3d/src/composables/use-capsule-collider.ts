/**
 * @file useCapsuleCollider() — attaches a capsule-shaped collider to the current entity.
 */
import type { CapsuleColliderHandle3D, Physics3DMaterialPreset } from '../types';
import { usePhysics3D } from '../composables';
import { _getActorEntityId } from '@gwenjs/core/scene';
import type { EntityId } from '@gwenjs/core';
import { nextColliderId } from './collider-id';

/**
 * Options for configuring a capsule-shaped 3D collider.
 */
export interface CapsuleColliderOptions3D {
  /** Capsule radius in metres. */
  radius: number;
  /**
   * Full height of the capsule cylinder in metres (half-extent = height / 2).
   * Does not include the two hemispherical end-caps.
   */
  height: number;
  /**
   * Primary axis of the capsule.
   * @default 'y'
   */
  axis?: 'x' | 'y' | 'z';
  /** Local-space X offset of the collider centre relative to the body origin. */
  offsetX?: number;
  /** Local-space Y offset of the collider centre relative to the body origin. */
  offsetY?: number;
  /** Local-space Z offset of the collider centre relative to the body origin. */
  offsetZ?: number;
  /** Mark as sensor — generates events but no physical response. @default false */
  isSensor?: boolean;
  /** Numeric collision layer bitmask (membership). */
  layer?: number;
  /** Numeric collision filter bitmask (which layers to collide with). */
  mask?: number;
  /** Built-in material preset controlling friction and restitution. @default 'default' */
  material?: Physics3DMaterialPreset;
}

/**
 * Attach a capsule-shaped collider to the current entity.
 *
 * A capsule is ideal for character controllers because it avoids snagging on
 * flat surfaces that boxes encounter at corners.
 *
 * Must be called after {@link useStaticBody} or {@link useDynamicBody} has
 * registered the body for this entity.
 *
 * @param options - Capsule dimensions and optional material/sensor/layer config.
 * @returns A {@link CapsuleColliderHandle3D} with a stable `colliderId` and a `remove()` method.
 * @throws {GwenPluginNotFoundError} If `@gwenjs/physics3d` is not registered.
 *
 * @example
 * ```typescript
 * const CharacterActor = defineActor(CharacterPrefab, () => {
 *   useDynamicBody({ mass: 80, linearDamping: 0.5 })
 *   useCapsuleCollider({ radius: 0.4, height: 1.8 })
 * })
 * ```
 *
 * @since 1.0.0
 */
export function useCapsuleCollider(options: CapsuleColliderOptions3D): CapsuleColliderHandle3D {
  const physics = usePhysics3D();
  const entityId = _getActorEntityId() as unknown as EntityId;
  const colliderId = nextColliderId();

  // axis is stored for future WASM bridge use; the current bridge uses Y-up by default
  void options.axis;

  physics.addCollider(entityId, {
    shape: {
      type: 'capsule',
      radius: options.radius,
      halfHeight: options.height / 2,
    },
    offsetX: options.offsetX,
    offsetY: options.offsetY,
    offsetZ: options.offsetZ,
    isSensor: options.isSensor,
    materialPreset: options.material,
    colliderId,
  });

  return {
    get colliderId() {
      return colliderId;
    },
    remove() {
      physics.removeCollider(entityId, colliderId);
    },
  };
}
