/**
 * @file useBoxCollider() — attaches a box-shaped collider to the current entity.
 */
import type { BoxColliderHandle3D, Physics3DMaterialPreset } from '../types';
import { usePhysics3D } from '../composables';
import { _getActorEntityId } from '@gwenjs/core/scene';
import type { EntityId } from '@gwenjs/core';
import { nextColliderId } from './collider-id';

/**
 * Options for configuring a box-shaped 3D collider.
 */
export interface BoxColliderOptions3D {
  /** Full width of the box in metres (half-extent = w / 2). */
  w: number;
  /** Full height of the box in metres (half-extent = h / 2). */
  h: number;
  /**
   * Full depth of the box in metres (half-extent = d / 2).
   * Defaults to `w` when omitted, producing a square cross-section.
   */
  d?: number;
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
 * Attach a box-shaped collider to the current entity.
 *
 * Must be called after {@link useStaticBody} or {@link useDynamicBody} has
 * registered the body for this entity.
 *
 * @param options - Box dimensions and optional material/sensor/layer config.
 * @returns A {@link BoxColliderHandle3D} with a stable `colliderId` and a `remove()` method.
 * @throws {GwenPluginNotFoundError} If `@gwenjs/physics3d` is not registered.
 *
 * @example
 * ```typescript
 * const PlatformActor = defineActor(PlatformPrefab, () => {
 *   useStaticBody()
 *   useBoxCollider({ w: 10, h: 1, d: 2 })
 * })
 * ```
 *
 * @since 1.0.0
 */
export function useBoxCollider(options: BoxColliderOptions3D): BoxColliderHandle3D {
  const physics = usePhysics3D();
  const entityId = _getActorEntityId() as unknown as EntityId;
  const colliderId = nextColliderId();

  physics.addCollider(entityId, {
    shape: {
      type: 'box',
      halfX: options.w / 2,
      halfY: options.h / 2,
      halfZ: (options.d ?? options.w) / 2,
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
