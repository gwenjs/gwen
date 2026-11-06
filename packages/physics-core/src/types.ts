/**
 * Shared physics types. One declaration for both dimensions.
 */

import type { Quat, Vec2, Vec3 } from "@gwenjs/math";
import type { EntityId } from "@gwenjs/schema";

/** Physics dimension. */
export type Dim = "2d" | "3d";

/** Position type of a dimension. 2D is `Vec2`, 3D is `Vec3`. */
export type DimVec<D extends Dim> = D extends "2d" ? Vec2 : Vec3;

/** Rotation type of a dimension. 2D is radians, 3D is a quaternion. */
export type DimRot<D extends Dim> = D extends "2d" ? number : Quat;

/** How a body participates in the simulation. */
export type BodyKind = "fixed" | "dynamic" | "kinematic";

/** Numeric body kind sent across the bridge. Matches `BodyType::from_u8`. */
export const BODY_KIND_CODE = {
  fixed: 0,
  dynamic: 1,
  kinematic: 2,
} as const;

/** Solver quality preset. */
export type QualityPreset = "low" | "medium" | "high" | "esport";

/** Numeric quality preset sent across the bridge. */
export const QUALITY_PRESET_CODE = {
  low: 0,
  medium: 1,
  high: 2,
  esport: 3,
} as const;

/**
 * Layer membership or mask.
 * A name is a bit index. A number is a raw mask. An array is combined with OR.
 */
export type LayerSelector = string | number | readonly (string | number)[];

/** Filter fields shared by collider options. */
export interface ColliderFilterOptions {
  layer?: LayerSelector;
  mask?: LayerSelector;
  isSensor?: boolean;
  material?: string;
}

/** Fields both body option bags share. */
export interface BodyOptions {
  mass?: number;
  gravityScale?: number;
  linearDamping?: number;
  angularDamping?: number;
  fixedRotation?: boolean;
  layer?: LayerSelector;
  mask?: LayerSelector;
}

/** Initial pose of a kinematic body. */
export interface KinematicBodyOptions<D extends Dim> {
  initialPosition?: DimVec<D>;
  initialRotation?: DimRot<D>;
  fixedRotation?: boolean;
}

/** Box collider. `d` and `offsetZ` exist only in 3D. */
export type BoxColliderOptions<D extends Dim> = ColliderFilterOptions & {
  w: number;
  h: number;
  offsetX?: number;
  offsetY?: number;
} & (D extends "3d" ? { d?: number; offsetZ?: number } : object);

/** Sphere collider. `offsetZ` exists only in 3D. */
export type SphereColliderOptions<D extends Dim> = ColliderFilterOptions & {
  radius: number;
  offsetX?: number;
  offsetY?: number;
} & (D extends "3d" ? { offsetZ?: number } : object);

/** Capsule collider. `offsetZ` and `axis` exist only in 3D. */
export type CapsuleColliderOptions<D extends Dim> = ColliderFilterOptions & {
  radius: number;
  height: number;
  offsetX?: number;
  offsetY?: number;
} & (D extends "3d" ? { offsetZ?: number; axis?: "x" | "y" | "z" } : object);

/** Resolved contact delivered to `onContact` and `physics:collision`. */
export interface CollisionContact {
  /** Resolved packed EntityId of the first participant. */
  entityA: EntityId;
  /** Resolved packed EntityId of the second participant. */
  entityB: EntityId;
  /** Collider id on A side when available. */
  aColliderId?: number;
  /** Collider id on B side when available. */
  bColliderId?: number;
  /** `true` = contact started this frame, `false` = contact ended. */
  started: boolean;
}

/** Sensor overlap after a transition. */
export interface SensorState {
  /** Number of distinct overlapping contacts right now. */
  contactCount: number;
  /** `true` when at least one contact is active. */
  isActive: boolean;
}

/** Plugin options both dimensions share. */
export interface PhysicsConfigBase<D extends Dim> {
  gravity?: Partial<DimVec<D>>;
  maxEntities?: number;
  qualityPreset?: QualityPreset;
  debug?: boolean;
  coalesceEvents?: boolean;
  /** Layer name to bit index. At most 32 entries. Bits are integers in `0..31`. */
  layers?: Record<string, number>;
  maxLinearVelocity?: number;
}
