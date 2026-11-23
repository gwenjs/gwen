import type { Quat, Vec3 } from "@gwenjs/math";
import type { EntityId } from "@gwenjs/schema";

import type { BodyKind } from "@gwenjs/physics-core";

import type { Physics3DColliderOptions, Physics3DMaterialPreset } from "./colliders";
import type { QualityPreset } from "./config";

export type { BodyKind };
export { BODY_KIND_CODE } from "@gwenjs/physics-core";

/**
 * How a 3D rigid body participates in the simulation.
 *
 * - `'fixed'`     — Immovable (walls, terrain).
 * - `'dynamic'`   — Fully simulated (gravity, forces, collisions).
 * - `'kinematic'` — Position driven by explicit writes; ignores gravity.
 */

/**
 * Options accepted by `createBody`.
 */
export interface Physics3DBodyOptions {
  /**
   * How the body participates in the simulation.
   * @default 'dynamic'
   */
  kind?: BodyKind;
  /**
   * Body mass in kg. Values ≤ 0 are clamped to 0.0001.
   * @default 1
   */
  mass?: number;
  /**
   * Gravity scale multiplier. 0 = no gravity, 1 = normal.
   * @default 1
   */
  gravityScale?: number;
  /**
   * Linear velocity damping coefficient ≥ 0.
   * @default 0
   */
  linearDamping?: number;
  /**
   * Angular velocity damping coefficient ≥ 0.
   * @default 0
   */
  angularDamping?: number;
  /**
   * Enable Continuous Collision Detection (CCD) for fast-moving bodies.
   * @default false
   */
  ccdEnabled?: boolean;
  /** Initial world-space position in metres. */
  initialPosition?: Partial<Vec3>;
  /** Initial orientation as a unit quaternion. */
  initialRotation?: Partial<Quat>;
  /** Initial linear velocity in m/s. */
  initialLinearVelocity?: Partial<Vec3>;
  /** Initial angular velocity in rad/s. */
  initialAngularVelocity?: Partial<Vec3>;
  /**
   * Colliders to attach immediately after body creation.
   */
  colliders?: Physics3DColliderOptions[];
  /**
   * When `true`, locks all rotational degrees of freedom for this body.
   * Prevents the body from tumbling due to torque or collision.
   * @default false
   */
  fixedRotation?: boolean;
  /**
   * Per-body physics quality preset controlling additional solver iterations.
   * Overrides the world-level quality preset for this body alone.
   * Maps to Rapier's `additional_solver_iterations`.
   * @default undefined (uses world preset)
   */
  quality?: QualityPreset;
}

/** Opaque handle returned by `createBody`, stored internally. */
export interface Physics3DBodyHandle {
  /** Monotonically increasing body id (per plugin instance). */
  bodyId: number;
  /** The EntityId this handle was created for. */
  entityId: EntityId;
  /** Current simulation kind. */
  kind: BodyKind;
  /** Body mass in kg. */
  mass: number;
  /** Linear damping coefficient. */
  linearDamping: number;
  /** Angular damping coefficient. */
  angularDamping: number;
}

/**
 * Full snapshot of a body's simulation state.
 *
 * All sub-objects are fresh copies — safe to cache across frames.
 */
export interface Physics3DBodyState {
  /** World-space position in metres. */
  position: Vec3;
  /** Orientation as a unit quaternion. */
  rotation: Quat;
  /** Linear velocity in m/s. */
  linearVelocity: Vec3;
  /** Angular velocity in rad/s. */
  angularVelocity: Vec3;
}

/**
 * Enriched read-only snapshot returned by `getBodySnapshot`.
 *
 * Nullable fields allow callers to handle the body-not-found case gracefully.
 */
export interface Physics3DBodySnapshot {
  /** Packed EntityId of the entity. */
  entityId: EntityId;
  /** World-space position, or `null` if the body is not registered. */
  position: Vec3 | null;
  /** Orientation, or `null` if the body is not registered. */
  rotation: Quat | null;
  /** Linear velocity in m/s, or `null` if the body is not registered. */
  linearVelocity: Vec3 | null;
  /** Angular velocity in rad/s, or `null` if the body is not registered. */
  angularVelocity: Vec3 | null;
}

// ─── RFC-06 DX Composable types ─────────────────────────────────────────────

/**
 * Simplified options for registering a static (non-moving) 3D physics body
 * via {@link useStaticBody}.
 */
export interface StaticBodyOptions3D {
  /** Mark as sensor — generates events but no physical response. @default false */
  isSensor?: boolean;
  /** Numeric collision layer bitmask (membership). */
  layer?: number;
  /** Numeric collision filter bitmask (which layers to collide with). */
  mask?: number;
  /** Built-in material preset. @default 'default' */
  material?: Physics3DMaterialPreset;
}

/**
 * Simplified options for registering a dynamic (fully simulated) 3D physics body
 * via {@link useDynamicBody}.
 */
export interface DynamicBodyOptions3D {
  /** Body mass in kg. Values ≤ 0 are clamped to 0.0001. @default 1 */
  mass?: number;
  /** Gravity scale multiplier. 0 = no gravity. @default 1 */
  gravityScale?: number;
  /** Linear velocity damping coefficient ≥ 0. @default 0 */
  linearDamping?: number;
  /** Angular velocity damping coefficient ≥ 0. @default 0 */
  angularDamping?: number;
  /** Enable Continuous Collision Detection (CCD) for fast-moving bodies. @default false */
  ccdEnabled?: boolean;
  /** Mark as sensor — generates events but no physical response. @default false */
  isSensor?: boolean;
  /** Numeric collision layer bitmask (membership). */
  layer?: number;
  /** Numeric collision filter bitmask (which layers to collide with). */
  mask?: number;
  /** Built-in material preset. @default 'default' */
  material?: Physics3DMaterialPreset;
  /** Initial world-space position in metres. */
  initialPosition?: Partial<Vec3>;
  /** Initial orientation as a unit quaternion. */
  initialRotation?: Partial<Quat>;
  /** Initial linear velocity in m/s. */
  initialLinearVelocity?: Partial<Vec3>;
  /** Initial angular velocity in rad/s. */
  initialAngularVelocity?: Partial<Vec3>;
  /**
   * If true, body cannot rotate around any axis.
   * @default false
   */
  fixedRotation?: boolean;
  /**
   * CCD quality preset for fast-moving bodies.
   * @default 'medium'
   * @see {@link QualityPreset}
   */
  quality?: QualityPreset;
}

/**
 * Runtime handle for a static physics body registered via {@link useStaticBody}.
 */
export interface StaticBodyHandle3D {
  /** Opaque numeric body id assigned by the physics engine. */
  readonly bodyId: number;
  /** Whether the body is currently active in the simulation. */
  readonly active: boolean;
  /** Re-create the body in the simulation (no-op when already active). */
  enable(): void;
  /** Remove the body from the simulation (no-op when already inactive). */
  disable(): void;
}

/**
 * Runtime handle for a dynamic physics body registered via {@link useDynamicBody}.
 *
 * Extends {@link StaticBodyHandle3D} with force, impulse, torque, and velocity methods.
 */
export interface DynamicBodyHandle3D extends StaticBodyHandle3D {
  /**
   * Accumulate a continuous force in newtons.
   * Applied as one impulse each frame, scaled by dt.
   * Call it every frame to sustain the force.
   */
  applyForce(fx: number, fy: number, fz: number): void;
  /** Apply an instantaneous linear impulse in N·s. */
  applyImpulse(ix: number, iy: number, iz: number): void;
  /** Apply a continuous torque in N·m. */
  applyTorque(tx: number, ty: number, tz: number): void;
  /** Set the linear velocity directly in m/s. */
  setVelocity(vx: number, vy: number, vz: number): void;
  /** Current linear velocity in m/s. Returns zero vector when body is inactive. */
  readonly velocity: Vec3;
  /** Current angular velocity in rad/s. Returns zero vector when body is inactive. */
  readonly angularVelocity: Vec3;
}

/**
 * Configuration for a kinematic 3D physics body.
 *
 * Kinematic bodies are driven by explicit position writes rather than the
 * physics simulation. They participate in collision detection but are never
 * displaced by forces or gravity.
 */
export interface KinematicBodyOptions3D {
  /** Initial world-space position in metres. */
  initialPosition?: Vec3;
  /** Initial orientation as a unit quaternion. Default: identity. */
  initialRotation?: Quat;
  /**
   * When `true`, angular velocity calls are ignored and orientation stays fixed.
   * @default false
   */
  fixedRotation?: boolean;
}

/**
 * Runtime handle returned by {@link useKinematicBody} for a 3D kinematic body.
 *
 * Move the body each frame via {@link setVelocity}; the engine integrates
 * `pos += vel * dt` in `onBeforeUpdate`. Use {@link moveTo} for instant teleports.
 */
export interface KinematicBodyHandle3D {
  /** Opaque numeric body id assigned by the physics engine. */
  readonly bodyId: number;
  /** Whether the body is currently active in the simulation. */
  readonly active: boolean;
  /**
   * Teleport the body to an exact world-space position.
   *
   * @param x - Target X position in metres.
   * @param y - Target Y position in metres.
   * @param z - Target Z position in metres.
   * @param qx - Quaternion X component. Defaults to 0.
   * @param qy - Quaternion Y component. Defaults to 0.
   * @param qz - Quaternion Z component. Defaults to 0.
   * @param qw - Quaternion W component. Defaults to 1 (identity).
   * @note `fixedRotation` only prevents velocity-driven angular integration.
   *   Explicit rotation arguments passed to `moveTo` are always applied.
   */
  moveTo(x: number, y: number, z: number, qx?: number, qy?: number, qz?: number, qw?: number): void;
  /**
   * Set the desired linear velocity in m/s.
   *
   * The engine integrates `pos += vel * dt` each `onBeforeUpdate` tick.
   */
  setVelocity(vx: number, vy: number, vz: number): void;
  /**
   * Set the desired angular velocity in rad/s (world-space axis rates).
   *
   * The engine integrates orientation using first-order quaternion integration.
   * No-op when the body was created with `fixedRotation: true`.
   */
  setAngularVelocity(wx: number, wy: number, wz: number): void;
  /** Current linear velocity as last set by {@link setVelocity}, in m/s. */
  readonly velocity: Vec3;
  /** Current angular velocity as last set by {@link setAngularVelocity}, in rad/s. */
  readonly angularVelocity: Vec3;
  /** Re-create the body in the simulation (no-op when already active). */
  enable(): void;
  /** Remove the body from the simulation (no-op when already inactive). */
  disable(): void;
}

/**
 * Runtime handle for a physics collider attached via useBoxCollider,
 * useSphereCollider, useCapsuleCollider, useMeshCollider, or useConvexCollider.
 */
export interface ColliderHandle3D {
  /** Stable numeric collider id used to remove the collider later. */
  readonly colliderId: number;
  /** Remove this collider from the entity. */
  remove(): void;
}
