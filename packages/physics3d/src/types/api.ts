import type {
  Physics3DVec3,
  Physics3DQuat,
  Physics3DBodyHandle,
  Physics3DBodyKind,
  Physics3DBodyState,
  Physics3DBodySnapshot,
  Physics3DBodyOptions,
  Physics3DEntityId,
  Physics3DColliderOptions,
  Physics3DCollisionContact,
  Physics3DSensorState,
} from './index';
import type { BulkStaticBoxesOptions, BulkStaticBoxesResult } from './bulk';
import type { CompoundColliderOptions3D, CompoundColliderHandle3D } from './colliders';
import type {
  FixedJointOpts,
  RevoluteJointOpts,
  PrismaticJointOpts,
  BallJointOpts,
  SpringJointOpts,
  JointHandle3D,
  JointId,
  RayHit,
  ShapeHit,
  PointProjection,
  Pathfinding3DOptions,
  PathWaypoint3D,
  CharacterControllerOpts,
  CharacterControllerHandle,
  RaycastOpts,
  RaycastHandle,
  ShapeCastOpts,
  ShapeCastHandle,
  OverlapOpts,
  OverlapHandle,
} from './joints';
import type { Physics3DColliderShape } from './colliders';

// ─── Service API ───────────────────────────────────────────────────────────────

/**
 * Service exposed via `engine.inject('physics3d')` after plugin initialization.
 *
 * @example
 * ```ts
 * const physics3d = engine.inject('physics3d');
 * physics3d.createBody(entityId, { kind: 'dynamic' });
 * physics3d.addCollider(entityId, { shape: { type: 'box', halfX: 0.5, halfY: 0.5, halfZ: 0.5 } });
 * ```
 */
export interface Physics3DAPI {
  /**
   * Returns `true` when the plugin has successfully initialized.
   *
   * @returns `true` after `setup()` completes; `false` before init or after `teardown()`.
   *
   * @example
   * ```ts
   * if (!physics3d.isReady()) throw new Error('Physics not ready');
   * ```
   *
   * @since 1.0.0
   */
  isReady(): boolean;

  /**
   * Returns the active WASM core variant this plugin is running against.
   *
   * - `'physics3d'` — Full Rapier3D WASM backend.
   * - `'light'` / `'physics2d'` — TypeScript fallback simulation.
   *
   * @returns The active variant string.
   *
   * @since 1.0.0
   */
  variant(): 'light' | 'physics2d' | 'physics3d';

  /**
   * Manually advance the physics simulation by `deltaSeconds`.
   *
   * In **WASM mode** this delegates to Rapier3D's solver.
   * In **fallback mode** this runs the TypeScript integration step
   * (gravity, damping, position, quaternion rotation).
   *
   * @param deltaSeconds - Time to simulate in seconds. Must be positive.
   * @throws Error when called before plugin initialization.
   *
   * @since 1.0.0
   */
  step(deltaSeconds: number): void;

  /**
   * Create or replace a rigid body for an entity.
   *
   * Any colliders declared in `options.colliders` are attached immediately
   * after body creation. In **fallback mode** the body participates in
   * AABB collision detection each frame.
   *
   * @param entityId - Target entity identifier.
   * @param options  - Body creation options.
   * @returns The opaque body handle for the newly created body.
   *
   * @since 1.0.0
   */
  createBody(entityId: Physics3DEntityId, options?: Physics3DBodyOptions): Physics3DBodyHandle;

  /**
   * Remove the rigid body (and all attached colliders) for an entity.
   *
   * @param entityId - Target entity identifier.
   * @returns `true` when a body was found and removed; `false` when none existed.
   *
   * @since 1.0.0
   */
  removeBody(entityId: Physics3DEntityId): boolean;

  /**
   * Returns `true` if a body is currently registered for the entity.
   *
   * @param entityId - Target entity identifier.
   * @returns `true` when a body handle exists for the entity.
   *
   * @since 1.0.0
   */
  hasBody(entityId: Physics3DEntityId): boolean;

  /**
   * Read the current body kind for an entity.
   *
   * @param entityId - Target entity identifier.
   * @returns The body kind, or `undefined` if no body is registered.
   *
   * @since 1.0.0
   */
  getBodyKind(entityId: Physics3DEntityId): Physics3DBodyKind | undefined;

  /**
   * Update the body kind at runtime.
   *
   * Switching from `'fixed'` to `'dynamic'` re-enables gravity and integration.
   *
   * @param entityId - Target entity identifier.
   * @param kind     - New body kind.
   * @returns `true` when the update succeeded; `false` when no body exists.
   *
   * @since 1.0.0
   */
  setBodyKind(entityId: Physics3DEntityId, kind: Physics3DBodyKind): boolean;

  /**
   * Read a full snapshot of a body's simulation state.
   *
   * In **WASM mode** reads from Rapier3D's internal state.
   * In **fallback mode** returns a deep clone of the TypeScript state object.
   *
   * @param entityId - Target entity identifier.
   * @returns The body state snapshot, or `undefined` when no body is registered.
   *
   * @example
   * ```ts
   * const state = physics3d.getBodyState(entityId);
   * if (state) transform.position.copy(state.position);
   * ```
   *
   * @since 1.0.0
   */
  getBodyState(entityId: Physics3DEntityId): Physics3DBodyState | undefined;

  /** Partially update a body's simulation state. */
  setBodyState(
    entityId: Physics3DEntityId,
    patch: Partial<{
      position: Partial<Physics3DVec3>;
      rotation: Partial<Physics3DQuat>;
      linearVelocity: Partial<Physics3DVec3>;
      angularVelocity: Partial<Physics3DVec3>;
    }>,
  ): boolean;

  /**
   * Apply a linear impulse to a body in N·s. Velocity change = `impulse / mass`.
   *
   * In **fallback mode** directly modifies linear velocity: `v += impulse / mass`.
   *
   * @param entityId - Target entity identifier.
   * @param impulse  - Impulse vector in N·s. Missing components default to `0`.
   * @returns `true` when applied; `false` when no body is registered.
   *
   * @example
   * ```ts
   * physics3d.applyImpulse(entityId, { x: 0, y: 500, z: 0 }); // jump
   * ```
   *
   * @since 1.0.0
   */
  applyImpulse(entityId: Physics3DEntityId, impulse: Partial<Physics3DVec3>): boolean;

  /**
   * Apply an angular impulse to a body in N·m·s.
   *
   * In **fallback mode** directly modifies angular velocity: `ω += impulse / mass`.
   *
   * @param entityId - Target entity identifier.
   * @param impulse  - Angular impulse in N·m·s. Missing components default to `0`.
   * @returns `true` when applied; `false` when no body is registered.
   *
   * @since 1.0.0
   */
  applyAngularImpulse(entityId: Physics3DEntityId, impulse: Partial<Physics3DVec3>): boolean;

  /**
   * Apply a continuous torque to a body in N·m.
   *
   * In **fallback mode** directly increments angular velocity by `torque / mass`.
   * Has no effect on `'fixed'` bodies.
   *
   * In **WASM mode** this method is not forwarded to the Rapier3D bridge and
   * returns `false` — use `applyAngularImpulse` as an alternative.
   *
   * @param entityId - Target entity identifier.
   * @param torque   - Torque vector in N·m. Missing components default to `0`.
   * @returns `true` when applied; `false` when no body exists, body is fixed, or WASM mode.
   *
   * @example
   * ```ts
   * physics3d.applyTorque(entityId, { y: 10 }); // spin around Y axis
   * ```
   *
   * @since 1.0.0
   */
  applyTorque(entityId: Physics3DEntityId, torque: Partial<Physics3DVec3>): boolean;

  /**
   * Read the current linear velocity of a body in m/s.
   *
   * @param entityId - Target entity identifier.
   * @returns The linear velocity vector, or `undefined` when no body exists.
   *
   * @since 1.0.0
   */
  getLinearVelocity(entityId: Physics3DEntityId): Physics3DVec3 | undefined;

  /**
   * Set the linear velocity of a body in m/s. Missing components preserve the current value.
   *
   * @param entityId - Target entity identifier.
   * @param velocity - New linear velocity. Missing components are unchanged.
   * @returns `true` when applied; `false` when no body is registered.
   *
   * @since 1.0.0
   */
  setLinearVelocity(entityId: Physics3DEntityId, velocity: Partial<Physics3DVec3>): boolean;

  /**
   * Read the current angular velocity of a body in rad/s.
   *
   * @param entityId - Target entity identifier.
   * @returns The angular velocity vector, or `undefined` when no body exists.
   *
   * @since 1.0.0
   */
  getAngularVelocity(entityId: Physics3DEntityId): Physics3DVec3 | undefined;

  /**
   * Override the angular velocity of a body directly in rad/s.
   * Missing components preserve the current value.
   *
   * @param entityId - Target entity identifier.
   * @param velocity - New angular velocity. Missing components are unchanged.
   * @returns `true` when applied; `false` when no body is registered.
   *
   * @example
   * ```ts
   * physics3d.setAngularVelocity(entityId, { y: Math.PI * 2 });
   * ```
   *
   * @since 1.0.0
   */
  setAngularVelocity(entityId: Physics3DEntityId, velocity: Partial<Physics3DVec3>): boolean;

  /**
   * Teleport a kinematic body to an exact world-space position and optional rotation.
   *
   * @param entityId - Target entity.
   * @param position - Target world-space position.
   * @param rotation - Optional target rotation. Identity quaternion is used when omitted.
   */
  setKinematicPosition(
    entityId: Physics3DEntityId,
    position: Physics3DVec3,
    rotation?: Physics3DQuat,
  ): boolean;

  /**
   * Integrate N kinematic body positions in one WASM call.
   *
   * Each body `i` is moved by `(vx[i], vy[i], vz[i]) * dt`.
   * Orientation is preserved. All arrays must be the same length.
   *
   * @param slots - Entity slot indices.
   * @param vx - X velocity components in m/s.
   * @param vy - Y velocity components in m/s.
   * @param vz - Z velocity components in m/s.
   * @param dt - Delta time in seconds.
   * @returns Number of bodies updated.
   */
  bulkStepKinematics(
    slots: Uint32Array,
    vx: Float32Array,
    vy: Float32Array,
    vz: Float32Array,
    dt: number,
  ): number;

  /**
   * Integrate N kinematic body orientations in one WASM call.
   *
   * Applies first-order quaternion integration using the supplied angular
   * velocities `(wx[i], wy[i], wz[i])`. Position is preserved.
   *
   * @param slots - Entity slot indices.
   * @param wx - Angular velocity X in rad/s.
   * @param wy - Angular velocity Y in rad/s.
   * @param wz - Angular velocity Z in rad/s.
   * @param dt - Delta time in seconds.
   * @returns Number of bodies updated.
   */
  bulkStepKinematicRotations(
    slots: Uint32Array,
    wx: Float32Array,
    wy: Float32Array,
    wz: Float32Array,
    dt: number,
  ): number;

  /**
   * Attach a collider to an existing body.
   *
   * In **fallback mode** the collider is stored in the local collider registry
   * and participates in AABB collision detection each frame.
   * In **WASM mode** the collider is forwarded to the Rapier3D physics world.
   *
   * @param entityId - Target entity identifier.
   * @param options  - Collider shape, material, sensor flag, and layer configuration.
   * @returns `true` when added; `false` when no body is registered for the entity.
   *
   * @since 1.0.0
   */
  addCollider(entityId: Physics3DEntityId, options: Physics3DColliderOptions): boolean;

  /**
   * Remove a collider by its stable `colliderId`.
   *
   * @returns `false` if no matching collider was found.
   */
  removeCollider(entityId: Physics3DEntityId, colliderId: number): boolean;

  /**
   * Rebuild an existing mesh collider with new geometry.
   *
   * Removes the old trimesh collider identified by `colliderId` and inserts a
   * fresh one built from `vertices` and `indices`. The entity stays in the
   * simulation — only the collider shape changes.
   *
   * @param entityId   - Target entity.
   * @param colliderId - Stable collider ID originally returned by {@link useMeshCollider}.
   * @param vertices   - New flat vertex buffer `[x0,y0,z0, ...]`.
   * @param indices    - New flat index buffer `[a0,b0,c0, ...]`.
   * @param options    - Optional material overrides (friction, restitution, etc.).
   * @returns `true` on success; `false` if the entity has no body.
   */
  rebuildMeshCollider(
    entityId: Physics3DEntityId,
    colliderId: number,
    vertices: Float32Array,
    indices: Uint32Array,
    options?: Pick<
      Physics3DColliderOptions,
      'isSensor' | 'friction' | 'restitution' | 'layers' | 'mask'
    >,
  ): boolean;

  /**
   * Retrieve the pending async BVH load state for a collider that was created
   * with a `__bvhUrl` option. Returns `null` for synchronously-created colliders.
   *
   * @param colliderId - The stable numeric collider id assigned at creation time.
   * @returns Pending load state object, or `null` when the collider is synchronous.
   *
   * @internal Used by {@link useMeshCollider} — not part of the public API.
   */
  _getBvhLoadState(colliderId: number): { ready: Promise<void>; abort(): void } | null;

  /**
   * Spawn N static box rigid bodies in a single operation.
   *
   * In **WASM mode** this makes a single Rust call via `physics3d_bulk_spawn_static_boxes`,
   * amortising the per-body overhead for large static geometry (e.g. level platforms).
   * In **fallback mode** this loops and calls `createBody` N times.
   *
   * Entity IDs are allocated internally via `engine.createEntity()`.
   *
   * @param options - Position buffer, half-extents, and optional material/layer overrides.
   * @returns Packed entity IDs and count of created bodies.
   *
   * @example
   * ```ts
   * const { entityIds } = physics3d.bulkSpawnStaticBoxes({
   *   positions: new Float32Array([0,0,0, 5,0,0, 10,0,0]),
   *   halfExtents: new Float32Array([0.5, 0.5, 0.5]),
   * });
   * ```
   *
   * @since 1.1.0
   */
  bulkSpawnStaticBoxes(options: BulkStaticBoxesOptions): BulkStaticBoxesResult;

  /**
   * Attach multiple primitive colliders to one body in a single batch call.
   *
   * Uses `physics3d_add_compound_collider` in WASM mode (one round-trip) and
   * falls back to individual `addCollider` calls in local-simulation mode.
   *
   * @param entityId - The entity that owns the rigid body.
   * @param options  - Shapes, shared layer membership, and collision filter.
   * @returns A {@link CompoundColliderHandle3D} on success, or `null` when the
   *          entity has no registered body.
   *
   * @since 1.0.0
   */
  addCompoundCollider(
    entityId: Physics3DEntityId,
    options: CompoundColliderOptions3D,
  ): CompoundColliderHandle3D | null;

  /**
   * Read the sensor contact state for `(entityId, sensorId)`.
   *
   * Returns `{ contactCount: 0, isActive: false }` when the sensor was never
   * registered or has not received any events yet.
   */
  getSensorState(entityId: Physics3DEntityId, sensorId: number): Physics3DSensorState;

  /**
   * Manually update the sensor contact state.
   *
   * Intended for test helpers and advanced gameplay logic.
   */
  updateSensorState(
    entityId: Physics3DEntityId,
    sensorId: number,
    isActive: boolean,
    count: number,
  ): void;

  /**
   * Return all collision contacts resolved for the current frame.
   *
   * Pass `{ max }` to cap the number of returned contacts — useful when only
   * the first N contacts matter and you want to avoid allocating a larger array.
   * When `max` is omitted, all contacts for the frame are returned.
   *
   * The returned array is read-only and ephemeral — do not retain across frames.
   *
   * @param opts.max - Maximum number of contacts to return. @default undefined (all)
   */
  getCollisionContacts(opts?: { max?: number }): ReadonlyArray<Physics3DCollisionContact>;

  /**
   * Return lightweight metrics for the last processed frame.
   *
   * `eventCount` is the number of raw collision events read from the WASM ring
   * buffer this frame (0 in local-simulation mode). Useful for debugging
   * high-collision scenes or detecting buffer saturation.
   */
  getCollisionEventMetrics(): { eventCount: number };

  /**
   * Return a compact read-only snapshot for one entity body.
   *
   * All fields are `null` when the body is not registered.
   */
  getBodySnapshot(entityId: Physics3DEntityId): Physics3DBodySnapshot | undefined;

  /**
   * Return the total number of currently registered body handles.
   *
   * @returns Count of registered bodies across all entity slots.
   *
   * @since 1.0.0
   */
  getBodyCount(): number;

  /**
   * Returns `true` when debug logging is enabled for this plugin instance.
   *
   * @returns The resolved `debug` config value.
   *
   * @since 1.0.0
   */
  isDebugEnabled(): boolean;

  // ─── RFC-08: Joints ──────────────────────────────────────────────────────────

  /**
   * Create a **fixed (weld)** joint that locks two bodies together with no
   * relative movement.
   *
   * In local-simulation mode returns a no-op dummy handle.
   *
   * @param opts - Joint options including the two body identifiers and optional anchors.
   * @returns An opaque joint handle. Pass it to `removeJoint` to destroy the joint.
   */
  addFixedJoint(opts: FixedJointOpts): JointHandle3D;

  /**
   * Create a **revolute (hinge)** joint that allows rotation around a single axis.
   *
   * @param opts - Joint options; includes optional axis and angular limits.
   * @returns An opaque joint handle.
   */
  addRevoluteJoint(opts: RevoluteJointOpts): JointHandle3D;

  /**
   * Create a **prismatic (slider)** joint that allows translation along one axis.
   *
   * @param opts - Joint options; includes optional slide axis and linear limits.
   * @returns An opaque joint handle.
   */
  addPrismaticJoint(opts: PrismaticJointOpts): JointHandle3D;

  /**
   * Create a **ball (spherical)** joint that allows unrestricted rotation.
   *
   * @param opts - Joint options; includes optional cone-angle limit.
   * @returns An opaque joint handle.
   */
  addBallJoint(opts: BallJointOpts): JointHandle3D;

  /**
   * Create a **spring** joint connecting two bodies with configurable stiffness
   * and damping.
   *
   * @param opts - Joint options including rest length, stiffness, and damping.
   * @returns An opaque joint handle.
   */
  addSpringJoint(opts: SpringJointOpts): JointHandle3D;

  /**
   * Destroy a previously created joint.
   *
   * No-op in local-simulation mode.
   *
   * @param id - The joint handle returned by one of the `addXxxJoint` methods.
   */
  removeJoint(id: JointId): void;

  /**
   * Set a motor target velocity on a revolute or prismatic joint.
   *
   * No-op in local-simulation mode.
   *
   * @param id       - Joint handle.
   * @param velocity - Target velocity in rad/s (revolute) or m/s (prismatic).
   * @param maxForce - Maximum force/torque the motor can exert.
   */
  setJointMotorVelocity(id: JointId, velocity: number, maxForce: number): void;

  /**
   * Set a motor target position on a revolute or prismatic joint.
   *
   * No-op in local-simulation mode.
   *
   * @param id        - Joint handle.
   * @param target    - Target angle (rad) or position (m).
   * @param stiffness - Position motor stiffness.
   * @param damping   - Position motor damping.
   */
  setJointMotorPosition(id: JointId, target: number, stiffness: number, damping: number): void;

  /**
   * Enable or disable a joint without destroying it.
   *
   * No-op in local-simulation mode.
   *
   * @param id      - Joint handle.
   * @param enabled - `true` to enable; `false` to disable.
   */
  setJointEnabled(id: JointId, enabled: boolean): void;

  // ─── RFC-09: Continuous forces ────────────────────────────────────────────────

  /**
   * Apply a continuous linear force to a body in N (accumulates each step).
   *
   * In WASM mode delegates to Rapier's force accumulator.
   * In local mode accumulates the force internally and applies it next step.
   *
   * @param entityId - Target entity.
   * @param force    - Force vector in N. Missing components default to `0`.
   */
  addForce(entityId: Physics3DEntityId, force: Partial<Physics3DVec3>): void;

  /**
   * Apply a continuous torque to a body in N·m (accumulates each step).
   *
   * @param entityId - Target entity.
   * @param torque   - Torque vector in N·m. Missing components default to `0`.
   */
  addTorque(entityId: Physics3DEntityId, torque: Partial<Physics3DVec3>): void;

  /**
   * Apply a force at a specific world-space point, generating both a linear
   * force and a torque around the centre of mass.
   *
   * In local mode approximated as a centre-of-mass force (no torque contribution).
   *
   * @param entityId - Target entity.
   * @param force    - Force vector in N.
   * @param point    - World-space application point.
   */
  addForceAtPoint(
    entityId: Physics3DEntityId,
    force: Partial<Physics3DVec3>,
    point: Partial<Physics3DVec3>,
  ): void;

  /**
   * Override the per-body gravity scale multiplier.
   *
   * `0` disables gravity; `1` is normal; negative values invert it.
   *
   * @param entityId - Target entity.
   * @param scale    - New gravity scale.
   */
  setGravityScale(entityId: Physics3DEntityId, scale: number): void;

  /**
   * Read the current gravity scale for a body.
   *
   * @param entityId - Target entity.
   * @returns Current gravity scale, or `1.0` when not set.
   */
  getGravityScale(entityId: Physics3DEntityId): number;

  /**
   * Lock translation degrees of freedom on a body.
   *
   * In WASM mode delegates to Rapier's axis-lock API.
   * In local mode stores the lock state for use in the local integrator.
   *
   * @param entityId - Target entity.
   * @param x        - Lock translation along the world X axis.
   * @param y        - Lock translation along the world Y axis.
   * @param z        - Lock translation along the world Z axis.
   */
  lockTranslations(entityId: Physics3DEntityId, x: boolean, y: boolean, z: boolean): void;

  /**
   * Lock rotation degrees of freedom on a body.
   *
   * @param entityId - Target entity.
   * @param x        - Lock rotation around the world X axis.
   * @param y        - Lock rotation around the world Y axis.
   * @param z        - Lock rotation around the world Z axis.
   */
  lockRotations(entityId: Physics3DEntityId, x: boolean, y: boolean, z: boolean): void;

  /**
   * Manually put a body to sleep or wake it up.
   *
   * Sleeping bodies are excluded from the simulation until woken.
   *
   * @param entityId - Target entity.
   * @param sleeping - `true` to sleep; `false` to wake.
   */
  setBodySleeping(entityId: Physics3DEntityId, sleeping: boolean): void;

  /**
   * Returns `true` when the body is currently sleeping.
   *
   * @param entityId - Target entity.
   */
  isBodySleeping(entityId: Physics3DEntityId): boolean;

  /**
   * Wake every sleeping body in the physics world.
   */
  wakeAll(): void;

  // ─── RFC-09: Pathfinding ──────────────────────────────────────────────────────

  /**
   * Upload a voxel navigation grid to the physics world.
   *
   * In WASM mode the grid is transferred to Rapier's A* pathfinder.
   * In local mode the grid is stored for JavaScript A* use.
   *
   * @param opts - Grid dimensions, cell size, origin, and the raw voxel data.
   */
  initNavGrid3D(opts: Pathfinding3DOptions): void;

  /**
   * Find a path between two world-space points using the uploaded navigation grid.
   *
   * Returns an ordered list of waypoints from `from` to `to`.
   * Returns an empty array when no path exists or the grid is not initialized.
   *
   * @param from - Start position in world space.
   * @param to   - End position in world space.
   */
  findPath3D(from: Physics3DVec3, to: Physics3DVec3): PathWaypoint3D[];

  // ─── RFC-07: Spatial queries (imperative) ────────────────────────────────────

  /**
   * Cast a ray from `origin` in `direction` and return the nearest hit.
   *
   * Not available in local-simulation mode (returns `null`).
   *
   * @param origin    - Ray origin in world space.
   * @param direction - Ray direction (should be normalized).
   * @param maxDist   - Maximum travel distance in metres.
   * @param opts      - Optional layer filter and solid-hit flag.
   * @returns The nearest {@link RayHit}, or `null` when nothing was struck.
   */
  castRay(
    origin: Physics3DVec3,
    direction: Physics3DVec3,
    maxDist: number,
    opts?: { layers?: number; mask?: number; solid?: boolean },
  ): RayHit | null;

  /**
   * Sweep a convex shape through the scene and return the first contact.
   *
   * Not available in local-simulation mode (returns `null`).
   *
   * @param pos     - Starting position of the shape in world space.
   * @param rot     - Starting rotation of the shape.
   * @param dir     - Sweep direction.
   * @param shape   - Convex shape to cast.
   * @param maxDist - Maximum sweep distance in metres.
   * @param opts    - Optional layer filter.
   * @returns The first {@link ShapeHit}, or `null` when nothing was struck.
   */
  castShape(
    pos: Physics3DVec3,
    rot: Physics3DQuat,
    dir: Physics3DVec3,
    shape: Physics3DColliderShape,
    maxDist: number,
    opts?: { layers?: number; mask?: number },
  ): ShapeHit | null;

  /**
   * Return all entities whose colliders overlap with a shape placed at `pos`/`rot`.
   *
   * Not available in local-simulation mode (returns `[]`).
   *
   * @param pos   - Query position in world space.
   * @param rot   - Query rotation.
   * @param shape - Shape to test for overlap.
   * @param opts  - Optional layer filter and result cap.
   * @returns Array of overlapping entity IDs.
   */
  overlapShape(
    pos: Physics3DVec3,
    rot: Physics3DQuat,
    shape: Physics3DColliderShape,
    opts?: { layers?: number; mask?: number; maxResults?: number },
  ): Physics3DEntityId[];

  /**
   * Project a point onto the nearest collider surface.
   *
   * Not available in local-simulation mode (returns `null`).
   *
   * @param point - World-space point to project.
   * @param opts  - Optional layer filter and solid-hit flag.
   * @returns A {@link PointProjection} with the projected position, or `null`.
   */
  projectPoint(
    point: Physics3DVec3,
    opts?: { layers?: number; mask?: number; solid?: boolean },
  ): PointProjection | null;

  // ─── RFC-09: Character Controller ────────────────────────────────────────────

  /**
   * Create and register a character controller for an entity.
   *
   * The entity must have a body registered via `createBody` before calling this.
   * In local-simulation mode returns an inert handle that performs naive position integration.
   *
   * @param entityId - Target entity.
   * @param opts     - Controller parameters (step height, slope limit, etc.).
   * @returns A {@link CharacterControllerHandle} for driving the controller each frame.
   */
  addCharacterController(
    entityId: Physics3DEntityId,
    opts?: CharacterControllerOpts,
  ): CharacterControllerHandle;

  /**
   * Remove the character controller associated with an entity.
   *
   * @param entityId - Target entity whose controller should be destroyed.
   */
  removeCharacterController(entityId: Physics3DEntityId): void;

  // ─── RFC-07: Composable slot registration ────────────────────────────────────

  /**
   * Register a persistent per-frame raycast slot.
   *
   * The slot is evaluated once per physics step and its result is accessible
   * through the returned handle without any allocation.
   *
   * @param opts          - Raycast configuration.
   * @param staticSlotIdx - Optional pre-assigned slot index for SAB-backed casts.
   * @returns A {@link RaycastHandle} whose properties reflect the latest result.
   */
  registerRaycastSlot(opts: RaycastOpts, staticSlotIdx?: number): RaycastHandle;

  /**
   * Remove a previously registered raycast slot.
   *
   * @param handle - The handle returned by `registerRaycastSlot`.
   */
  unregisterRaycastSlot(handle: RaycastHandle): void;

  /**
   * Register a persistent per-frame shape-cast slot.
   *
   * @param opts          - Shape-cast configuration.
   * @param staticSlotIdx - Optional pre-assigned slot index.
   * @returns A {@link ShapeCastHandle} whose properties reflect the latest result.
   */
  registerShapeCastSlot(opts: ShapeCastOpts, staticSlotIdx?: number): ShapeCastHandle;

  /**
   * Remove a previously registered shape-cast slot.
   *
   * @param handle - The handle returned by `registerShapeCastSlot`.
   */
  unregisterShapeCastSlot(handle: ShapeCastHandle): void;

  /**
   * Register a persistent per-frame overlap slot.
   *
   * @param opts          - Overlap configuration.
   * @param staticSlotIdx - Optional pre-assigned slot index.
   * @returns An {@link OverlapHandle} whose properties reflect the latest result.
   */
  registerOverlapSlot(opts: OverlapOpts, staticSlotIdx?: number): OverlapHandle;

  /**
   * Remove a previously registered overlap slot.
   *
   * @param handle - The handle returned by `registerOverlapSlot`.
   */
  unregisterOverlapSlot(handle: OverlapHandle): void;
}
