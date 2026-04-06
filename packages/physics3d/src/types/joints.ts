import type { Physics3DVec3, Physics3DQuat } from './config';
import type { Physics3DColliderShape } from './colliders';
import type { Physics3DEntityId } from './bodies';

// ─── Joint handle & id ────────────────────────────────────────────────────────

/**
 * Opaque numeric joint identifier returned by all `addXxxJoint` factory
 * methods. Pass it to `removeJoint`, `setJointMotorVelocity`, etc.
 */
export type JointHandle3D = number;

/**
 * Alias of {@link JointHandle3D} used as the parameter type in joint-control
 * methods such as `removeJoint` and `setJointMotorVelocity`.
 */
export type JointId = JointHandle3D;

// ─── Joint options ────────────────────────────────────────────────────────────

/** Shared options present on every joint type. */
export interface JointOptsBase {
  /** First body participating in the joint. */
  bodyA: Physics3DEntityId;
  /** Second body participating in the joint. */
  bodyB: Physics3DEntityId;
  /**
   * Anchor point on `bodyA` in local body-A space (metres).
   * @default { x: 0, y: 0, z: 0 }
   */
  anchorA?: Partial<Physics3DVec3>;
  /**
   * Anchor point on `bodyB` in local body-B space (metres).
   * @default { x: 0, y: 0, z: 0 }
   */
  anchorB?: Partial<Physics3DVec3>;
}

/**
 * Options for a **fixed (weld)** joint.
 *
 * Locks both bodies together with no relative movement.
 */
export interface FixedJointOpts extends JointOptsBase {}

/**
 * Options for a **revolute (hinge)** joint.
 *
 * Allows rotation around a single axis; optionally limited by angular bounds.
 */
export interface RevoluteJointOpts extends JointOptsBase {
  /**
   * Rotation axis in body-A local space (should be normalized).
   * @default { x: 0, y: 1, z: 0 }
   */
  axis?: Partial<Physics3DVec3>;
  /**
   * Optional angular limits `[min, max]` in radians.
   * Omit to allow unrestricted rotation.
   */
  limits?: [number, number];
}

/**
 * Options for a **prismatic (slider)** joint.
 *
 * Allows linear translation along a single axis; optionally limited.
 */
export interface PrismaticJointOpts extends JointOptsBase {
  /**
   * Slide axis in body-A local space (should be normalized).
   * @default { x: 0, y: 1, z: 0 }
   */
  axis?: Partial<Physics3DVec3>;
  /**
   * Optional linear limits `[min, max]` in metres.
   * Omit to allow unrestricted translation.
   */
  limits?: [number, number];
}

/**
 * Options for a **ball (spherical)** joint.
 *
 * Allows unrestricted rotation around the anchor point; optionally limited
 * by a cone angle.
 */
export interface BallJointOpts extends JointOptsBase {
  /**
   * Optional half-angle cone limit in radians.
   * Omit to allow full spherical rotation.
   */
  coneAngle?: number;
}

/**
 * Options for a **spring** joint.
 *
 * Pulls the two anchor points toward a target rest length with configurable
 * stiffness and damping.
 */
export interface SpringJointOpts extends JointOptsBase {
  /** Natural rest length of the spring in metres. */
  restLength: number;
  /** Spring stiffness coefficient in N/m. */
  stiffness: number;
  /** Spring damping coefficient in N·s/m. */
  damping: number;
}

// ─── Query results ────────────────────────────────────────────────────────────

/**
 * Result returned by a successful `castRay()` call.
 */
export interface RayHit {
  /** The entity whose collider was struck. */
  entity: Physics3DEntityId;
  /** Distance from the ray origin to the hit point in metres. */
  distance: number;
  /** Surface normal at the hit point (unit vector). */
  normal: Physics3DVec3;
  /** World-space hit point in metres. */
  point: Physics3DVec3;
}

/**
 * Result returned by a successful `castShape()` call.
 */
export interface ShapeHit {
  /** The entity whose collider was struck. */
  entity: Physics3DEntityId;
  /** Time of impact (distance along the cast direction) in metres. */
  distance: number;
  /** Surface normal at the contact point (unit vector). */
  normal: Physics3DVec3;
  /** World-space contact point in metres. */
  point: Physics3DVec3;
  /** Closest witness point on the cast shape (world space). */
  witnessA: Physics3DVec3;
  /** Closest witness point on the hit collider (world space). */
  witnessB: Physics3DVec3;
}

/**
 * Result returned by a successful `projectPoint()` call.
 */
export interface PointProjection {
  /** The entity whose collider is nearest to the query point. */
  entity: Physics3DEntityId;
  /** Projected point on the collider surface in world space. */
  point: Physics3DVec3;
  /** `true` when the input point is inside the collider geometry. */
  isInside: boolean;
}

// ─── Pathfinding ──────────────────────────────────────────────────────────────

/**
 * Options supplied to `initNavGrid3D` to upload a voxel navigation grid.
 */
export interface Pathfinding3DOptions {
  /**
   * Raw voxel grid data (`1` byte per cell).
   * `0` = open/walkable, `1` = solid/blocked.
   */
  grid: Uint8Array;
  /** Number of cells along the X axis. */
  width: number;
  /** Number of cells along the Y axis. */
  height: number;
  /** Number of cells along the Z axis. */
  depth: number;
  /** World-space size of each cubic cell in metres. */
  cellSize: number;
  /**
   * World-space origin of the voxel grid.
   * @default { x: 0, y: 0, z: 0 }
   */
  origin?: Partial<Physics3DVec3>;
}

/**
 * A single waypoint in a path returned by `findPath3D`.
 */
export interface PathWaypoint3D {
  /** X coordinate in metres. */
  x: number;
  /** Y coordinate in metres. */
  y: number;
  /** Z coordinate in metres. */
  z: number;
}

// ─── Character Controller ─────────────────────────────────────────────────────

/**
 * Options for creating a character controller via `addCharacterController`.
 */
export interface CharacterControllerOpts {
  /**
   * Maximum step height the controller can automatically climb (metres).
   * @default 0.35
   */
  stepHeight?: number;
  /**
   * Maximum walkable slope angle in degrees.
   * Steeper surfaces are treated as walls.
   * @default 45
   */
  slopeLimit?: number;
  /**
   * Extra skin width used for depenetration (metres).
   * @default 0.02
   */
  skinWidth?: number;
  /**
   * Distance at which the controller snaps to the ground (metres).
   * @default 0.2
   */
  snapToGround?: number;
  /**
   * Whether the controller slides along steep slopes rather than stopping.
   * @default true
   */
  slideOnSteepSlopes?: boolean;
  /**
   * Whether to apply impulses to dynamic bodies on collision.
   * @default true
   */
  applyImpulsesToDynamic?: boolean;
}

/**
 * Handle returned by `addCharacterController`.
 *
 * Use `move()` each frame to drive the controller; read `isGrounded` and
 * `groundNormal` to implement jump, landing, and slope responses.
 */
export interface CharacterControllerHandle {
  /** `true` when the controller was grounded during the last `move()` call. */
  readonly isGrounded: boolean;
  /**
   * Surface normal of the ground contact in world space, or `null` when the
   * controller is airborne.
   */
  readonly groundNormal: Physics3DVec3 | null;
  /**
   * Entity the controller is standing on, or `null` when airborne or when ground
   * entity tracking is unavailable.
   *
   * Populated from the 5-float return value of `physics3d_character_controller_move`
   * when the WASM layer supports it.
   */
  readonly groundEntity: import('./bodies').Physics3DEntityId | null;
  /**
   * The actual translation applied during the last `move()` call (metres).
   * May differ from `desiredVelocity × dt` due to collision response.
   */
  readonly lastTranslation: Physics3DVec3;
  /**
   * Drive the character controller.
   *
   * In WASM mode delegates to Rapier's character controller which handles
   * step-up, slope sliding, and skin-width depenetration.
   * In local mode approximates movement via direct position integration.
   *
   * @param desiredVelocity - Desired velocity in m/s.
   * @param dt - Frame delta time in seconds.
   */
  move(desiredVelocity: Physics3DVec3, dt: number): void;
}

// ─── Composable slot types ────────────────────────────────────────────────────

/**
 * Options for registering a persistent per-frame raycast slot via
 * `registerRaycastSlot`.
 */
export interface RaycastOpts {
  /** Ray direction (should be normalized). */
  direction: Physics3DVec3;
  /**
   * Maximum ray travel distance in metres.
   * @default 100
   */
  maxDist?: number;
  /**
   * Collision layer membership bitmask.
   * @default 0xFFFFFFFF
   */
  layers?: number;
  /**
   * Collision filter bitmask (which layers to hit).
   * @default 0xFFFFFFFF
   */
  mask?: number;
  /**
   * Whether a ray starting inside a solid collider registers a hit.
   * @default true
   */
  solid?: boolean;
  /**
   * Callback returning the ray origin each frame.
   * When omitted the slot's pre-registered origin is used.
   */
  origin?: () => Physics3DVec3;
}

/**
 * Mutable result record stored inside a raycast slot and updated each frame.
 * @internal
 */
export interface RaycastSlotResult {
  /** Whether the ray hit anything during the last step. */
  hit: boolean;
  /** Hit entity, or the zero entity when no hit occurred. */
  entity: Physics3DEntityId;
  /** Distance to the hit point in metres. */
  distance: number;
  /** Surface normal at the hit point. */
  normal: Physics3DVec3;
  /** World-space hit point. */
  point: Physics3DVec3;
}

/**
 * Handle returned by `registerRaycastSlot`.
 *
 * Read its properties each frame — they are updated in-place after each
 * physics step so no allocation occurs.
 */
export interface RaycastHandle {
  /** `true` when the last step produced a hit. */
  readonly hit: boolean;
  /** The hit entity from the last step. */
  readonly entity: Physics3DEntityId;
  /** Distance to the last hit in metres. */
  readonly distance: number;
  /** Surface normal at the last hit. */
  readonly normal: Physics3DVec3;
  /** World-space last hit point. */
  readonly point: Physics3DVec3;
  /** @internal Slot id used by `unregisterRaycastSlot`. */
  readonly _id: number;
}

/**
 * Options for registering a persistent per-frame shape-cast slot via
 * `registerShapeCastSlot`.
 */
export interface ShapeCastOpts {
  /** Shape to sweep through the scene. */
  shape: Physics3DColliderShape;
  /** Sweep direction. */
  direction: Physics3DVec3;
  /**
   * Maximum sweep distance in metres.
   * @default 100
   */
  maxDist?: number;
  /**
   * Collision layer membership bitmask.
   * @default 0xFFFFFFFF
   */
  layers?: number;
  /**
   * Collision filter bitmask.
   * @default 0xFFFFFFFF
   */
  mask?: number;
  /**
   * Callback returning the cast origin each frame.
   * @default () => \{ x: 0, y: 0, z: 0 \}
   */
  origin?: () => Physics3DVec3;
  /**
   * Callback returning the cast rotation each frame.
   * @default () => identity quaternion
   */
  rotation?: () => Physics3DQuat;
}

/**
 * Mutable result record stored inside a shape-cast slot and updated each frame.
 * @internal
 */
export interface ShapeCastSlotResult {
  /** Whether the sweep hit anything during the last step. */
  hit: boolean;
  /** Hit entity, or the zero entity when no hit. */
  entity: Physics3DEntityId;
  /** Time of impact (distance) of the last hit. */
  distance: number;
  /** Surface normal at the hit. */
  normal: Physics3DVec3;
  /** World-space contact point. */
  point: Physics3DVec3;
  /** Witness point on the cast shape. */
  witnessA: Physics3DVec3;
  /** Witness point on the hit collider. */
  witnessB: Physics3DVec3;
}

/**
 * Handle returned by `registerShapeCastSlot`.
 *
 * Read its properties each frame — they are updated in-place after each step.
 */
export interface ShapeCastHandle {
  /** `true` when the last step produced a hit. */
  readonly hit: boolean;
  /** The hit entity from the last step. */
  readonly entity: Physics3DEntityId;
  /** Time of impact / distance of the last hit. */
  readonly distance: number;
  /** Surface normal at the last hit. */
  readonly normal: Physics3DVec3;
  /** World-space contact point from the last hit. */
  readonly point: Physics3DVec3;
  /** Witness point on the cast shape. */
  readonly witnessA: Physics3DVec3;
  /** Witness point on the hit collider. */
  readonly witnessB: Physics3DVec3;
  /** @internal Slot id used by `unregisterShapeCastSlot`. */
  readonly _id: number;
}

/**
 * Options for registering a persistent per-frame overlap slot via
 * `registerOverlapSlot`.
 */
export interface OverlapOpts {
  /** Shape to test for overlap against all colliders. */
  shape: Physics3DColliderShape;
  /**
   * Collision layer membership bitmask.
   * @default 0xFFFFFFFF
   */
  layers?: number;
  /**
   * Collision filter bitmask.
   * @default 0xFFFFFFFF
   */
  mask?: number;
  /**
   * Maximum number of overlapping entities returned per step.
   * @default 16
   */
  maxResults?: number;
  /** Callback returning the query origin each frame. */
  origin: () => Physics3DVec3;
  /**
   * Callback returning the query rotation each frame.
   * @default () => identity quaternion
   */
  rotation?: () => Physics3DQuat;
}

/**
 * Mutable result record stored inside an overlap slot and updated each frame.
 * @internal
 */
export interface OverlapSlotResult {
  /** Number of overlapping entities found during the last step. */
  count: number;
  /** Overlapping entity IDs from the last step. */
  entities: Physics3DEntityId[];
}

/**
 * Handle returned by `registerOverlapSlot`.
 *
 * Read its properties each frame — they are updated in-place after each step.
 */
export interface OverlapHandle {
  /** Number of overlapping entities from the last step. */
  readonly count: number;
  /** Overlapping entity IDs from the last step. */
  readonly entities: Physics3DEntityId[];
  /** @internal Slot id used by `unregisterOverlapSlot`. */
  readonly _id: number;
}
