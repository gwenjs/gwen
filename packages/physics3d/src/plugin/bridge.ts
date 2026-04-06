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

/** WASM exports available in the physics3d variant. */
export interface Physics3DWasmBridge {
  // World lifecycle
  physics3d_init?: (gx: number, gy: number, gz: number, maxEntities: number) => void;
  physics3d_step?: (delta: number) => void;
  physics3d_set_quality?: (preset: number) => void;
  physics3d_set_event_coalescing?: (enabled: number) => void;
  /**
   * Set the number of additional solver iterations for a specific body.
   * Overrides the world-level quality preset for that body.
   *
   * @param entityIndex - ECS entity slot index.
   * @param iterations  - Number of additional solver iterations (0 = world default).
   * @returns `true` on success.
   */
  physics3d_set_body_solver_iterations?: (entityIndex: number, iterations: number) => boolean;

  // Body lifecycle
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
  physics3d_remove_body?: (entityIndex: number) => boolean;
  physics3d_has_body?: (entityIndex: number) => boolean;

  // State read/write — Float32Array layout: [px,py,pz, qx,qy,qz,qw, vx,vy,vz, ax,ay,az]
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
  physics3d_bulk_step_kinematics?: (
    slots: Uint32Array,
    vx: Float32Array,
    vy: Float32Array,
    vz: Float32Array,
    dt: number,
  ) => number;
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
    friction: number,
    restitution: number,
    density: number,
    isSensor: number,
    membership: number,
    filter: number,
    colliderId: number,
    offsetX: number,
    offsetY: number,
    offsetZ: number,
  ) => boolean;
  physics3d_add_sphere_collider?: (
    entityIndex: number,
    radius: number,
    friction: number,
    restitution: number,
    density: number,
    isSensor: number,
    membership: number,
    filter: number,
    colliderId: number,
    offsetX: number,
    offsetY: number,
    offsetZ: number,
  ) => boolean;
  physics3d_add_capsule_collider?: (
    entityIndex: number,
    radius: number,
    halfHeight: number,
    friction: number,
    restitution: number,
    density: number,
    isSensor: number,
    membership: number,
    filter: number,
    colliderId: number,
    offsetX: number,
    offsetY: number,
    offsetZ: number,
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
    isSensor: number,
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
   * Falls back to a unit sphere on degenerate input (Rapier-side).
   * Parameter order matches the Rust WASM export exactly.
   */
  physics3d_add_convex_collider?: (
    entityIndex: number,
    vertices: Float32Array,
    offsetX: number,
    offsetY: number,
    offsetZ: number,
    isSensor: number,
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
  physics3d_get_sensor_state?: (entityIndex: number, sensorId: number) => BigInt64Array | number[];
  physics3d_update_sensor_state?: (
    entityIndex: number,
    sensorId: number,
    isActive: number,
    count: number,
  ) => void;

  // Collision events
  physics3d_get_collision_events_ptr?: () => number;
  physics3d_get_collision_event_count?: () => number;
  physics3d_consume_events?: () => void;

  // Memory
  memory?: WebAssembly.Memory;

  // ─── RFC-08: Joints ──────────────────────────────────────────────────────────

  /** Create a fixed (weld) joint. Returns the joint id, or 0xFFFFFFFF on failure. */
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

  /** Create a revolute (hinge) joint. Returns the joint id, or 0xFFFFFFFF on failure. */
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

  /** Create a prismatic (slider) joint. Returns the joint id, or 0xFFFFFFFF on failure. */
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

  /** Create a ball (spherical) joint. Returns the joint id, or 0xFFFFFFFF on failure. */
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

  /** Create a spring joint. Returns the joint id, or 0xFFFFFFFF on failure. */
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

  /** Destroy a joint by its numeric id. */
  physics3d_remove_joint?: (id: number) => void;

  /** Set a motor velocity target on a revolute or prismatic joint. */
  physics3d_set_joint_motor_velocity?: (id: number, velocity: number, maxForce: number) => void;

  /** Set a motor position target on a revolute or prismatic joint. */
  physics3d_set_joint_motor_position?: (
    id: number,
    target: number,
    stiffness: number,
    damping: number,
  ) => void;

  /** Enable or disable a joint. */
  physics3d_set_joint_enabled?: (id: number, enabled: boolean) => void;

  // ─── RFC-09: Continuous forces ────────────────────────────────────────────────

  /** Apply a linear force to a body (accumulates per step). */
  physics3d_add_force?: (entityIndex: number, fx: number, fy: number, fz: number) => void;

  /** Apply a torque to a body (accumulates per step). */
  physics3d_add_torque?: (entityIndex: number, tx: number, ty: number, tz: number) => void;

  /** Apply a force at a specific world-space point. */
  physics3d_add_force_at_point?: (
    entityIndex: number,
    fx: number,
    fy: number,
    fz: number,
    px: number,
    py: number,
    pz: number,
  ) => void;

  /** Set the per-body gravity scale multiplier. */
  physics3d_set_gravity_scale?: (entityIndex: number, scale: number) => void;

  /** Read the per-body gravity scale multiplier. */
  physics3d_get_gravity_scale?: (entityIndex: number) => number;

  /** Lock translation axes on a body. */
  physics3d_lock_translations?: (entityIndex: number, x: boolean, y: boolean, z: boolean) => void;

  /** Lock rotation axes on a body. */
  physics3d_lock_rotations?: (entityIndex: number, x: boolean, y: boolean, z: boolean) => void;

  /** Put a body to sleep or wake it up. */
  physics3d_set_body_sleeping?: (entityIndex: number, sleeping: boolean) => void;

  /** Returns `true` when the body is sleeping. */
  physics3d_is_body_sleeping?: (entityIndex: number) => boolean;

  /** Wake every sleeping body in the world. */
  physics3d_wake_all?: () => void;

  // ─── RFC-09: Pathfinding ──────────────────────────────────────────────────────

  /** Upload a voxel navigation grid. */
  physics3d_init_navgrid_3d?: (
    ptr: number,
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
   * `result[0] === 0` means no hit.
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
    solid: number,
  ) => Float32Array;

  /**
   * Cast a convex shape. Returns a 15-float Float32Array:
   * `[hit, entityIndex, toi, nx, ny, nz, px, py, pz, waAx, waAy, waAz, waBx, waBy, waBz]`.
   * `result[0] === 0` means no hit.
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
   */
  physics3d_project_point?: (
    pointX: number,
    pointY: number,
    pointZ: number,
    layers: number,
    mask: number,
    solid: number,
  ) => Float32Array;

  // ─── RFC-09: Character Controller ────────────────────────────────────────────

  /**
   * Create a character controller for the given entity slot.
   * Returns the controller's SAB slot index, or 0xFFFFFFFF on failure.
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

  /** Remove the character controller for an entity. */
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
  variant: 'light' | 'physics2d' | 'physics3d';
  getPhysicsBridge(): Physics3DWasmBridge;
  getLinearMemory?(): WebAssembly.Memory | null;
  /** Returns the current generation counter for an entity slot index. */
  getEntityGeneration?(index: number): number | undefined;
}
