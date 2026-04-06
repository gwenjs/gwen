import type { Physics3DVec3, Physics3DQuat, Physics3DQualityPreset } from './config';
import type { Physics3DColliderOptions, Physics3DMaterialPreset } from './colliders';

/** Accepted forms of entity identity at the Physics3D API boundary. */
export type Physics3DEntityId = string | number | bigint;

/**
 * How a 3D rigid body participates in the simulation.
 *
 * - `'fixed'`     — Immovable (walls, terrain).
 * - `'dynamic'`   — Fully simulated (gravity, forces, collisions).
 * - `'kinematic'` — Position driven by explicit writes; ignores gravity.
 */
export type Physics3DBodyKind = 'dynamic' | 'kinematic' | 'fixed';

/**
 * Options accepted by `createBody`.
 */
export interface Physics3DBodyOptions {
  /**
   * How the body participates in the simulation.
   * @default 'dynamic'
   */
  kind?: Physics3DBodyKind;
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
  initialPosition?: Partial<Physics3DVec3>;
  /** Initial orientation as a unit quaternion. */
  initialRotation?: Partial<Physics3DQuat>;
  /** Initial linear velocity in m/s. */
  initialLinearVelocity?: Partial<Physics3DVec3>;
  /** Initial angular velocity in rad/s. */
  initialAngularVelocity?: Partial<Physics3DVec3>;
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
  quality?: import('./config').Physics3DQualityPreset;
}

/** Opaque handle returned by `createBody`, stored internally. */
export interface Physics3DBodyHandle {
  /** Monotonically increasing body id (per plugin instance). */
  bodyId: number;
  /** The EntityId this handle was created for. */
  entityId: Physics3DEntityId;
  /** Current simulation kind. */
  kind: Physics3DBodyKind;
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
  position: Physics3DVec3;
  /** Orientation as a unit quaternion. */
  rotation: Physics3DQuat;
  /** Linear velocity in m/s. */
  linearVelocity: Physics3DVec3;
  /** Angular velocity in rad/s. */
  angularVelocity: Physics3DVec3;
}

/**
 * Enriched read-only snapshot returned by `getBodySnapshot`.
 *
 * Nullable fields allow callers to handle the body-not-found case gracefully.
 */
export interface Physics3DBodySnapshot {
  /** Packed EntityId of the entity. */
  entityId: Physics3DEntityId;
  /** World-space position, or `null` if the body is not registered. */
  position: Physics3DVec3 | null;
  /** Orientation, or `null` if the body is not registered. */
  rotation: Physics3DQuat | null;
  /** Linear velocity in m/s, or `null` if the body is not registered. */
  linearVelocity: Physics3DVec3 | null;
  /** Angular velocity in rad/s, or `null` if the body is not registered. */
  angularVelocity: Physics3DVec3 | null;
}

// ─── RFC-06 DX Composable types ─────────────────────────────────────────────

/**
 * Zero-copy 3D contact event delivered via SAB ring buffer.
 *
 * entityA/entityB are raw slot indices packed as bigint.
 * contactX/Y/Z is the world-space contact point.
 * normalX/Y/Z is the contact normal (unit vector pointing from B to A).
 * relativeVelocity is the magnitude of the relative impact velocity in m/s.
 * restitution is the effective restitution coefficient at the contact.
 */
export interface ContactEvent3D {
  /** Packed slot index of the first participant. */
  entityA: bigint;
  /** Packed slot index of the second participant. */
  entityB: bigint;
  /** World-space contact point X in metres. */
  contactX: number;
  /** World-space contact point Y in metres. */
  contactY: number;
  /** World-space contact point Z in metres. */
  contactZ: number;
  /** Contact normal X (unit vector from B to A). */
  normalX: number;
  /** Contact normal Y. */
  normalY: number;
  /** Contact normal Z. */
  normalZ: number;
  /** Magnitude of relative impact velocity in m/s. */
  relativeVelocity: number;
  /** Effective restitution coefficient at the contact point. */
  restitution: number;
}

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
  materialPreset?: Physics3DMaterialPreset;
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
  materialPreset?: Physics3DMaterialPreset;
  /** Initial world-space position in metres. */
  initialPosition?: Partial<Physics3DVec3>;
  /** Initial orientation as a unit quaternion. */
  initialRotation?: Partial<Physics3DQuat>;
  /** Initial linear velocity in m/s. */
  initialLinearVelocity?: Partial<Physics3DVec3>;
  /** Initial angular velocity in rad/s. */
  initialAngularVelocity?: Partial<Physics3DVec3>;
  /**
   * If true, body cannot rotate around any axis.
   * @default false
   */
  fixedRotation?: boolean;
  /**
   * CCD quality preset for fast-moving bodies.
   * @default 'medium'
   * @see {@link Physics3DQualityPreset}
   */
  quality?: Physics3DQualityPreset;
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
   * Apply a continuous linear force to the body in N.
   * Internally mapped to {@link Physics3DAPI.applyImpulse} since
   * the Rapier3D WASM bridge processes forces as per-step impulses.
   */
  applyForce(fx: number, fy: number, fz: number): void;
  /** Apply an instantaneous linear impulse in N·s. */
  applyImpulse(ix: number, iy: number, iz: number): void;
  /** Apply a continuous torque in N·m. */
  applyTorque(tx: number, ty: number, tz: number): void;
  /** Set the linear velocity directly in m/s. */
  setVelocity(vx: number, vy: number, vz: number): void;
  /** Current linear velocity in m/s. Returns zero vector when body is inactive. */
  readonly velocity: Physics3DVec3;
  /** Current angular velocity in rad/s. Returns zero vector when body is inactive. */
  readonly angularVelocity: Physics3DVec3;
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
  initialPosition?: Physics3DVec3;
  /** Initial orientation as a unit quaternion. Default: identity. */
  initialRotation?: Physics3DQuat;
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
  readonly velocity: Physics3DVec3;
  /** Current angular velocity as last set by {@link setAngularVelocity}, in rad/s. */
  readonly angularVelocity: Physics3DVec3;
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
