/**
 * Internal raw event read from the WASM ring buffer.
 * Carries slot indices not exposed on the public `Physics3DCollisionContact`.
 */
export type InternalCollisionEvent3D = {
  slotA: number;
  slotB: number;
  aColliderId: number | undefined;
  bColliderId: number | undefined;
  started: boolean;
};

/**
 * WASM exports available in the physics3d variant.
 *
 * A fallible export throws an `Error` with a `code` property (`PHYSICS3D:*`, or
 * `CORE:INVALID_SHARED_BUFFER` for the overlap output pointer). It never returns a
 * sentinel for a failure: a `boolean` result is `true` on success, a joint or
 * controller result is the new id or slot. Absence stays a value: an empty
 * `Float32Array` for a vector getter on a missing body, `[0]` for a query miss.
 * The plugin maps a throw to `GwenWasmError` in `./wasm-errors`.
 */
export interface Physics3DWasmBridge {
  // World lifecycle
  physics3d_init?: (gx: number, gy: number, gz: number, maxEntities: number) => void;
  /** Throws `PHYSICS3D:NOT_INITIALIZED` before `physics3d_init`. Throws `PHYSICS3D:INVALID_STEP_DELTA` when `delta` is not finite or sits outside 0 to 1. */
  physics3d_step?: (delta: number) => void;
  /**
   * Drains bodies disabled during the last step.
   * Interleaved `[slot, code]` pairs: `0` non-finite, `1` out-of-bounds, `2` velocity.
   */
  physics3d_take_disabled_slots?: () => Uint32Array;
  /**
   * Sets the linear-speed cap in metres per second.
   * Returns `1` when the value is stored, `0` when it is refused.
   */
  physics3d_set_max_linear_velocity?: (value: number) => number;
  physics3d_set_quality?: (preset: number) => void;
  physics3d_set_event_coalescing?: (enabled: boolean) => void;
  /**
   * Set the number of additional solver iterations for a specific body.
   * Overrides the world-level quality preset for that body.
   *
   * @param entityIndex - ECS entity slot index.
   * @param iterations  - Number of additional solver iterations (0 = world default).
   * @returns `true` on success. Throws `PHYSICS3D:BODY_NOT_FOUND` for an unknown slot.
   */
  physics3d_set_body_solver_iterations?: (entityIndex: number, iterations: number) => boolean;

  // Body lifecycle
  /** Returns `true`. Throws `PHYSICS3D:BODY_ALREADY_EXISTS` when the slot has a body. */
  physics3d_add_body?: (
    entityIndex: number,
    x: number,
    y: number,
    z: number,
    kind: number,
    mass: number,
    linearDamping: number,
    angularDamping: number,
  ) => boolean;
  /** Returns `true`. Throws `PHYSICS3D:BODY_NOT_FOUND` when the slot has no body. */
  physics3d_remove_body?: (entityIndex: number) => boolean;
  physics3d_has_body?: (entityIndex: number) => boolean;

  // State read/write — Float32Array layout: [px,py,pz, qx,qy,qz,qw, vx,vy,vz, ax,ay,az].
  // An empty array means the slot has no body.
  physics3d_get_body_state?: (entityIndex: number) => Float32Array;
  physics3d_set_body_state?: (
    entityIndex: number,
    px: number,
    py: number,
    pz: number,
    qx: number,
    qy: number,
    qz: number,
    qw: number,
    vx: number,
    vy: number,
    vz: number,
    ax: number,
    ay: number,
    az: number,
  ) => boolean;

  // Velocity
  physics3d_get_linear_velocity?: (entityIndex: number) => Float32Array;
  physics3d_set_linear_velocity?: (
    entityIndex: number,
    vx: number,
    vy: number,
    vz: number,
  ) => boolean;
  physics3d_get_angular_velocity?: (entityIndex: number) => Float32Array;
  physics3d_set_angular_velocity?: (
    entityIndex: number,
    ax: number,
    ay: number,
    az: number,
  ) => boolean;

  // Impulse
  physics3d_apply_impulse?: (entityIndex: number, ix: number, iy: number, iz: number) => boolean;
  physics3d_apply_angular_impulse?: (
    entityIndex: number,
    ix: number,
    iy: number,
    iz: number,
  ) => boolean;

  // Body kind
  /** Returns `0`, `1` or `2`. Throws `PHYSICS3D:BODY_NOT_FOUND` when the slot has no body. */
  physics3d_get_body_kind?: (entityIndex: number) => number;
  physics3d_set_body_kind?: (entityIndex: number, kind: number) => boolean;

  // Kinematic positioning
  physics3d_set_kinematic_position?: (
    entityIndex: number,
    px: number,
    py: number,
    pz: number,
    qx: number,
    qy: number,
    qz: number,
    qw: number,
  ) => boolean;
  /** Returns the number of bodies moved. Throws `PHYSICS3D:BUFFER_LENGTH_MISMATCH`. */
  physics3d_bulk_step_kinematics?: (
    slots: Uint32Array,
    vx: Float32Array,
    vy: Float32Array,
    vz: Float32Array,
    dt: number,
  ) => number;
  /** Returns the number of bodies rotated. Throws `PHYSICS3D:BUFFER_LENGTH_MISMATCH`. */
  physics3d_bulk_step_kinematic_rotations?: (
    slots: Uint32Array,
    wx: Float32Array,
    wy: Float32Array,
    wz: Float32Array,
    dt: number,
  ) => number;

  // Collider management
  physics3d_add_box_collider?: (
    entityIndex: number,
    halfX: number,
    halfY: number,
    halfZ: number,
    offsetX: number,
    offsetY: number,
    offsetZ: number,
    isSensor: boolean,
    friction: number,
    restitution: number,
    membership: number,
    filter: number,
    colliderId: number,
  ) => boolean;
  physics3d_add_sphere_collider?: (
    entityIndex: number,
    radius: number,
    offsetX: number,
    offsetY: number,
    offsetZ: number,
    isSensor: boolean,
    friction: number,
    restitution: number,
    membership: number,
    filter: number,
    colliderId: number,
  ) => boolean;
  physics3d_add_capsule_collider?: (
    entityIndex: number,
    radius: number,
    halfHeight: number,
    offsetX: number,
    offsetY: number,
    offsetZ: number,
    isSensor: boolean,
    friction: number,
    restitution: number,
    membership: number,
    filter: number,
    colliderId: number,
  ) => boolean;
  physics3d_add_heightfield_collider?: (
    entityIndex: number,
    heightsFlat: Float32Array,
    rows: number,
    cols: number,
    scaleX: number,
    scaleY: number,
    scaleZ: number,
    friction: number,
    restitution: number,
    layerBits: number,
    maskBits: number,
    colliderId: number,
  ) => boolean;
  physics3d_update_heightfield_collider?: (
    entityIndex: number,
    colliderId: number,
    heightsFlat: Float32Array,
    rows: number,
    cols: number,
    scaleX: number,
    scaleY: number,
    scaleZ: number,
    friction: number,
    restitution: number,
    layerBits: number,
    maskBits: number,
  ) => boolean;
  physics3d_add_compound_collider?: (
    entityIndex: number,
    shapeData: Float32Array,
    layerBits: number,
    maskBits: number,
  ) => number;
  /** Returns `true`. Throws `PHYSICS3D:COLLIDER_NOT_FOUND` when the pair is unknown. */
  physics3d_remove_collider?: (entityIndex: number, colliderId: number) => boolean;
  /**
   * Attach a triangle-mesh collider to a 3D body.
   * Parameter order matches the Rust WASM export exactly.
   */
  physics3d_add_mesh_collider?: (
    entityIndex: number,
    vertices: Float32Array,
    indices: Uint32Array,
    offsetX: number,
    offsetY: number,
    offsetZ: number,
    isSensor: boolean,
    friction: number,
    restitution: number,
    layerBits: number,
    maskBits: number,
    colliderId: number,
  ) => boolean;
  /**
   * Rebuild an existing triangle-mesh collider with new geometry.
   * Removes the old trimesh and inserts a fresh one atomically inside Rapier3D.
   * Parameter order matches the Rust WASM export exactly.
   */
  physics3d_rebuild_mesh_collider?: (
    entityIndex: number,
    colliderId: number,
    vertices: Float32Array,
    indices: Uint32Array,
    offsetX: number,
    offsetY: number,
    offsetZ: number,
    isSensor: boolean,
    friction: number,
    restitution: number,
    layerBits: number,
    maskBits: number,
  ) => boolean;
  /**
   * Attach a pre-baked BVH triangle-mesh collider to a 3D body.
   * The `bvhBytes` parameter is the raw BVH binary emitted by the Vite plugin.
   * Parameter order matches the Rust WASM export exactly.
   */
  physics3d_load_bvh_collider?: (
    entityIndex: number,
    bvhBytes: Uint8Array,
    offsetX: number,
    offsetY: number,
    offsetZ: number,
    isSensor: boolean,
    friction: number,
    restitution: number,
    layerBits: number,
    maskBits: number,
    colliderId: number,
  ) => boolean;
  /**
   * Attach a convex-hull collider to a 3D body.
   * Throws `PHYSICS3D:INVALID_SHAPE` for fewer than 4 points.
   * Parameter order matches the Rust WASM export exactly.
   */
  physics3d_add_convex_collider?: (
    entityIndex: number,
    vertices: Float32Array,
    offsetX: number,
    offsetY: number,
    offsetZ: number,
    isSensor: boolean,
    friction: number,
    restitution: number,
    density: number,
    layerBits: number,
    maskBits: number,
    colliderId: number,
  ) => boolean;
  /**
   * Bulk-spawn N static box bodies in one WASM call.
   * `entityIndices` must be pre-allocated by the TypeScript caller.
   * Returns the number of bodies spawned. Throws `PHYSICS3D:BODY_ALREADY_EXISTS` or
   * `PHYSICS3D:BUFFER_LENGTH_MISMATCH`; nothing is written when it throws.
   */
  physics3d_bulk_spawn_static_boxes?: (
    entityIndices: Uint32Array,
    positionsFlat: Float32Array,
    halfExtentsFlat: Float32Array,
    friction: number,
    restitution: number,
    layerBits: number,
    maskBits: number,
  ) => number;

  // Sensor
  /**
   * Packed state: bits 0-31 are the contact count, bit 32 is the active flag.
   * `0n` when no state was recorded. Throws `PHYSICS3D:BODY_NOT_FOUND`.
   */
  physics3d_get_sensor_state?: (entityIndex: number, sensorId: number) => bigint;
  physics3d_update_sensor_state?: (
    entityIndex: number,
    sensorId: number,
    isActive: boolean,
    count: number,
  ) => void;

  // Collision events
  physics3d_get_collision_events_ptr?: () => number;
  physics3d_get_collision_event_count?: () => number;
  /** Throws `PHYSICS3D:NOT_INITIALIZED` before `physics3d_init`. */
  physics3d_consume_events?: () => void;

  // Memory
  memory?: WebAssembly.Memory;

  // ─── RFC-08: Joints ──────────────────────────────────────────────────────────

  /** Create a fixed (weld) joint. Returns the joint id. Throws `PHYSICS3D:BODY_NOT_FOUND` or `PHYSICS3D:INVALID_JOINT`. */
  physics3d_add_fixed_joint?: (
    slotA: number,
    slotB: number,
    anchorAx: number,
    anchorAy: number,
    anchorAz: number,
    anchorBx: number,
    anchorBy: number,
    anchorBz: number,
  ) => number;

  /** Create a revolute (hinge) joint. Returns the joint id. Throws `PHYSICS3D:BODY_NOT_FOUND` or `PHYSICS3D:INVALID_JOINT`. */
  physics3d_add_revolute_joint?: (
    slotA: number,
    slotB: number,
    anchorAx: number,
    anchorAy: number,
    anchorAz: number,
    anchorBx: number,
    anchorBy: number,
    anchorBz: number,
    axisX: number,
    axisY: number,
    axisZ: number,
    useLimits: boolean,
    limitMin: number,
    limitMax: number,
  ) => number;

  /** Create a prismatic (slider) joint. Returns the joint id. Throws `PHYSICS3D:BODY_NOT_FOUND` or `PHYSICS3D:INVALID_JOINT`. */
  physics3d_add_prismatic_joint?: (
    slotA: number,
    slotB: number,
    anchorAx: number,
    anchorAy: number,
    anchorAz: number,
    anchorBx: number,
    anchorBy: number,
    anchorBz: number,
    axisX: number,
    axisY: number,
    axisZ: number,
    useLimits: boolean,
    limitMin: number,
    limitMax: number,
  ) => number;

  /** Create a ball (spherical) joint. Returns the joint id. Throws `PHYSICS3D:BODY_NOT_FOUND` or `PHYSICS3D:INVALID_JOINT`. */
  physics3d_add_ball_joint?: (
    slotA: number,
    slotB: number,
    anchorAx: number,
    anchorAy: number,
    anchorAz: number,
    anchorBx: number,
    anchorBy: number,
    anchorBz: number,
    useConeLimit: boolean,
    coneAngle: number,
  ) => number;

  /** Create a spring joint. Returns the joint id. Throws `PHYSICS3D:BODY_NOT_FOUND` or `PHYSICS3D:INVALID_JOINT`. */
  physics3d_add_spring_joint?: (
    slotA: number,
    slotB: number,
    anchorAx: number,
    anchorAy: number,
    anchorAz: number,
    anchorBx: number,
    anchorBy: number,
    anchorBz: number,
    restLength: number,
    stiffness: number,
    damping: number,
  ) => number;

  /** Destroy a joint by its numeric id. Returns `true`. Throws `PHYSICS3D:JOINT_NOT_FOUND`. */
  physics3d_remove_joint?: (id: number) => boolean;

  /** Set a motor velocity target. Returns `true`. Throws `PHYSICS3D:JOINT_NOT_FOUND` or `PHYSICS3D:INVALID_JOINT`. */
  physics3d_set_joint_motor_velocity?: (id: number, velocity: number, maxForce: number) => boolean;

  /** Set a motor position target. Returns `true`. Throws `PHYSICS3D:JOINT_NOT_FOUND` or `PHYSICS3D:INVALID_JOINT`. */
  physics3d_set_joint_motor_position?: (
    id: number,
    target: number,
    stiffness: number,
    damping: number,
  ) => boolean;

  /** Enable or disable a joint. Returns `true`. Throws `PHYSICS3D:JOINT_NOT_FOUND`. */
  physics3d_set_joint_enabled?: (id: number, enabled: boolean) => boolean;

  // ─── RFC-09: Continuous forces ────────────────────────────────────────────────

  /** Apply a linear force to a body (accumulates per step). Returns `true`. Throws `PHYSICS3D:BODY_NOT_FOUND`. */
  physics3d_add_force?: (entityIndex: number, fx: number, fy: number, fz: number) => boolean;

  /** Apply a torque to a body (accumulates per step). Returns `true`. Throws `PHYSICS3D:BODY_NOT_FOUND`. */
  physics3d_add_torque?: (entityIndex: number, tx: number, ty: number, tz: number) => boolean;

  /** Apply a force at a specific world-space point. */
  physics3d_add_force_at_point?: (
    entityIndex: number,
    fx: number,
    fy: number,
    fz: number,
    px: number,
    py: number,
    pz: number,
  ) => boolean;

  /** Set the per-body gravity scale multiplier. Returns `true`. Throws `PHYSICS3D:BODY_NOT_FOUND`. */
  physics3d_set_gravity_scale?: (entityIndex: number, scale: number) => boolean;

  /** Read the per-body gravity scale multiplier. Throws `PHYSICS3D:BODY_NOT_FOUND`. */
  physics3d_get_gravity_scale?: (entityIndex: number) => number;

  /** Lock translation axes on a body. Returns `true`. Throws `PHYSICS3D:BODY_NOT_FOUND`. */
  physics3d_lock_translations?: (
    entityIndex: number,
    x: boolean,
    y: boolean,
    z: boolean,
  ) => boolean;

  /** Lock rotation axes on a body. Returns `true`. Throws `PHYSICS3D:BODY_NOT_FOUND`. */
  physics3d_lock_rotations?: (entityIndex: number, x: boolean, y: boolean, z: boolean) => boolean;

  /** Put a body to sleep or wake it up. Returns `true`. Throws `PHYSICS3D:BODY_NOT_FOUND`. */
  physics3d_set_body_sleeping?: (entityIndex: number, sleeping: boolean) => boolean;

  /** Returns `true` when the body is sleeping. Throws `PHYSICS3D:BODY_NOT_FOUND`. */
  physics3d_is_body_sleeping?: (entityIndex: number) => boolean;

  /** Wake every sleeping body in the world. */
  physics3d_wake_all?: () => void;

  // ─── RFC-09: Pathfinding ──────────────────────────────────────────────────────

  /**
   * Upload a voxel navigation grid.
   * Throws `PHYSICS3D:INVALID_NAVGRID` for a zero dimension, an overflow, a grid over the cell
   * limit, or a byte length that differs from `width * height * depth`.
   */
  physics3d_init_navgrid_3d?: (
    cells: Uint8Array,
    width: number,
    height: number,
    depth: number,
    cellSize: number,
    originX: number,
    originY: number,
    originZ: number,
  ) => void;

  /**
   * Find a path from `from` to `to` using the uploaded navigation grid.
   * Returns the number of waypoints written to the path buffer.
   * Throws `PHYSICS3D:NAVGRID_NOT_INITIALIZED` before the grid upload and
   * `PHYSICS3D:INVALID_PATH_REQUEST` for a coordinate that is not finite or too large.
   */
  physics3d_find_path_3d?: (
    fromX: number,
    fromY: number,
    fromZ: number,
    toX: number,
    toY: number,
    toZ: number,
  ) => number;

  /** Return the WASM linear-memory pointer to the path waypoint buffer. */
  physics3d_get_path_buffer_ptr_3d?: () => number;

  // ─── RFC-07: Spatial queries ──────────────────────────────────────────────────

  /**
   * Cast a ray. Returns a Float32Array:
   * `[hit, entityIndex, distance, nx, ny, nz, px, py, pz]`.
   * `result[0] === 0` means no hit. A miss is `[0]`.
   * Throws `PHYSICS3D:INVALID_QUERY` when the origin is not finite or sits outside ±1e7,
   * the direction is not finite or is zero, or `maxDist` is not finite or is negative.
   */
  physics3d_cast_ray?: (
    originX: number,
    originY: number,
    originZ: number,
    dirX: number,
    dirY: number,
    dirZ: number,
    maxDist: number,
    layers: number,
    mask: number,
    solid: boolean,
  ) => Float32Array;

  /**
   * Cast a convex shape. Returns a 15-float Float32Array:
   * `[hit, entityIndex, toi, nx, ny, nz, px, py, pz, waAx, waAy, waAz, waBx, waBy, waBz]`.
   * `result[0] === 0` means no hit.
   * Throws `PHYSICS3D:INVALID_COLLIDER` when the pose or a box, ball or capsule size is refused.
   * Throws `PHYSICS3D:INVALID_QUERY` when the direction or `maxDist` is refused.
   */
  physics3d_cast_shape?: (
    posX: number,
    posY: number,
    posZ: number,
    rotX: number,
    rotY: number,
    rotZ: number,
    rotW: number,
    dirX: number,
    dirY: number,
    dirZ: number,
    shapeType: number,
    p0: number,
    p1: number,
    p2: number,
    maxDist: number,
    layers: number,
    mask: number,
  ) => Float32Array;

  /**
   * Test a shape for overlap against all colliders.
   * Writes up to `maxResults` entity slot indices into the scratch buffer at
   * `outPtr`. Returns the number of overlapping entities found.
   * Throws `CORE:INVALID_SHARED_BUFFER` when `outPtr` is not the start of a live shared
   * allocation of at least `maxResults * 4` bytes.
   */
  physics3d_overlap_shape?: (
    posX: number,
    posY: number,
    posZ: number,
    rotX: number,
    rotY: number,
    rotZ: number,
    rotW: number,
    shapeType: number,
    p0: number,
    p1: number,
    p2: number,
    layers: number,
    mask: number,
    outPtr: number,
    maxResults: number,
  ) => number;

  /**
   * Project a world-space point onto the nearest collider.
   * Returns a 6-float Float32Array:
   * `[hit, entityIndex, projX, projY, projZ, isInside]`.
   * `result[0] === 0` means no hit.
   * Throws `PHYSICS3D:INVALID_QUERY` when the point is not finite or sits outside ±1e7.
   * That query-point cap is a separate input guard. `trimesh_builder` refuses a vertex
   * above 1e9 (`world.rs:545-547`). `decoded_mesh_is_valid` applies that cap on
   * `load_bvh_collider` (`world.rs:624-627`). parry3d-0.17.6
   * `query/point/point_composite_shape.rs:152` unwraps a missing projection.
   * Probe cases `mesh pose fixed 1e19 1m`, `mesh pose fixed 1e19 cap`,
   * `mesh pose fixed 1e30 1m`, `mesh pose fixed 1e30 cap`, `mesh pose fixed max 1m`,
   * `mesh pose fixed max cap`, `mesh pose kinematic 1e19 1m` and
   * `mesh pose kinematic 1e19 cap` use a pose up to `f32::MAX` and do not panic.
   */
  physics3d_project_point?: (
    pointX: number,
    pointY: number,
    pointZ: number,
    layers: number,
    mask: number,
    solid: boolean,
  ) => Float32Array;

  // ─── RFC-09: Character Controller ────────────────────────────────────────────

  /**
   * Create a character controller for the given entity slot.
   * Returns the controller's SAB slot index.
   * Throws `PHYSICS3D:CHARACTER_CONTROLLER_LIMIT_REACHED` when the pool is full (the pool is
   * unchanged) and `PHYSICS3D:BODY_NOT_FOUND` for a slot without a body.
   */
  physics3d_add_character_controller?: (
    entityIndex: number,
    stepHeight: number,
    slopeLimit: number,
    skinWidth: number,
    snapToGround: number,
    slideOnSteepSlopes: boolean,
    applyImpulsesToDynamic: boolean,
  ) => number;

  /**
   * Drive a character controller for one frame.
   * Results are written to the CC SAB buffer (see `physics3d_get_cc_sab_ptr`).
   * Throws `PHYSICS3D:CHARACTER_CONTROLLER_NOT_FOUND` when the slot has no controller.
   *
   * @param entityIndex - ECS entity slot index.
   * @param vx - Desired velocity X component (m/s).
   * @param vy - Desired velocity Y component (m/s).
   * @param vz - Desired velocity Z component (m/s).
   * @param dt - Frame delta time in seconds.
   */
  physics3d_character_controller_move?: (
    entityIndex: number,
    vx: number,
    vy: number,
    vz: number,
    dt: number,
  ) => void;

  /** Remove the character controller for an entity. Throws `PHYSICS3D:CHARACTER_CONTROLLER_NOT_FOUND`. */
  physics3d_remove_character_controller?: (entityIndex: number) => void;

  /**
   * Returns the WASM linear-memory byte offset of the CC state buffer.
   *
   * Buffer layout per slot (stride = 5 × f32):
   * `[grounded, normal_x, normal_y, normal_z, ground_entity_bits]`
   */
  physics3d_get_cc_sab_ptr?: () => number;

  /** Returns the maximum number of concurrent character controllers (default: 32). */
  physics3d_get_max_cc_entities?: () => number;

  // ─── RFC-07: Composable persistent slots ─────────────────────────────────────

  /**
   * Pre-register a raycast slot so Rust writes results to `slotPtr` each step.
   */
  physics3d_add_raycast_slot?: (
    slotPtr: number,
    originX: number,
    originY: number,
    originZ: number,
    dirX: number,
    dirY: number,
    dirZ: number,
    maxDist: number,
    layers: number,
    mask: number,
    solid: boolean,
  ) => void;

  /** Pre-register a shape-cast slot so Rust writes results to `slotPtr` each step. */
  physics3d_add_shapecast_slot?: (
    slotPtr: number,
    shapeType: number,
    p0: number,
    p1: number,
    p2: number,
    originX: number,
    originY: number,
    originZ: number,
    rotX: number,
    rotY: number,
    rotZ: number,
    rotW: number,
    dirX: number,
    dirY: number,
    dirZ: number,
    maxDist: number,
    layers: number,
    mask: number,
  ) => void;

  /** Pre-register an overlap slot so Rust writes results to `slotPtr` each step. */
  physics3d_add_overlap_slot?: (
    slotPtr: number,
    shapeType: number,
    p0: number,
    p1: number,
    p2: number,
    originX: number,
    originY: number,
    originZ: number,
    rotX: number,
    rotY: number,
    rotZ: number,
    rotW: number,
    layers: number,
    mask: number,
    maxResults: number,
  ) => void;
}

/** Minimal bridge runtime shape returned by getWasmBridge(). */
export interface Physics3DBridgeRuntime {
  variant: "light" | "physics2d" | "physics3d";
  getPhysicsBridge(): Physics3DWasmBridge;
  getLinearMemory?(): WebAssembly.Memory | null;
  /** Returns the current generation counter for an entity slot index. */
  getEntityGeneration?(index: number): number | undefined;
}
