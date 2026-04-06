/**
 * WASM Bridge — Interface between @gwenjs/core (TypeScript) and gwen_core.wasm (Rust).
 *
 * The Rust/WASM core is MANDATORY — no TypeScript fallback exists.
 * Call `await initWasm()` BEFORE creating the Engine, or an error is thrown.
 *
 * ⚠️  INTENTIONAL LARGE FILE — Do not split into separate modules.
 * V8 inlines calls between functions in the same compilation unit.
 * A previous refactor attempt that split this file caused a measurable perf
 * regression on the hot path (entity queries + component reads at ~1000 entities/frame).
 * Keep all bridge code co-located so the JIT can inline across method boundaries.
 *
 * NAVIGATION (use IDE region folding — Ctrl+Shift+[ / Cmd+Shift+[):
 *   #region Types & WASM module interfaces      — variant type contracts (WasmEngine*)
 *   #region Internal state & hot-path buffers   — module-level singletons, zero-alloc views
 *   #region Module loading & initialization     — variant detection, fetch, instantiation
 *   #region WasmBridge public interface         — public API surface
 *   #region WasmBridge implementation           — hot path: entity/component/query calls
 *   #region Singleton management & test utils   — getWasmBridge(), _inject*, _reset*
 *
 * @example
 * ```typescript
 * await initWasm();          // Auto-resolves from @gwenjs/core/wasm/
 * const engine = getEngine();
 * engine.start();
 * ```
 */

import { createEntityId, unpackEntityId, type EntityId } from './engine-api';

// #region Types & WASM module interfaces

/**
 * Available core WASM variants.
 * - light: Minimal ECS core (default)
 * - physics2d: ECS + Rapier2D + Pathfinding 2D
 * - physics3d: ECS + Rapier3D + Pathfinding 3D
 */
export type CoreVariant = 'light' | 'physics2d' | 'physics3d';

/**
 * Opaque entity handle from Rust (index + generation pair).
 * Both fields must be passed back to safely detect stale references.
 */
export interface WasmEntityId {
  readonly index: number;
  readonly generation: number;
}

/** Minimal interface for the wasm-bindgen generated gwen_core module */
export interface GwenCoreWasm {
  Engine: {
    new (maxEntities: number): WasmEngine;
  };
  /**
   * The WASM linear memory exported by gwen-core.
   *
   * wasm-bindgen always exports the memory object as `wasm.memory` on the
   * generated glue module. We expose it here so the TypeScript layer can:
   *   1. Build `DataView` / `TypedArray` views for debug tools.
   *   2. Detect `memory.grow()` events: when Rust allocates enough to
   *      trigger a grow, the underlying `ArrayBuffer` is replaced. Any
   *      previously constructed JS views become "detached" and must be
   *      recreated.  `getLinearMemory()` on the bridge always returns the
   *      live `WebAssembly.Memory` object, so callers should re-wrap
   *      `memory.buffer` on every frame rather than caching the buffer.
   */
  memory?: WebAssembly.Memory;
}

/** Exports common to ALL core variants (light, physics2d, physics3d) */
export interface WasmEngineBase {
  // ── Entity ──────────────────────────────────────────────────────────────

  /** Create a new entity and return its index + generation handle. */
  create_entity(): WasmEntityId;
  /**
   * Destroy an entity slot by index and generation.
   * @returns `false` if the (index, generation) pair is stale (already dead).
   */
  delete_entity(index: number, generation: number): boolean;
  /**
   * Check whether an entity slot is still alive.
   * @returns `false` if the generation does not match (slot was reused).
   */
  is_alive(index: number, generation: number): boolean;
  /** Return the number of currently alive entities. */
  count_entities(): number;

  // ── Component ────────────────────────────────────────────────────────────

  /**
   * Register a new component type in the Rust ECS.
   * @returns A unique `typeId` (u32) used in all subsequent component calls.
   */
  register_component_type(): number;
  /**
   * Attach or overwrite a component on an entity.
   * @param index      Raw entity slot index.
   * @param generation Entity generation counter (stale-reference guard).
   * @param typeId     Component type ID returned by `register_component_type`.
   * @param data       Raw bytes — must match the layout registered for `typeId`.
   * @returns `false` if the entity is dead.
   */
  add_component(index: number, generation: number, typeId: number, data: Uint8Array): boolean;
  /**
   * Remove a component from an entity.
   * @returns `false` if the entity is dead or did not have the component.
   */
  remove_component(index: number, generation: number, typeId: number): boolean;
  /**
   * Check whether an entity has a specific component type.
   * @returns `false` if the entity is dead or the component is absent.
   */
  has_component(index: number, generation: number, typeId: number): boolean;
  /**
   * Read raw component bytes from the Rust ECS.
   * @returns Empty `Uint8Array` if the entity is dead or component is absent.
   */
  get_component_raw(index: number, generation: number, typeId: number): Uint8Array;
  /**
   * Bulk-read component data for multiple entities in a single WASM call.
   * @param slots Raw entity slot indices.
   * @param gens  Per-slot generation counters for stale-reference detection.
   * @param typeId Component type ID returned by `register_component_type`.
   * @param outBuf Caller-allocated output buffer; must be `n * componentSize` bytes.
   * @returns Total bytes written into `outBuf`.
   */
  get_components_bulk(
    slots: Uint32Array,
    gens: Uint32Array,
    typeId: number,
    outBuf: Uint8Array,
  ): number;
  /**
   * Bulk-write component data for multiple entities in a single WASM call.
   * @param slots Raw entity slot indices.
   * @param gens  Per-slot generation counters for stale-reference detection.
   * @param typeId Component type ID returned by `register_component_type`.
   * @param data  Packed component bytes (`n * componentSize` total).
   */
  set_components_bulk(
    slots: Uint32Array,
    gens: Uint32Array,
    typeId: number,
    data: Uint8Array,
  ): void;

  /**
   * Query entities with ALL given component types and bulk-read one component
   * type in a **single WASM call**.
   *
   * @param componentTypeIds - Component type IDs every matching entity must have
   * @param readTypeId       - Which component type to read into `out_buf`
   * @param out_slots        - Output buffer for entity slot indices (filled by WASM)
   * @param out_gens         - Output buffer for entity generations (filled by WASM)
   * @param out_buf          - Output buffer for packed component data (filled by WASM)
   * @returns `[entityCount, bytesWritten]` (Uint32Array of length 2)
   *
   * @performance One WASM boundary crossing regardless of entity count.
   */
  query_read_bulk(
    componentTypeIds: Uint32Array,
    readTypeId: number,
    out_slots: Uint32Array,
    out_gens: Uint32Array,
    out_buf: Uint8Array,
  ): Uint32Array;

  /**
   * Write back component data for a previously-queried entity set in one WASM call.
   *
   * @param slots       - Entity slot indices (from a prior `query_read_bulk` call)
   * @param gens        - Entity generation counters (from a prior `query_read_bulk` call)
   * @param writeTypeId - Component type ID to write
   * @param data        - Packed component bytes (`slots.length * componentSize` total)
   *
   * @performance One WASM boundary crossing regardless of entity count.
   */
  query_write_bulk(
    slots: Uint32Array,
    gens: Uint32Array,
    writeTypeId: number,
    data: Uint8Array,
  ): void;

  // ── Query ────────────────────────────────────────────────────────────────

  /**
   * Update the archetype bitmask for an entity slot.
   * Must be called after every `add_component` / `remove_component` so that
   * `query_entities` returns correct results.
   */
  update_entity_archetype(index: number, typeIds: Uint32Array): void;
  /**
   * Remove an entity slot from all query indexes (called before deletion).
   */
  remove_entity_from_query(index: number): void;
  /**
   * Return the raw slot indices of all entities that have ALL of the given
   * component type IDs.
   * @returns Raw slot indices — NOT packed EntityIds.
   *          Callers must call `get_entity_generation` to reconstruct them.
   */
  query_entities(typeIds: Uint32Array): Uint32Array;
  /**
   * Execute a query and write the results into a static WASM buffer.
   * @param typeIds Component type IDs to match.
   * @returns Number of matching entities (capped at 10,000).
   */
  query_entities_to_buffer(typeIds: Uint32Array): number;
  /**
   * Return the pointer to the static WASM buffer used by `query_entities_to_buffer`.
   */
  get_query_result_ptr(): number;
  /**
   * Return the current generation counter for a slot index.
   * Used to reconstruct a packed `EntityId` from a raw slot index.
   * @returns `0xFFFFFFFF` if the slot has never been used.
   */
  get_entity_generation(index: number): number;

  // ── Transform (RFC-01) ───────────────────────────────────────────────────

  /**
   * Attach a transform component to an entity (position, rotation, scale).
   * Must be called before any other transform operations on this entity.
   */
  add_entity_transform(
    index: number,
    x: number,
    y: number,
    rotation: number,
    scale_x: number,
    scale_y: number,
  ): void;
  /**
   * Set the parent of `child_index` to `parent_index`.
   * Pass `parent_index = 0xFFFFFFFF` (`2^32 - 1`) to detach from any parent.
   * @param keep_world_pos If true, recalculate local transform so world position is preserved.
   */
  set_entity_parent(child_index: number, parent_index: number, keep_world_pos: boolean): void;
  /** Translate an entity by (dx, dy) in local space. */
  translate_entity(index: number, dx: number, dy: number): void;
  /** Set an entity's local position. */
  set_entity_local_position(index: number, x: number, y: number): void;
  /** Set an entity's local rotation in radians. */
  set_entity_local_rotation(index: number, rotation: number): void;
  /** Set an entity's local scale. */
  set_entity_local_scale(index: number, scale_x: number, scale_y: number): void;
  /** Get an entity's local X position. */
  get_entity_local_x(index: number): number;
  /** Get an entity's local Y position. */
  get_entity_local_y(index: number): number;
  /** Get an entity's world X position (after parent chain propagation). */
  get_entity_world_x(index: number): number;
  /** Get an entity's world Y position (after parent chain propagation). */
  get_entity_world_y(index: number): number;
  /** Get an entity's world rotation in radians (after parent chain propagation). */
  get_entity_world_rotation(index: number): number;
  /** Get an entity's local rotation in radians. */
  get_entity_local_rotation(index: number): number;
  /** Return true if the entity has a parent. */
  has_entity_parent(index: number): boolean;
  /**
   * Destroy multiple entities by slot index in a single WASM call.
   * Also removes their transforms.
   */
  bulk_destroy(indices: Uint32Array): void;
  /**
   * Create N entities each with a transform in a single WASM call.
   * @param positions Flat `[x0, y0, x1, y1, …]` array — length must be `2 * N`.
   * @param rotations Flat `[r0, r1, …]` array — length must be `N` (or empty for all-zero).
   * @returns `Uint32Array` of N entity slot indices.
   */
  bulk_spawn_with_transforms(positions: Float32Array, rotations: Float32Array): Uint32Array;

  // ── Game loop ────────────────────────────────────────────────────────────

  /**
   * Advance the Rust simulation by one frame.
   * @param deltaMs Frame delta time in **milliseconds** (Rust side convention).
   */
  tick(deltaMs: number): void;
  /** Return the total number of frames simulated since engine creation. */
  frame_count(): bigint;
  /** Return the delta time of the last `tick()` call, in seconds. */
  delta_time(): number;
  /** Return the total elapsed time since engine creation, in seconds. */
  total_time(): number;

  // ── Shared memory (WASM plugin bridge) ───────────────────────────────────

  /**
   * Allocate `byteLength` bytes in gwen-core's WASM linear memory.
   * @returns A raw pointer (usize) into WASM linear memory.
   */
  alloc_shared_buffer(byteLength: number): number;
  /**
   * Copy ECS transform data into the shared buffer so WASM plugins can read it.
   * @param ptr    Pointer returned by `alloc_shared_buffer`.
   * @param maxEntities  Number of entity slots to sync.
   */
  sync_transforms_to_buffer(ptr: number, maxEntities: number): void;
  /**
   * Copy ONLY dirty ECS transform data into the shared buffer.
   * @param ptr    Pointer returned by `alloc_shared_buffer`.
   */
  sync_transforms_to_buffer_sparse(ptr: number): void;
  /**
   * Return the number of entities with dirty transforms since last clear.
   */
  dirty_transform_count(): number;
  /**
   * Clear the dirty transform set.
   */
  clear_transform_dirty(): void;
  /**
   * Copy transform data from the shared buffer back into the ECS (after WASM plugins write).
   * @param ptr    Pointer returned by `alloc_shared_buffer`.
   * @param maxEntities  Number of entity slots to sync.
   */
  sync_transforms_from_buffer(ptr: number, maxEntities: number): void;

  // ── Stats ────────────────────────────────────────────────────────────────

  /** Return a JSON string with engine runtime metrics (entity count, frame, etc.). */
  stats(): string;
}

/** Exports additional for the physics2d variant (Rapier2D + NavMesh) */
export interface WasmEnginePhysics2D extends WasmEngineBase {
  // ── Physics ──────────────────────────────────────────────────────────────

  /** Initialize physics world with gravity and capacity. */
  physics_init(gx: number, gy: number, maxEntities: number): void;
  /** Advance physics simulation. */
  physics_step(delta: number): void;
  /** Set physics quality preset (0=low, 1=medium, 2=high, 3=esport). */
  physics_set_quality(preset: number): void;
  /** Enable/disable global CCD. */
  physics_set_global_ccd_enabled(enabled: number): void;
  /** Set event coalescing. */
  physics_set_event_coalescing(enabled: number): void;

  /** Add a rigid body. Returns a handle. */
  physics_add_rigid_body(
    slot: number,
    x: number,
    y: number,
    bodyType: number,
    mass: number,
    gravityScale: number,
    linearDamping: number,
    angularDamping: number,
    vx: number,
    vy: number,
    ccd?: number,
    solverIterations?: number,
  ): number;
  /** Add a box collider. */
  physics_add_box_collider(
    bodyHandle: number,
    hw: number,
    hh: number,
    restitution: number,
    friction: number,
    isSensor: number,
    density: number,
    membership: number,
    filter: number,
    colliderId?: number,
    offsetX?: number,
    offsetY?: number,
  ): void;
  /** Add a ball collider. */
  physics_add_ball_collider(
    bodyHandle: number,
    radius: number,
    restitution: number,
    friction: number,
    isSensor: number,
    density: number,
    membership: number,
    filter: number,
    colliderId?: number,
    offsetX?: number,
    offsetY?: number,
  ): void;

  /** Remove a rigid body. */
  physics_remove_rigid_body(slot: number): void;
  /** Set kinematic position. */
  physics_set_kinematic_position(slot: number, x: number, y: number, angle: number): number;
  physics_bulk_step_kinematics(
    slots: Uint32Array,
    vx: Float32Array,
    vy: Float32Array,
    dt: number,
  ): number;
  /** Apply impulse. */
  physics_apply_impulse(slot: number, x: number, y: number): void;
  /** Set linear velocity. */
  physics_set_linear_velocity(slot: number, vx: number, vy: number): void;
  /** Get linear velocity. Returns [vx, vy]. */
  physics_get_linear_velocity(slot: number): Float32Array;
  /** Get position and rotation. Returns [x, y, rotation]. */
  physics_get_position(slot: number): Float32Array;
  /** Get sensor state. Returns [contactCount, isActive]. */
  physics_get_sensor_state(slot: number, sensorId: number): Int32Array;
  /** Update sensor state manually. */
  physics_update_sensor_state(slot: number, sensorId: number, started: number): void;

  /** Load tilemap chunk. */
  physics_load_tilemap_chunk_body(
    chunkId: number,
    pseudoEntityIndex: number,
    x: number,
    y: number,
  ): number;
  /** Unload tilemap chunk. */
  physics_unload_tilemap_chunk_body(chunkId: number): void;

  /** Get pointer to the static collision event buffer. */
  physics_get_collision_events_ptr(): number;
  /** Get number of collision events in the buffer. */
  physics_get_collision_event_count(): number;
  /** Consume and return event metrics [frame, droppedCritical, droppedNonCritical, coalesced]. */
  physics_consume_event_metrics(): Int32Array;

  // ── Pathfinding ──────────────────────────────────────────────────────────

  /**
   * Find a path between two points in 2D space.
   *
   * @returns Number of nodes in the path result buffer (up to 256).
   * Use `path_get_result_ptr()` to read the resulting `[x, y]` pairs.
   */
  path_find_2d(fx: number, fy: number, tx: number, ty: number): number;
  /**
   * Get pointer to the static path result buffer.
   * Each node is 8 bytes: `[x: f32, y: f32]`.
   */
  path_get_result_ptr(): number;

  // ── NavMesh (optional — present only in navmesh-enabled WASM builds) ────

  /**
   * Build the navigation mesh from the current collider geometry.
   * Present in newer WASM builds as `physics_build_navmesh`.
   * @optional
   */
  physics_build_navmesh?(): void;
  /**
   * Build the navigation mesh (legacy name, superseded by `physics_build_navmesh`).
   * @optional
   * @deprecated Use `physics_build_navmesh` instead.
   */
  build_navmesh?(): void;
}

/**
 * Exports additional for the physics3d variant (ECS + Rapier3D).
 *
 * Body kind encoding used throughout this interface:
 * - `0` — Fixed (static, infinite mass)
 * - `1` — Dynamic (fully simulated by Rapier)
 * - `2` — KinematicPositionBased (position driven by explicit writes)
 * - `255` — sentinel value returned by `physics3d_get_body_kind` when no body is registered
 */
export interface WasmEnginePhysics3D extends WasmEngineBase {
  // ── World lifecycle ───────────────────────────────────────────────────────

  /**
   * Initialise the Rapier3D world with the given gravity vector.
   *
   * Must be called before any other `physics3d_*` method.
   *
   * @param gx - X component of gravity (m/s²).
   * @param gy - Y component of gravity (m/s²). Typical value: `-9.81`.
   * @param gz - Z component of gravity (m/s²).
   * @param maxEntities - Reserved capacity hint (unused in current implementation).
   */
  physics3d_init(gx: number, gy: number, gz: number, maxEntities: number): void;

  /**
   * Advance the Rapier3D simulation by `delta` seconds.
   *
   * Call once per frame, before reading back body states.
   *
   * @param delta - Elapsed time in seconds (e.g. `1/60` for 60 Hz).
   */
  physics3d_step(delta: number): void;

  // ── Body lifecycle ────────────────────────────────────────────────────────

  /**
   * Register a new 3D rigid body for an entity.
   *
   * @param entityIndex    - ECS entity slot index (stable key).
   * @param x              - Initial world-space X position.
   * @param y              - Initial world-space Y position.
   * @param z              - Initial world-space Z position.
   * @param kind           - Body kind: `0` = Fixed, `1` = Dynamic, `2` = Kinematic.
   * @param mass           - Body mass in kg (relevant for Dynamic bodies only).
   * @param linearDamping  - Linear velocity damping coefficient (≥ 0).
   * @param angularDamping - Angular velocity damping coefficient (≥ 0).
   * @returns `true` on success; `false` if `entityIndex` is already registered.
   */
  physics3d_add_body(
    entityIndex: number,
    x: number,
    y: number,
    z: number,
    kind: number,
    mass: number,
    linearDamping: number,
    angularDamping: number,
  ): boolean;

  /**
   * Remove the 3D rigid body registered for an entity.
   *
   * @param entityIndex - ECS entity slot index.
   * @returns `true` if a body was found and removed; `false` otherwise.
   */
  physics3d_remove_body(entityIndex: number): boolean;

  /**
   * Check whether a 3D body is currently registered for an entity.
   *
   * @param entityIndex - ECS entity slot index.
   */
  physics3d_has_body(entityIndex: number): boolean;

  // ── State read/write ──────────────────────────────────────────────────────

  /**
   * Return the full rigid body state as a 13-element `Float32Array`.
   *
   * Layout: `[px, py, pz, qx, qy, qz, qw, vx, vy, vz, ax, ay, az]`
   * - `px/py/pz`   — world-space position (metres)
   * - `qx/qy/qz/qw` — orientation as a unit quaternion
   * - `vx/vy/vz`   — linear velocity (m/s)
   * - `ax/ay/az`   — angular velocity (rad/s)
   *
   * Returns an empty array if the entity has no registered body.
   *
   * @param entityIndex - ECS entity slot index.
   */
  physics3d_get_body_state(entityIndex: number): Float32Array;

  /**
   * Overwrite all state fields of a 3D body in one call.
   *
   * More efficient than multiple separate setters when teleporting an entity.
   *
   * @param entityIndex - ECS entity slot index.
   * @param px  - New world-space X position.
   * @param py  - New world-space Y position.
   * @param pz  - New world-space Z position.
   * @param qx  - Quaternion X component.
   * @param qy  - Quaternion Y component.
   * @param qz  - Quaternion Z component.
   * @param qw  - Quaternion W component (scalar).
   * @param vx  - New linear velocity X.
   * @param vy  - New linear velocity Y.
   * @param vz  - New linear velocity Z.
   * @param ax  - New angular velocity X (rad/s).
   * @param ay  - New angular velocity Y (rad/s).
   * @param az  - New angular velocity Z (rad/s).
   * @returns `true` on success; `false` if the entity has no registered body.
   */
  physics3d_set_body_state(
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
  ): boolean;

  // ── Linear velocity ───────────────────────────────────────────────────────

  /**
   * Return the linear velocity of a 3D body as a 3-element `Float32Array`.
   *
   * Layout: `[vx, vy, vz]` in m/s.
   * Returns an empty array if the entity has no registered body.
   *
   * @param entityIndex - ECS entity slot index.
   */
  physics3d_get_linear_velocity(entityIndex: number): Float32Array;

  /**
   * Set the linear velocity of a 3D body.
   *
   * Wakes the body if it is sleeping.
   *
   * @param entityIndex - ECS entity slot index.
   * @param vx - New linear velocity X (m/s).
   * @param vy - New linear velocity Y (m/s).
   * @param vz - New linear velocity Z (m/s).
   * @returns `true` on success; `false` if the entity has no registered body.
   */
  physics3d_set_linear_velocity(entityIndex: number, vx: number, vy: number, vz: number): boolean;

  // ── Angular velocity ──────────────────────────────────────────────────────

  /**
   * Return the angular velocity of a 3D body as a 3-element `Float32Array`.
   *
   * Layout: `[ax, ay, az]` in rad/s.
   * Returns an empty array if the entity has no registered body.
   *
   * @param entityIndex - ECS entity slot index.
   */
  physics3d_get_angular_velocity(entityIndex: number): Float32Array;

  /**
   * Set the angular velocity of a 3D body.
   *
   * Wakes the body if it is sleeping.
   *
   * @param entityIndex - ECS entity slot index.
   * @param ax - New angular velocity X (rad/s).
   * @param ay - New angular velocity Y (rad/s).
   * @param az - New angular velocity Z (rad/s).
   * @returns `true` on success; `false` if the entity has no registered body.
   */
  physics3d_set_angular_velocity(entityIndex: number, ax: number, ay: number, az: number): boolean;

  // ── Impulse ───────────────────────────────────────────────────────────────

  /**
   * Apply a world-space linear impulse to a 3D body at its centre of mass.
   *
   * Immediately changes the linear velocity by `impulse / mass`. Wakes the
   * body if it is sleeping.
   *
   * @param entityIndex - ECS entity slot index.
   * @param ix - Impulse X component (N·s).
   * @param iy - Impulse Y component (N·s).
   * @param iz - Impulse Z component (N·s).
   * @returns `true` on success; `false` if the entity has no registered body.
   */
  physics3d_apply_impulse(entityIndex: number, ix: number, iy: number, iz: number): boolean;

  // ── Body kind ─────────────────────────────────────────────────────────────

  /**
   * Return the body kind discriminant for an entity's 3D body.
   *
   * @param entityIndex - ECS entity slot index.
   * @returns `0` = Fixed, `1` = Dynamic, `2` = KinematicPositionBased,
   *          `255` if no body is registered.
   */
  physics3d_get_body_kind(entityIndex: number): number;

  /**
   * Change the body kind of an existing 3D body at runtime.
   *
   * Useful for switching a body from static to dynamic (e.g. when a level
   * piece becomes interactive).
   *
   * @param entityIndex - ECS entity slot index.
   * @param kind        - `0` = Fixed, `1` = Dynamic, `2` = KinematicPositionBased.
   * @returns `true` on success; `false` if the entity has no registered body.
   */
  physics3d_set_body_kind(entityIndex: number, kind: number): boolean;

  // ── Kinematic positioning ──────────────────────────────────────────────────

  /**
   * Teleport a kinematic body to an exact world-space position and rotation.
   *
   * Only effective for `KinematicPositionBased` bodies.
   *
   * @param entityIndex - ECS entity slot index.
   * @param px - Target X position (metres).
   * @param py - Target Y position (metres).
   * @param pz - Target Z position (metres).
   * @param qx - Quaternion X component.
   * @param qy - Quaternion Y component.
   * @param qz - Quaternion Z component.
   * @param qw - Quaternion W (scalar) component.
   * @returns `true` on success; `false` if the entity has no registered body.
   */
  physics3d_set_kinematic_position?(
    entityIndex: number,
    px: number,
    py: number,
    pz: number,
    qx: number,
    qy: number,
    qz: number,
    qw: number,
  ): boolean;

  // ── Impulse ───────────────────────────────────────────────────────────────

  /**
   * Apply a world-space angular impulse to a 3D body.
   *
   * Immediately changes the angular velocity. Wakes the body if sleeping.
   *
   * @param entityIndex - ECS entity slot index.
   * @param ax - Angular impulse X component (N·m·s).
   * @param ay - Angular impulse Y component (N·m·s).
   * @param az - Angular impulse Z component (N·m·s).
   * @returns `true` on success; `false` if the entity has no registered body.
   */
  physics3d_apply_angular_impulse?(
    entityIndex: number,
    ax: number,
    ay: number,
    az: number,
  ): boolean;

  // ── Collider management ───────────────────────────────────────────────────

  /**
   * Attach a box-shaped collider to an existing 3D body.
   *
   * @param entityIndex - ECS entity slot index.
   * @param halfX       - Half-extent on the X axis (metres).
   * @param halfY       - Half-extent on the Y axis (metres).
   * @param halfZ       - Half-extent on the Z axis (metres).
   * @param friction    - Friction coefficient (≥ 0).
   * @param restitution - Bounciness in [0, 1].
   * @param density     - Collider density in kg/m³.
   * @param isSensor    - `1` = sensor (no response), `0` = solid.
   * @param membership  - Collision layer bitmask for this collider.
   * @param filter      - Bitmask of layers this collider collides with.
   * @param colliderId  - Stable numeric id propagated to collision events.
   * @param offsetX     - Local X offset from body centre (metres).
   * @param offsetY     - Local Y offset from body centre (metres).
   * @param offsetZ     - Local Z offset from body centre (metres).
   * @returns `true` on success.
   */
  physics3d_add_box_collider?(
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
  ): boolean;

  /**
   * Attach a sphere-shaped collider to an existing 3D body.
   *
   * @param entityIndex - ECS entity slot index.
   * @param radius      - Sphere radius (metres).
   * @param friction    - Friction coefficient (≥ 0).
   * @param restitution - Bounciness in [0, 1].
   * @param density     - Collider density in kg/m³.
   * @param isSensor    - `1` = sensor, `0` = solid.
   * @param membership  - Collision layer bitmask.
   * @param filter      - Bitmask of layers this collider collides with.
   * @param colliderId  - Stable numeric id.
   * @param offsetX     - Local X offset (metres).
   * @param offsetY     - Local Y offset (metres).
   * @param offsetZ     - Local Z offset (metres).
   * @returns `true` on success.
   */
  physics3d_add_sphere_collider?(
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
  ): boolean;

  /**
   * Attach a capsule-shaped collider to an existing 3D body.
   *
   * The capsule axis is aligned with the local Y axis of the body.
   *
   * @param entityIndex - ECS entity slot index.
   * @param radius      - Capsule radius (metres).
   * @param halfHeight  - Half-height of the cylindrical part (metres).
   * @param friction    - Friction coefficient (≥ 0).
   * @param restitution - Bounciness in [0, 1].
   * @param density     - Collider density in kg/m³.
   * @param isSensor    - `1` = sensor, `0` = solid.
   * @param membership  - Collision layer bitmask.
   * @param filter      - Bitmask of layers this collider collides with.
   * @param colliderId  - Stable numeric id.
   * @param offsetX     - Local X offset (metres).
   * @param offsetY     - Local Y offset (metres).
   * @param offsetZ     - Local Z offset (metres).
   * @returns `true` on success.
   */
  physics3d_add_capsule_collider?(
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
  ): boolean;

  /**
   * Remove a collider by its stable `colliderId` from a 3D body.
   *
   * @param entityIndex - ECS entity slot index.
   * @param colliderId  - The stable collider id assigned when the collider was added.
   * @returns `true` if the collider was found and removed; `false` otherwise.
   */
  physics3d_remove_collider?(entityIndex: number, colliderId: number): boolean;

  /**
   * Attach a triangle-mesh collider to a 3D body.
   * Parameter order matches the Rust WASM export exactly.
   */
  physics3d_add_mesh_collider?(
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
  ): boolean;

  /**
   * Rebuild an existing triangle-mesh collider with new geometry.
   * Removes the old trimesh and inserts a fresh one atomically inside Rapier3D.
   * Parameter order matches the Rust WASM export exactly.
   */
  physics3d_rebuild_mesh_collider?(
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
  ): boolean;

  // ── Sensor state ──────────────────────────────────────────────────────────

  /**
   * Read the contact state of a sensor collider.
   *
   * Returns a packed value: `[contactCount: u32, isActive: u32]` as a
   * `BigInt64Array` or plain `number[]`.
   *
   * @param entityIndex - ECS entity slot index.
   * @param sensorId    - Stable sensor id (same as the collider's `colliderId`).
   */
  physics3d_get_sensor_state?(entityIndex: number, sensorId: number): BigInt64Array | number[];

  /**
   * Manually update the sensor state for a (entity, sensor) pair.
   *
   * Intended for TS-side sensor tracking and test helpers.
   *
   * @param entityIndex - ECS entity slot index.
   * @param sensorId    - Stable sensor id.
   * @param isActive    - `1` = active, `0` = inactive.
   * @param count       - Number of overlapping contacts.
   */
  physics3d_update_sensor_state?(
    entityIndex: number,
    sensorId: number,
    isActive: number,
    count: number,
  ): void;

  // ── Quality & coalescing ──────────────────────────────────────────────────

  /**
   * Set the physics solver quality preset.
   *
   * @param preset - `0` = low, `1` = medium, `2` = high, `3` = esport.
   */
  physics3d_set_quality?(preset: number): void;

  /**
   * Enable or disable same-frame collision event coalescing.
   *
   * When enabled, duplicate events for the same contact pair within a single
   * frame are deduplicated on the Rust side before being written to the buffer.
   *
   * @param enabled - `1` = enabled, `0` = disabled.
   */
  physics3d_set_event_coalescing?(enabled: number): void;

  // ── Collision event ring buffer ───────────────────────────────────────────

  /**
   * Return the pointer to the start of the collision event ring buffer in WASM linear memory.
   *
   * The buffer layout is: `[slotA: u32][slotB: u32][colliderIdA: u32][colliderIdB: u32][flags: u8]`
   * per event slot (17 bytes per event).
   *
   * @returns Raw byte offset into `WebAssembly.Memory`.
   */
  physics3d_get_collision_events_ptr?(): number;

  /**
   * Return the number of unread collision events currently in the ring buffer.
   */
  physics3d_get_collision_event_count?(): number;

  /**
   * Mark all buffered collision events as consumed (advances the read head).
   *
   * Must be called once after reading all events for the current frame to
   * prevent stale events from being re-processed on the next frame.
   */
  physics3d_consume_events?(): void;
}

/**
 * Runtime engine contract:
 * - Base exports are always present.
 * - Physics-specific exports are present only in matching variants.
 */
export type WasmEngine = WasmEngineBase &
  Partial<Omit<WasmEnginePhysics2D, keyof WasmEngineBase>> &
  Partial<Omit<WasmEnginePhysics3D, keyof WasmEngineBase>>;

// #endregion

// #region Internal state & hot-path static buffers ───────────────────────────

let _wasmEngine: WasmEngine | null = null;
let _wasmModule: GwenCoreWasm | null = null;
let _wasmExports: { memory?: WebAssembly.Memory } | null = null; // raw WASM instance exports
let _initPromise: Promise<void> | null = null;
let _maxEntities = 10_000;
let _activeVariant: CoreVariant = 'light';

/** Track the last seen ArrayBuffer to detect memory.grow() events. */
let _lastMemoryBuffer: ArrayBuffer | null = null;

/** Static view for zero-alloc query results. Recreated on memory.grow(). */
let _queryResultView: Uint32Array | null = null;

/** Static buffer for type IDs to avoid allocations on every query. */
const _typeIdBuffer = new Uint32Array(16);
/** Pre-allocated views for common type ID counts (0-16). */
const _typeIdViews = Array.from({ length: 17 }, (_, i) => _typeIdBuffer.subarray(0, i));

/**
 * Base URL for WASM artifacts (auto-resolved in browser, null in Node).
 *
 * Resolution strategy (in order):
 *  1. In browser: /wasm/ relative to current origin.
 *     @gwenjs/vite serves this via middleware (dev)
 *     and CLI copies it to dist/wasm/ (build).
 *  2. In Node (SSR/tests): null — initWasm() must receive explicit URL.
 *
 * We avoid new URL('../wasm/', import.meta.url) because in Vite dev mode
 * it produces an @fs/.../.../engine-core/wasm path without trailing slash,
 * resulting in an invalid URL.
 */
const _pkgWasmBase: string | null = (() => {
  // `location` is available in both browser main thread and Web Workers (self.location).
  // We no longer check `typeof window` so this also works in worker contexts.
  if (typeof location !== 'undefined') {
    // Browser / Worker — artifacts always served from /wasm/ by Vite plugin
    return `${location.origin}/wasm/`;
  }
  return null;
})();

// #endregion

// #region Module loading & initialization ─────────────────────────────────────

/**
 * Options for WASM initialization.
 */
export interface InitWasmOptions {
  /** Max number of entities the engine can track (default: 10,000). */
  maxEntities?: number;
  /** Optional URL to the wasm-bindgen glue (gwen_core.js). */
  jsUrl?: string;
  /** Optional URL to the WASM binary (gwen_core_bg.wasm). */
  wasmUrl?: string;
  /**
   * Whether SharedArrayBuffer is strictly required (default: false).
   * If true and SAB is unavailable, `initWasm` will throw.
   */
  requireSAB?: boolean;
}

/**
 * Load and initialize the gwen_core WASM module. **REQUIRED** before any Engine usage.
 *
 * **Without arguments**: Auto-resolves from `@gwenjs/core/wasm/light/`
 * (pre-compiled artifacts published in the package — no Rust build needed).
 *
 * @param variant The core variant to load ('light', 'physics2d', 'physics3d')
 * @param options Initialization options (urls, max entities, SAB requirement)
 * @throws {Error} If WASM cannot be loaded or has invalid format
 */
export async function initWasm(
  variant: CoreVariant = 'light',
  options: InitWasmOptions = {},
): Promise<void> {
  if (_wasmEngine) return;
  if (_initPromise) return _initPromise;

  const { maxEntities = 10_000, requireSAB = false, jsUrl, wasmUrl } = options;

  // ── P0: Validate SharedArrayBuffer availability ────────────────────────────
  if (requireSAB && typeof SharedArrayBuffer === 'undefined') {
    throw new Error(
      '[GWEN] SharedArrayBuffer is required by a WASM plugin but not available.\n' +
        'Your server MUST send COOP/COEP headers to enable SharedArrayBuffer.\n' +
        'See: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer',
    );
  }

  _maxEntities = maxEntities;
  _activeVariant = variant;

  const variantPath = `${variant}/`;
  const resolvedJsUrl =
    jsUrl ?? (_pkgWasmBase ? `${_pkgWasmBase}${variantPath}gwen_core.js` : null);
  const resolvedWasmUrl =
    wasmUrl ?? (_pkgWasmBase ? `${_pkgWasmBase}${variantPath}gwen_core_bg.wasm` : null);

  if (!resolvedJsUrl) {
    throw new Error(
      `[GWEN] initWasm(): unable to resolve WASM glue URL for variant "${variant}".\n` +
        'Make sure @gwenjs/core is correctly installed.',
    );
  }

  _initPromise = (async () => {
    const glue = await loadWasmGlue(resolvedJsUrl);

    const _fetchController = new AbortController();
    const _fetchTimeoutId = setTimeout(() => _fetchController.abort(), 10_000);

    let wasmInput: Response | undefined;
    try {
      if (resolvedWasmUrl) {
        wasmInput = await fetch(resolvedWasmUrl, { signal: _fetchController.signal });
        if (!wasmInput.ok) {
          throw new Error(
            `[GWEN] WASM fetch failed with HTTP ${wasmInput.status} ${wasmInput.statusText}`,
          );
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(
          `[CORE:WASM_TIMEOUT] initWasm() timed out after 10s waiting for WASM binary.`,
        );
      }
      throw err;
    } finally {
      clearTimeout(_fetchTimeoutId);
    }

    if (typeof glue.default === 'function') {
      // glue.default() returns the raw WASM instance exports (including memory)
      _wasmExports = await glue.default({ module_or_path: wasmInput });
    } else if (typeof glue.initSync === 'function') {
      const buf = await (await fetch(resolvedWasmUrl!)).arrayBuffer();
      _wasmExports = glue.initSync({ module: buf });
    } else {
      throw new Error('[GWEN] WASM glue has no init() function — corrupted file?');
    }

    if (typeof glue.Engine !== 'function') {
      throw new Error('[GWEN] WASM glue loaded but Engine class not found.');
    }

    _wasmModule = glue as GwenCoreWasm;
    _wasmEngine = new glue.Engine(maxEntities);

    if (variant === 'physics2d') {
      if (import.meta.env?.DEV) {
        console.log('[GWEN] WASM core loaded — Physics2D variant active');
      }
    } else if (variant === 'physics3d') {
      if (import.meta.env?.DEV) {
        console.log('[GWEN] WASM core loaded — Physics3D variant active');
      }
    } else {
      if (import.meta.env?.DEV) {
        console.log('[GWEN] WASM core loaded — Light variant active');
      }
    }
  })().catch((err) => {
    _initPromise = null;
    _wasmEngine = null;
    _wasmModule = null;
    _wasmExports = null;
    const tagged = err instanceof Error ? err : new Error(String(err));
    (tagged as Error & { code?: string }).code = 'CORE:WASM_LOAD_ERROR';
    throw tagged;
  });

  return _initPromise;
}

// ── Internal types for DOM-based glue loading ─────────────────────────────────

/**
 * Extended `Window` interface that allows dynamic property access.
 * Used to cache loaded WASM glue modules on the global object.
 */
interface GwenWindow extends Window {
  [key: string]: unknown;
}

declare const window: GwenWindow;

/**
 * Shape of a wasm-bindgen generated ES glue module.
 * The exact exports depend on the wasm-bindgen version and init mode.
 */
interface WasmGlueModule {
  /** Async init — returns raw WASM instance exports including the linear memory. */
  default?: (init: {
    module_or_path?: Response | undefined;
  }) => Promise<{ memory?: WebAssembly.Memory }>;
  /** Sync init — returns raw WASM instance exports including the linear memory. */
  initSync?: (init: { module: ArrayBuffer }) => { memory?: WebAssembly.Memory };
  Engine?: new (maxEntities: number) => WasmEngine;
  [key: string]: unknown;
}

/**
 * Load a WASM ES glue module, with two code paths:
 *
 * - **Main thread** (DOM available): injects a `<script type="module">` into the document
 *   to work around Vite's restriction on dynamic `import()` for `/public` assets.
 * - **Web Worker** (no DOM): falls back to a dynamic `import()` which is natively
 *   supported in module workers (`new Worker(url, { type: 'module' })`).
 *
 * The loaded module is cached on `globalThis` under a deterministic key so repeated
 * calls for the same URL are free (no extra network round-trips).
 *
 * @param jsUrl Absolute or root-relative URL to the wasm-bindgen JS glue file.
 */
async function loadWasmGlue(jsUrl: string): Promise<WasmGlueModule> {
  const key = `__gwenGlue_${jsUrl.replace(/\W/g, '_')}`;
  const ctx = globalThis as Record<string, unknown>;

  // Cache hit — same URL already loaded in this context.
  if (ctx[key]) return ctx[key] as WasmGlueModule;

  // Resolve to an absolute URL. `globalThis.location` is available in both
  // the main thread (window.location) and module workers (self.location).
  const base = (globalThis as { location?: { href: string } }).location?.href ?? jsUrl;
  const absoluteUrl = new URL(jsUrl, base).href;

  // ── Worker path: no DOM, use dynamic import() ─────────────────────────────
  if (typeof document === 'undefined') {
    const glue = (await import(/* @vite-ignore */ absoluteUrl)) as WasmGlueModule;
    ctx[key] = glue;
    return glue;
  }

  // ── Main thread path: script injection (preserves Vite /public compat) ────
  return new Promise<WasmGlueModule>((resolve, reject) => {
    const blob = new Blob(
      [
        `import * as glue from '${absoluteUrl}';`,
        `globalThis['${key}'] = glue;`,
        `globalThis['${key}__resolve']?.();`,
      ],
      { type: 'text/javascript' },
    );

    const blobUrl = URL.createObjectURL(blob);

    ctx[`${key}__resolve`] = () => {
      URL.revokeObjectURL(blobUrl);
      script.remove();
      resolve(ctx[key] as WasmGlueModule);
    };

    const script = document.createElement('script');
    script.type = 'module';
    script.src = blobUrl;
    script.onerror = (e) => {
      URL.revokeObjectURL(blobUrl);
      script.remove();
      reject(new Error(`[GWEN] Unable to load WASM glue: ${jsUrl}\n${e}`));
    };

    document.head.appendChild(script);
  });
}

// #endregion

// #region WasmBridge public interface ─────────────────────────────────────────

export interface WasmBridge {
  /** True if Rust/WASM core is initialized and ready. */
  isActive(): boolean;

  /** Active WASM variant. */
  readonly variant: CoreVariant;

  /** Whether physics exports are available (variant is 'physics2d' or 'physics3d'). */
  hasPhysics(): boolean;

  /**
   * Get physics-specific bridge.
   * @throws {Error} If the active variant is 'light'.
   */
  getPhysicsBridge(): WasmEnginePhysics2D | WasmEnginePhysics3D;

  /** Direct access to the Rust WasmEngine instance. Throws if not initialized. */
  engine(): WasmEngine;

  // ── Entity ──────────────────────────────────────────────────────────────

  /** Create a new entity and return its packed handle (index + generation). */
  createEntity(): WasmEntityId;
  /**
   * Destroy an entity.
   * @returns `false` if the (index, generation) pair is stale.
   */
  deleteEntity(index: number, generation: number): boolean;
  /**
   * Check whether an entity slot is still alive.
   * @returns `false` if the generation does not match.
   */
  isAlive(index: number, generation: number): boolean;
  /** Return the number of currently alive entities. */
  countEntities(): number;

  // ── Component ────────────────────────────────────────────────────────────

  /**
   * Register a new component type in the Rust ECS.
   * @returns A unique `typeId` (u32) used in all subsequent component calls.
   */
  registerComponentType(): number;
  /**
   * Attach or overwrite a component on an entity.
   * @param index      Raw entity slot index.
   * @param generation Entity generation counter (stale-reference guard).
   * @param typeId     Component type ID returned by `registerComponentType`.
   * @param data       Raw bytes — layout must match what the Rust side expects for `typeId`.
   * @returns `false` if the entity is dead.
   */
  addComponent(index: number, generation: number, typeId: number, data: Uint8Array): boolean;
  /**
   * Remove a component from an entity.
   * @returns `false` if the entity is dead or did not have the component.
   */
  removeComponent(index: number, generation: number, typeId: number): boolean;
  /**
   * Check whether an entity has a specific component type.
   * @returns `false` if the entity is dead or the component is absent.
   */
  hasComponent(index: number, generation: number, typeId: number): boolean;
  /**
   * Read raw component bytes from the Rust ECS.
   * @returns Empty `Uint8Array` if the entity is dead or component is absent.
   */
  getComponentRaw(index: number, generation: number, typeId: number): Uint8Array;

  /**
   * Reads component data for multiple entities in a single WASM call.
   *
   * Reduces N JS↔WASM boundary crossings to **1** for N entities.
   * The returned `Float32Array` is a view over a freshly allocated JS buffer
   * containing tightly packed component data:
   * `[entity_0_f32s … | entity_1_f32s … | … ]`
   *
   * Dead entities or entities missing the component contribute all-zero
   * bytes in their respective slot (provided the caller pre-zeros `outBuf`,
   * which this method does automatically via `new Uint8Array`).
   *
   * @param entities       Packed `EntityId` handles (index + generation).
   * @param componentTypeId Component type ID from `registerComponentType()`.
   * @param componentSize  Byte size of one component instance.
   * @returns `Float32Array` of length `entities.length * (componentSize / 4)`.
   *
   * @example
   * ```typescript
   * const posTypeId = bridge.registerComponentType();
   * // … populate entities …
   * const slots = bridge.queryEntities([posTypeId]);
   * // 1 crossing instead of slots.length crossings:
   * const packed = bridge.readComponentsBulk(slots, posTypeId, 8);
   * for (let i = 0; i < slots.length; i++) {
   *   const x = packed[i * 2 + 0];
   *   const y = packed[i * 2 + 1];
   * }
   * ```
   *
   * @since 1.0.0
   */
  readComponentsBulk(
    entities: EntityId[],
    componentTypeId: number,
    componentSize: number,
  ): Float32Array;

  /**
   * Writes component data for multiple entities in a single WASM call.
   *
   * Reduces N JS↔WASM boundary crossings to **1** for N entities.
   * The `data` buffer must be tightly packed in the same order as `entities`:
   * `[entity_0_f32s … | entity_1_f32s … | … ]`
   *
   * Dead entities are silently skipped on the Rust side.
   *
   * @param entities        Packed `EntityId` handles (index + generation).
   * @param componentTypeId Component type ID from `registerComponentType()`.
   * @param data            Packed component data; total byte length must equal
   *                        `entities.length * componentSize`.
   *
   * @example
   * ```typescript
   * const updated = new Float32Array(entities.length * 2); // 2 f32 per entity
   * for (let i = 0; i < entities.length; i++) {
   *   updated[i * 2 + 0] = newX[i];
   *   updated[i * 2 + 1] = newY[i];
   * }
   * // 1 crossing instead of entities.length crossings:
   * bridge.writeComponentsBulk(entities, posTypeId, updated);
   * ```
   *
   * @since 1.0.0
   */
  writeComponentsBulk(entities: EntityId[], componentTypeId: number, data: Float32Array): void;

  /**
   * Query entities with ALL given component types and bulk-read one component
   * type in a **single WASM call** (no per-entity crossings).
   *
   * @param componentTypeIds - Component type IDs every matching entity must have
   * @param readTypeId       - Which component type to read into the returned buffer
   * @param f32Stride        - Float32 values per entity (`component._f32Stride`)
   * @returns `{ entityCount, data, slots, gens }` where `data` is a zero-copy
   *   `Float32Array` view, and `slots`/`gens` are `Uint32Array` views for
   *   passing back to `queryWriteBulk`.
   *
   * @performance
   * Crosses the WASM boundary **once** regardless of entity count.
   * ~350× faster than N individual `getComponentRaw` calls for 1 000 entities.
   *
   * @example
   * ```typescript
   * const bridge = getWasmBridge();
   * const posTypeId = bridge.registerComponentType();
   * // ... populate entities with position component ...
   * const result = bridge.queryReadBulk([posTypeId], posTypeId, 2);
   * for (let i = 0; i < result.entityCount; i++) {
   *   const x = result.data[i * 2 + 0];
   *   const y = result.data[i * 2 + 1];
   * }
   * ```
   *
   * @since 1.0.0
   */
  queryReadBulk(
    componentTypeIds: number[],
    readTypeId: number,
    f32Stride: number,
  ): { entityCount: number; data: Float32Array; slots: Uint32Array; gens: Uint32Array };

  /**
   * Write back component data for a previously-queried entity set in one WASM call.
   *
   * Pass the `slots` and `gens` from a prior `queryReadBulk` result.
   *
   * @param slots       - Entity slot indices (from `queryReadBulk` result)
   * @param gens        - Entity generation counters (from `queryReadBulk` result)
   * @param writeTypeId - Component type ID to write
   * @param data        - Updated packed Float32 data (`entityCount × f32Stride` elements)
   *
   * @performance One WASM boundary crossing for any number of entities.
   *
   * @example
   * ```typescript
   * const bridge = getWasmBridge();
   * const { data, slots, gens } = bridge.queryReadBulk([posTypeId], posTypeId, 2);
   * // ... modify data ...
   * bridge.queryWriteBulk(slots, gens, posTypeId, data);
   * ```
   *
   * @since 1.0.0
   */
  queryWriteBulk(
    slots: Uint32Array,
    gens: Uint32Array,
    writeTypeId: number,
    data: Float32Array,
  ): void;

  // ── Query ────────────────────────────────────────────────────────────────

  /**
   * Update the archetype bitmask for an entity.
   * Must be called after every `addComponent` / `removeComponent` so that
   * `queryEntities` returns up-to-date results.
   */
  updateEntityArchetype(index: number, typeIds: number[]): void;
  /**
   * Remove an entity from all query indexes.
   * Must be called just before `deleteEntity`.
   */
  removeEntityFromQuery(index: number): void;
  /**
   * Return the packed `EntityId`s of all entities that have ALL of the given
   * component type IDs.
   *
   * Internally converts raw Rust slot indices to packed TypeScript EntityIds
   * using `getEntityGeneration`.
   */
  queryEntities(typeIds: number[]): EntityId[];
  /**
   * Zero-alloc query — writes results to a static WASM buffer.
   * @param typeIds - Component type IDs to match
   * @returns The number of matching entities (capped at 10,000)
   */
  queryEntitiesRaw(typeIds: number[]): number;
  /**
   * Iterate query results without creating any objects.
   * @param typeIds - Component type IDs to match
   * @param callback - Function called for each raw entity index
   */
  forEachQueryResultRaw(typeIds: number[], callback: (entityIndex: number) => void): void;
  /**
   * Return the current generation counter for a raw slot index.
   * Used to reconstruct a packed `EntityId` from a WASM-side slot index
   * (e.g. `slotA` / `slotB` from physics collision events).
   */
  getEntityGeneration(index: number): number;

  // ── Game loop ────────────────────────────────────────────────────────────

  /**
   * Advance the Rust simulation by one frame.
   * @param deltaMs Frame delta time in **milliseconds** (Rust side convention).
   */
  tick(deltaMs: number): void;

  // ── Shared memory (WASM plugin bridge) ───────────────────────────────────

  /**
   * Allocate `byteLength` bytes in gwen-core's WASM linear memory.
   * Returns a raw pointer (usize) passed to WASM plugins via `onInit(region)`.
   * Called once by `SharedMemoryManager.create()`.
   */
  allocSharedBuffer(byteLength: number): number;

  /**
   * Copy ECS Transform data → shared buffer so WASM plugins can read it.
   * Called each frame **before** `dispatchWasmStep`.
   */
  syncTransformsToBuffer(ptr: number, maxEntities: number): void;

  /**
   * Copy ONLY dirty ECS Transform data → shared buffer.
   * Uses the Rust-side dirty set to avoid iterating over all entities.
   */
  syncTransformsToBufferSparse(ptr: number): void;

  /**
   * Return the number of entities that have changed since the last sync.
   */
  dirtyTransformCount(): number;

  /**
   * Clear the dirty transform flag for all entities.
   */
  clearTransformDirty(): void;

  /**
   * Copy shared buffer → ECS Transform data after WASM plugins have written it.
   * Called each frame **after** `dispatchWasmStep` and after sentinel checks.
   */
  syncTransformsFromBuffer(ptr: number, maxEntities: number): void;

  /**
   * Return the `WebAssembly.Memory` object exported by `gwen_core.wasm`.
   *
   * ## Why this matters — buffer-detach on `memory.grow()`
   * When Rust allocates enough memory to exhaust the current WASM linear
   * memory, the runtime calls `memory.grow(n_pages)`. This **replaces the
   * underlying `ArrayBuffer`**. Any `TypedArray` or `DataView` built on the
   * old buffer becomes "detached" — all reads return `0`, all writes are
   * silently discarded.
   *
   * The risk in GWEN:
   *   - Rust-side: safe, Rust never holds a raw `ArrayBuffer` reference.
   *   - TypeScript-side: `SharedMemoryManager.checkSentinels()` and any
   *     debug-draw tool that builds a `Float32Array` view over `memory.buffer`
   *     **must** re-wrap `memory.buffer` on every frame, not cache it.
   *
   * This method returns the **live** `WebAssembly.Memory` object (not the
   * buffer). Callers must access `.buffer` fresh on each use:
   * ```typescript
   * const view = new Float32Array(bridge.getLinearMemory()!.buffer, ptr, 8);
   * //                                                      ^^^^^^^^^
   * //                                 always re-wrap — buffer may have changed
   * ```
   *
   * Returns `null` in Node.js test environments where the real WASM module
   * is replaced by a mock that does not export memory.
   */
  getLinearMemory(): WebAssembly.Memory | null;

  /**
   * Detect whether `memory.grow()` has been called since the last check.
   *
   * **Usage** : Call this manually in your plugin's `onStep()` if you cache
   * TypedArray views over `getLinearMemory().buffer`. Most plugins using
   * `PluginDataBus` do NOT need this — their buffers are immune to WASM grows.
   *
   * **Idempotent** : Returns `false` if called twice without a grow in between.
   *
   * **O(1) cost** : Simple pointer comparison.
   *
   * @returns `true` if memory has grown since last check, `false` otherwise.
   *
   * @example
   * ```typescript
   * onStep(deltaTime: number) {
   *   if (this.bridge.checkMemoryGrow()) {
   *     this._refreshCachedViews();
   *   }
   *   // ... simulation
   * }
   * ```
   *
   * @remarks
   * See the guide at `docs/WASM_MEMORY_GROW.md` for complete information
   * on handling buffer-detach issues.
   */
  checkMemoryGrow(): boolean;

  // ── Stats ────────────────────────────────────────────────────────────────

  /** Return a JSON string with engine runtime metrics (entity count, frame, etc.). */
  stats(): string;
}

// #endregion

// #region WasmBridge implementation (hot path — do not split) ─────────────────

/**
 * Guard that returns the active WasmEngine or throws a descriptive error.
 * All bridge methods call this so the error message is consistent and actionable.
 *
 * @throws {Error} If `initWasm()` has not been called yet.
 * @internal
 */
function requireWasm(): WasmEngine {
  if (!_wasmEngine) {
    throw new Error(
      '[GWEN] WASM core not initialized.\n' + 'Call `await initWasm()` before starting the Engine.',
    );
  }
  return _wasmEngine;
}

/**
 * Concrete implementation of `WasmBridge`.
 *
 * Every public method delegates to the `_wasmEngine` singleton via
 * `requireWasm()`, which throws a clear error if WASM is not yet loaded.
 * All type conversions (e.g. `number[] → Uint32Array`, packed EntityId
 * reconstruction) happen here so callers never touch raw Rust types.
 *
 * @internal — Obtain the singleton via `getWasmBridge()`.
 */
class WasmBridgeImpl implements WasmBridge {
  // ── Private static buffers (zero-alloc query bulk optimization) ──────────

  /** Reusable static buffer for query results (entity slots). */
  private _bulkSlots?: Uint32Array;
  /** Reusable static buffer for query results (entity generations). */
  private _bulkGens?: Uint32Array;
  /** Reusable static buffer for bulk component data. */
  private _bulkBuf?: Uint8Array;

  // ── Status ───────────────────────────────────────────────────────────────

  isActive(): boolean {
    return _wasmEngine !== null;
  }

  get variant(): CoreVariant {
    return _activeVariant;
  }

  hasPhysics(): boolean {
    return _activeVariant === 'physics2d' || _activeVariant === 'physics3d';
  }

  getPhysicsBridge(): WasmEnginePhysics2D | WasmEnginePhysics3D {
    if (!this.hasPhysics()) {
      throw new Error(
        `[GWEN] getPhysicsBridge(): physics is not available in variant "${_activeVariant}". ` +
          'Use "physics2d" or "physics3d" variant instead.',
      );
    }
    return requireWasm() as WasmEnginePhysics2D | WasmEnginePhysics3D;
  }

  engine(): WasmEngine {
    return requireWasm();
  }

  // ── Entity ───────────────────────────────────────────────────────────────

  createEntity(): WasmEntityId {
    return requireWasm().create_entity();
  }

  deleteEntity(index: number, generation: number): boolean {
    return requireWasm().delete_entity(index, generation);
  }

  isAlive(index: number, generation: number): boolean {
    return requireWasm().is_alive(index, generation);
  }

  countEntities(): number {
    return requireWasm().count_entities();
  }

  // ── Component ────────────────────────────────────────────────────────────

  registerComponentType(): number {
    return requireWasm().register_component_type();
  }

  addComponent(index: number, generation: number, typeId: number, data: Uint8Array): boolean {
    return requireWasm().add_component(index, generation, typeId, data);
  }

  removeComponent(index: number, generation: number, typeId: number): boolean {
    return requireWasm().remove_component(index, generation, typeId);
  }

  hasComponent(index: number, generation: number, typeId: number): boolean {
    return requireWasm().has_component(index, generation, typeId);
  }

  getComponentRaw(index: number, generation: number, typeId: number): Uint8Array {
    return requireWasm().get_component_raw(index, generation, typeId);
  }

  readComponentsBulk(
    entities: EntityId[],
    componentTypeId: number,
    componentSize: number,
  ): Float32Array {
    const n = entities.length;
    if (n === 0) return new Float32Array(0);

    // Build flat Uint32Array pairs for slots/gens (two separate arrays for Rust).
    const slots = new Uint32Array(n);
    const gens = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      const { index, generation } = unpackEntityId(entities[i]!);
      slots[i] = index;
      gens[i] = generation;
    }

    // Pre-allocate the output buffer (pre-zeroed by the JS runtime).
    const outBuf = new Uint8Array(n * componentSize);
    requireWasm().get_components_bulk(slots, gens, componentTypeId, outBuf);

    // Return a Float32Array view over the same buffer — no copy.
    return new Float32Array(outBuf.buffer, outBuf.byteOffset, outBuf.byteLength / 4);
  }

  writeComponentsBulk(entities: EntityId[], componentTypeId: number, data: Float32Array): void {
    const n = entities.length;
    if (n === 0) return;

    const slots = new Uint32Array(n);
    const gens = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      const { index, generation } = unpackEntityId(entities[i]!);
      slots[i] = index;
      gens[i] = generation;
    }

    // Pass data as a Uint8Array view over the Float32Array buffer — no copy.
    const dataBytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    requireWasm().set_components_bulk(slots, gens, componentTypeId, dataBytes);
  }

  /**
   * Query entities with ALL given component types and bulk-read one component
   * type in a **single WASM call** (no per-entity crossings).
   *
   * Internally allocates static buffers (reused across frames) to minimize GC pressure.
   * Memory is lazily allocated and grown only if needed.
   *
   * Dead entities or stale generation pairs are skipped by the Rust side.
   *
   * @param componentTypeIds - Component type IDs every matching entity must have
   * @param readTypeId       - Which component type to read into the returned buffer
   * @param f32Stride        - Float32 values per entity
   * @returns `{ entityCount, data, slots, gens }` where `data` is a zero-copy
   *   `Float32Array` view, and `slots`/`gens` are `Uint32Array` views for
   *   passing back to `queryWriteBulk`.
   *
   * @performance Crosses the WASM boundary **once** regardless of entity count.
   * ~350× faster than N individual `getComponentRaw` calls for 1 000 entities.
   *
   * @throws If `initWasm()` has not been called.
   *
   * @since 1.0.0
   */
  queryReadBulk(
    componentTypeIds: number[],
    readTypeId: number,
    f32Stride: number,
  ): { entityCount: number; data: Float32Array; slots: Uint32Array; gens: Uint32Array } {
    const maxEntities = 10_000;
    const byteStride = f32Stride * 4;

    // Lazily allocate static views — reused every frame to avoid GC pressure.
    if (!this._bulkSlots) {
      this._bulkSlots = new Uint32Array(maxEntities);
      this._bulkGens = new Uint32Array(maxEntities);
      this._bulkBuf = new Uint8Array(maxEntities * byteStride);
    } else if ((this._bulkBuf?.length ?? 0) < maxEntities * byteStride) {
      // Re-allocate if stride increased (different component on same bridge).
      this._bulkBuf = new Uint8Array(maxEntities * byteStride);
    }

    const result = requireWasm().query_read_bulk(
      new Uint32Array(componentTypeIds),
      readTypeId,
      this._bulkSlots,
      this._bulkGens!,
      this._bulkBuf!,
    );

    // result is a Uint32Array [entityCount, bytesWritten]
    const entityCount = result[0] ?? 0;

    return {
      entityCount,
      data: new Float32Array(this._bulkBuf!.buffer, 0, entityCount * f32Stride),
      slots: this._bulkSlots.subarray(0, entityCount),
      gens: this._bulkGens!.subarray(0, entityCount),
    };
  }

  /**
   * Write back component data for a previously-queried entity set in one WASM call.
   *
   * Pass the `slots` and `gens` from a prior `queryReadBulk` result.
   * Dead entities (stale generation) are silently skipped on the Rust side.
   *
   * @param slots       - Entity slot indices (from `queryReadBulk` result)
   * @param gens        - Entity generation counters (from `queryReadBulk` result)
   * @param writeTypeId - Component type ID to write
   * @param data        - Updated packed Float32 data (`entityCount × f32Stride` elements)
   *
   * @performance One WASM boundary crossing for any number of entities.
   *
   * @throws If `initWasm()` has not been called.
   *
   * @since 1.0.0
   */
  queryWriteBulk(
    slots: Uint32Array,
    gens: Uint32Array,
    writeTypeId: number,
    data: Float32Array,
  ): void {
    const dataBytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    requireWasm().query_write_bulk(slots, gens, writeTypeId, dataBytes);
  }

  // ── Query ────────────────────────────────────────────────────────────────

  updateEntityArchetype(index: number, typeIds: number[]): void {
    requireWasm().update_entity_archetype(index, new Uint32Array(typeIds));
  }

  removeEntityFromQuery(index: number): void {
    requireWasm().remove_entity_from_query(index);
  }

  /**
   * Query entities matching the given component type IDs.
   *
   * Returns EntityIds (branded bigint) using 64-bit packing:
   * - 32-bit generation counter (supports unlimited recyclings)
   * - 32-bit index (supports up to 4 billion entities)
   *
   * @param typeIds - Component type IDs to match
   * @returns Array of EntityIds for matching entities
   */
  queryEntities(typeIds: number[]): EntityId[] {
    const indices = Array.from(requireWasm().query_entities(new Uint32Array(typeIds)));
    return indices.map((idx) => {
      const gen = requireWasm().get_entity_generation(idx);
      return createEntityId(idx, gen);
    });
  }

  queryEntitiesRaw(typeIds: number[]): number {
    const count = typeIds.length;
    // Fast path for common component counts (0-16) using zero-alloc views
    if (count <= 16) {
      for (let i = 0; i < count; i++) {
        _typeIdBuffer[i] = typeIds[i] ?? 0;
      }
      const fastView = _typeIdViews[count];
      return requireWasm().query_entities_to_buffer(fastView ?? new Uint32Array(typeIds));
    }
    // Fallback for very complex queries (rare in game engines)
    return requireWasm().query_entities_to_buffer(new Uint32Array(typeIds));
  }

  forEachQueryResultRaw(typeIds: number[], callback: (entityIndex: number) => void): void {
    const count = this.queryEntitiesRaw(typeIds);
    const view = this._getQueryResultView();
    for (let i = 0; i < count; i++) {
      callback(view[i] ?? 0);
    }
  }

  /**
   * Helper to get or refresh the static query result view.
   * Recreates the view if WASM memory has grown.
   * @internal
   */
  private _getQueryResultView(): Uint32Array {
    const mem = _wasmExports?.memory;
    if (!mem) {
      throw new Error('[GWEN] Cannot access WASM memory (not initialized or mock).');
    }

    if (!_queryResultView || _queryResultView.buffer !== mem.buffer) {
      _queryResultView = new Uint32Array(mem.buffer, requireWasm().get_query_result_ptr(), 10_000);
    }
    return _queryResultView;
  }

  getEntityGeneration(index: number): number {
    return requireWasm().get_entity_generation(index);
  }

  // ── Game loop ────────────────────────────────────────────────────────────

  tick(deltaMs: number): void {
    requireWasm().tick(deltaMs);
  }

  // ── Shared memory ────────────────────────────────────────────────────────

  allocSharedBuffer(byteLength: number): number {
    const ptr = requireWasm().alloc_shared_buffer(byteLength);
    if (ptr === 0) {
      throw new Error(
        `[GwenBridge] alloc_shared_buffer failed: requested ${byteLength} bytes. ` +
          `This is either an OOM condition or a zero-size request.`,
      );
    }
    return ptr;
  }

  syncTransformsToBuffer(ptr: number, maxEntities: number): void {
    requireWasm().sync_transforms_to_buffer(ptr, maxEntities);
  }

  syncTransformsToBufferSparse(ptr: number): void {
    requireWasm().sync_transforms_to_buffer_sparse(ptr);
  }

  dirtyTransformCount(): number {
    return requireWasm().dirty_transform_count();
  }

  clearTransformDirty(): void {
    requireWasm().clear_transform_dirty();
  }

  syncTransformsFromBuffer(ptr: number, maxEntities: number): void {
    requireWasm().sync_transforms_from_buffer(ptr, maxEntities);
  }

  // ── Linear memory ────────────────────────────────────────────────────────

  /**
   * Return the live `WebAssembly.Memory` exported by gwen_core.wasm.
   *
   * wasm-bindgen exposes it as `glueModule.memory`. We cache the module
   * reference in `_wasmModule` at init time, so this is a single property
   * read — no cost on the hot path.
   *
   * Returns `null` when the WASM module is not yet loaded or when running
   * in a test environment that injects a mock without a real memory export.
   */
  getLinearMemory(): WebAssembly.Memory | null {
    return _wasmExports?.memory ?? null;
  }

  /**
   * Detect whether `memory.grow()` has been called since the last check.
   *
   * When Rust allocates enough memory to exhaust the current WASM linear memory,
   * the runtime calls `memory.grow(n_pages)`. This **replaces** the underlying
   * `ArrayBuffer`. We detect this by comparing the reference to the current
   * buffer against the one stored during the previous check.
   *
   * **Idempotent** : Calling this twice without a grow returns `false` on the
   * second call (the state was already updated by the first call).
   *
   * **Cost** : O(1) — single pointer comparison.
   *
   * @returns `true` if memory has grown since last check, `false` otherwise.
   *
   * @internal
   */
  checkMemoryGrow(): boolean {
    const mem = _wasmExports?.memory;
    if (!mem) return false;

    const currentBuffer = mem.buffer;

    // First call: initialize state
    if (_lastMemoryBuffer === null) {
      _lastMemoryBuffer = currentBuffer;
      return false;
    }

    // Grow detected: buffer reference changed
    if (_lastMemoryBuffer !== currentBuffer) {
      _lastMemoryBuffer = currentBuffer;
      return true;
    }

    // No grow since last check
    return false;
  }

  // ── Stats ────────────────────────────────────────────────────────────────

  stats(): string {
    return requireWasm().stats();
  }
}

// #endregion

// #region Singleton management & test utilities ────────────────────────────────

const _bridge = new WasmBridgeImpl();

/**
 * Return the `WasmBridge` singleton.
 *
 * The bridge is always available — it is created eagerly at module load time.
 * Methods will throw if `initWasm()` has not been called yet.
 *
 * @example
 * ```typescript
 * await initWasm();
 * const bridge = getWasmBridge();
 * bridge.isActive(); // true
 * ```
 */
export function getWasmBridge(): WasmBridge {
  return _bridge;
}

/**
 * Inject a mock `WasmEngine` — **reserved for unit tests only**.
 *
 * Allows the `Engine` to be tested without a real browser or `.wasm` binary.
 * `getLinearMemory()` returns `null` in this mode because `_wasmModule` is
 * left `null` intentionally — sentinel checks and debug views are silently
 * skipped, which is the correct behaviour in a Node.js test environment.
 *
 * @param mock - A `WasmEngine` mock (typically built with `vi.fn()`).
 */
export function _injectMockWasmEngine(mock: WasmEngine): void {
  _wasmEngine = mock;
  _initPromise = Promise.resolve();
}

/**
 * Inject mock WASM exports — **reserved for unit tests only**.
 *
 * Allows testing `checkMemoryGrow()` by injecting a fake memory object
 * that can be manipulated to simulate a grow event.
 *
 * @param exports - A mock exports object with optional `memory` property.
 *
 * @example
 * ```typescript
 * const buf1 = new ArrayBuffer(100);
 * const buf2 = new ArrayBuffer(200);
 * const mockMemory = { buffer: buf1 } as unknown as { memory?: WebAssembly.Memory };
 * _injectMockWasmExports({ memory: mockMemory });
 *
 * const bridge = getWasmBridge();
 * bridge.checkMemoryGrow(); // init
 * mockMemory.buffer = buf2; // simulate grow
 * expect(bridge.checkMemoryGrow()).toBe(true);
 * ```
 *
 * @internal
 */
export function _injectMockWasmExports(exports: { memory?: WebAssembly.Memory }): void {
  _wasmExports = exports;
}

/**
 * Fully reset the bridge state — **reserved for unit tests only**.
 *
 * Clears `_wasmEngine`, `_wasmExports`, `_initPromise`, and `_lastMemoryBuffer`
 * so that the next `initWasm()` call starts from a clean slate.
 * Call this in `afterEach` to prevent state leaking between tests.
 */
export function _resetWasmBridge(): void {
  _wasmEngine = null;
  _wasmExports = null;
  _initPromise = null;
  _lastMemoryBuffer = null;
  _queryResultView = null;
}

// #endregion
