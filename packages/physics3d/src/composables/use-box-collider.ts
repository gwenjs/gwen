/**
 * @file useBoxCollider() — attaches a box-shaped collider to the current entity.
 */
import type { LayerSelector } from "@gwenjs/physics-core";
import type { BoxColliderHandle3D, Physics3DColliderOptions } from "../types";
import { usePhysics3D } from "../composables";
import { _getActorEntityId } from "@gwenjs/core/internal";
import { nextColliderId } from "./collider-id";

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
  /** Collision layer. A number is a raw bitmask, a string is a name, an array is OR-ed. */
  layer?: LayerSelector;
  /** Collision mask. Same shapes as `layer`. */
  mask?: LayerSelector;
  /** Preset name. */
  material?: string;
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
  const entityId = _getActorEntityId("useBoxCollider");
  const colliderId = nextColliderId();

  const collider: Physics3DColliderOptions = {
    shape: {
      type: "box",
      halfX: options.w / 2,
      halfY: options.h / 2,
      halfZ: (options.d ?? options.w) / 2,
    },
    colliderId,
    ...(options.offsetX !== undefined ? { offsetX: options.offsetX } : {}),
    ...(options.offsetY !== undefined ? { offsetY: options.offsetY } : {}),
    ...(options.offsetZ !== undefined ? { offsetZ: options.offsetZ } : {}),
    ...(options.isSensor !== undefined ? { isSensor: options.isSensor } : {}),
    ...(options.layer !== undefined ? { layer: options.layer } : {}),
    ...(options.mask !== undefined ? { mask: options.mask } : {}),
  };
  if (options.material !== undefined) Object.assign(collider, { material: options.material });
  physics.addCollider(entityId, collider);

  return {
    get colliderId() {
      return colliderId;
    },
    remove() {
      physics.removeCollider(entityId, colliderId);
    },
  };
}
