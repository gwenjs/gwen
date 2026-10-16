/**
 * @file WASM bridge type contracts.
 *
 * Extracted from wasm-bridge.ts — all exported interfaces and type aliases
 * used by consumers of the WasmBridge API. These are erased at compile time
 * and have no impact on V8 inlining of the implementation in wasm-bridge.ts.
 */

import type { EntityId } from "./engine-api";

// ─── Core variant ───────────────────────────────────────────────────────────

/**
 * Available core WASM variants.
 * - light: Minimal ECS core (default)
 * - physics2d: ECS + Rapier2D + Pathfinding 2D
 * - physics3d: ECS + Rapier3D + Pathfinding 3D
 */
export type CoreVariant = "light" | "physics2d" | "physics3d";

// ─── WASM entity handle ─────────────────────────────────────────────────────

/**
 * Opaque entity handle from Rust (index + generation pair).
 * Both fields must be passed back to safely detect stale references.
 */
export interface WasmEntityId {
  readonly index: number;
  readonly generation: number;
}

// ─── WASM core module interface ─────────────────────────────────────────────

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
   *      previously constructed JS views become "detached".
   *      `getLinearMemory()` returns the live `WebAssembly.Memory`.
   *      A view kept across a WASM call must go through `engine.memory.view`:
   *      `.array` rebuilds when `byteLength === 0`. Do not cache the buffer.
   */
  memory?: WebAssembly.Memory;
}

// ─── WASM engine base interface ─────────────────────────────────────────────

/** Exports common to ALL core variants (light, physics2d, physics3d) */
export interface WasmEngineBase {
  // ── Entity ──────────────────────────────────────────────────────────────

  /**
   * Create a new entity and return its index + generation handle.
   * The wasm export throws an `Error` whose message contains `limit` when the quota is hit.
   */
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
   * The wasm export throws an `Error` whose `code` is
   * `CORE:BUFFER_LENGTH_MISMATCH` when the slot and generation buffers
   * differ in length. The message names `gens`, the expected length, and
   * the actual length. Nothing is written.
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
   * The wasm export throws an `Error` whose `code` is
   * `CORE:BUFFER_LENGTH_MISMATCH` when the slot and generation buffers
   * differ in length. The message names `gens`, the expected length, and
   * the actual length. Nothing is written.
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
   * Copy every match into this engine's query result buffer.
   *
   * The buffer belongs to this engine. Its length is fixed at construction.
   * Read that length with `get_query_result_capacity` and the pointer with
   * `get_query_result_ptr`.
   *
   * @param typeIds Component type IDs to match.
   * @returns The number of matches copied. This is the full count, not a short count.
   * @throws When the match count exceeds the buffer capacity. The message is
   *   `query exceeded the buffer capacity`. Nothing was written.
   */
  query_entities_to_buffer(typeIds: Uint32Array): number;
  /**
   * Pointer to this engine's query result buffer.
   * Not a process-global buffer.
   */
  get_query_result_ptr(): number;
  /**
   * Number of entity ids this engine's query result buffer can hold.
   * Allocated from `max_entities` at construction. It does not change.
   * Use this as the view length. Do not guess it from `maxEntities`.
   */
  get_query_result_capacity(): number;
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
  /**
   * Propagate all local transforms through the parent hierarchy so that
   * `get_entity_world_x/y/rotation` return up-to-date world values.
   * Must be called once per frame before reading world positions.
   */
  update_transforms(): void;
  /** Pack history and return the buffer just written, `0` or `1`. */
  transform_history_commit(): number;
  /** Byte offset of history buffer `0` or `1`. `0` when that buffer is absent. */
  transform_history_ptr(buffer: number): number;
  /** Mark the live transform at `index` so the next commit sets the teleport bit. */
  mark_entity_teleport(index: number): void;
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
   * @param positions Flat `[x0, y0, x1, y1, ...]` array. Length must be exactly `2 * N`.
   * @param rotations Flat `[r0, r1, ...]` array. Length must be exactly `N`.
   * @returns `Uint32Array` of N entity slot indices. Both empty (`N = 0`) returns an empty array.
   * @throws {GwenWasmError} code `CORE:BUFFER_LENGTH_MISMATCH` before any entity is created when
   *   `positions` has an odd length or `rotations` is not exactly `N`.
   * @throws {GwenWasmError} code `CORE:ENTITY_LIMIT_REACHED` when N exceeds the remaining capacity.
   */
  bulk_spawn_with_transforms(positions: Float32Array, rotations: Float32Array): Uint32Array;

  // ── Shared memory (WASM plugin bridge) ───────────────────────────────────

  /**
   * Allocate `byteLength` bytes in gwen-core's WASM linear memory.
   * @returns A raw pointer (usize) into WASM linear memory.
   */
  alloc_shared_buffer(byteLength: number): number;
  /**
   * Deallocate a buffer previously allocated by `alloc_shared_buffer`.
   *
   * `ptr == 0` or `byteLength == 0` does nothing. Any other call must use the
   * pointer and the byte length recorded at allocation.
   *
   * @param ptr        Raw pointer returned by `alloc_shared_buffer`.
   * @param byteLength Exact byte count used during allocation.
   * @throws {GwenWasmError} code `CORE:INVALID_SHARED_BUFFER` when `ptr` is
   *   unknown, already freed, or `byteLength` is not the recorded length.
   *   When the length differs, the message is
   *   `invalid shared buffer: ptr <ptr>, len <recorded>`.
   *   `len` is 0 when `ptr` is unknown or already freed.
   *   Nothing is deallocated.
   */
  free_shared_buffer(ptr: number, byteLength: number): void;
  /**
   * Copy hierarchy world transforms into a live core buffer.
   * The pointer stays in this engine. Community modules do not receive it.
   * @param ptr    Pointer returned by `alloc_shared_buffer`.
   * @param maxEntities  Number of entity slots to sync.
   */
  sync_transforms_to_buffer(ptr: number, maxEntities: number): void;

  // ── Stats ────────────────────────────────────────────────────────────────

  /** Return a JSON string with engine runtime metrics (entity count, frame, etc.). */
  stats(): string;
}

// ─── Physics 2D variant ─────────────────────────────────────────────────────

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
    oneWay?: number,
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
  /** Integrate N kinematic body positions in one WASM call. Returns number of bodies updated. */
  physics_bulk_step_kinematics(
    slots: Uint32Array,
    vx: Float32Array,
    vy: Float32Array,
    dt: number,
  ): number;
  /** Apply impulse. */
  physics_apply_impulse(slot: number, x: number, y: number): void;
  /**
   * Set linear velocity.
   * Returns 1 when the body was updated. Throws on a coded failure.
   */
  physics_set_linear_velocity(slot: number, vx: number, vy: number): number;
  /** Apply one impulse to each listed body. Throws on a coded failure. */
  physics2d_bulk_apply_impulse(
    slots: Uint32Array,
    gens: Uint32Array,
    rigidbody_type_id: number,
    impulse_data: Uint8Array,
  ): void;
  /** Copy Rapier poses into the ECS buffers. Returns `[count, bytes]`. */
  physics2d_bulk_sync_from_rapier(
    transform_type_id: number,
    out_slots: Uint32Array,
    out_gens: Uint32Array,
    out_buf: Uint8Array,
  ): Uint32Array;
  /** Copy ECS poses into Rapier. Throws on a coded failure. */
  physics2d_bulk_sync_to_rapier(
    slots: Uint32Array,
    gens: Uint32Array,
    transform_type_id: number,
    data: Uint8Array,
  ): void;
  /** Get linear velocity. Returns [vx, vy]. */
  physics_get_linear_velocity(slot: number): Float32Array;
  /** Get position and rotation. Returns [x, y, rotation]. */
  physics_get_position(slot: number): Float32Array;
  /** Get sensor state. Returns [contactCount, isActive]. */
  physics_get_sensor_state(slot: number, sensorId: number): Int32Array;
  /** Set linear damping coefficient of a dynamic body at runtime. */
  physics_set_linear_damping?(slot: number, damping: number): void;
  /** Return entity slot indices whose colliders intersect a circle at (x, y) with the given radius. */
  physics_query_radius?(
    x: number,
    y: number,
    radius: number,
    membership: number,
    filter: number,
  ): number[];
  /** Return entity slot indices whose colliders intersect an AABB centred at (x, y) with half-extents (hw, hh). */
  physics_query_rect?(
    x: number,
    y: number,
    hw: number,
    hh: number,
    membership: number,
    filter: number,
  ): number[];
  /** Return entity slot indices whose colliders contain the point (x, y). */
  physics_point_query?(x: number, y: number, membership: number, filter: number): number[];

  /** Update sensor state manually. */
  physics_update_sensor_state(slot: number, sensorId: number, started: number): void;

  /** Load tilemap chunk body at world position (x, y). Returns the raw body handle. */
  physics_load_tilemap_chunk_body(
    chunkId: number,
    pseudoEntityIndex: number,
    x: number,
    y: number,
  ): number;
  /** Remove the tilemap chunk body and all its colliders. */
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

// ─── Physics 3D variant ─────────────────────────────────────────────────────

/**
 * Exports additional for the physics3d variant (ECS + Rapier3D).
 *
 * Body kind encoding used throughout this interface:
 * - `0` — Fixed (static, infinite mass)
 * - `1` — Dynamic (fully simulated by Rapier)
 * - `2` — KinematicPositionBased (position driven by explicit writes)
 *
 * A fallible export throws an `Error` with a `code` property (`PHYSICS3D:*`, or
 * `CORE:*` for a shared-buffer check). It never returns a sentinel for a failure.
 * A `boolean` result is `true` on success. A missing body is an empty `Float32Array`
 * for a getter that returns a vector, and a `[0]` for a query miss.
 */
export interface WasmEnginePhysics3D extends WasmEngineBase {
  // ── World lifecycle ───────────────────────────────────────────────────────

  physics3d_init(gx: number, gy: number, gz: number, maxEntities: number): void;
  /** Throws `PHYSICS3D:NOT_INITIALIZED` before `physics3d_init`. A Rapier trap stays a trap. */
  physics3d_step(delta: number): void;
  physics3d_set_quality?(preset: number): void;
  physics3d_set_event_coalescing?(enabled: boolean): void;
  physics3d_set_body_solver_iterations?(entityIndex: number, iterations: number): boolean;
  physics3d_wake_all?(): void;

  // ── Body lifecycle ────────────────────────────────────────────────────────

  /** Returns `true`. Throws `PHYSICS3D:BODY_ALREADY_EXISTS` when the slot has a body. */
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
  /** Returns `true`. Throws `PHYSICS3D:BODY_NOT_FOUND` when the slot has no body. */
  physics3d_remove_body(entityIndex: number): boolean;
  physics3d_has_body(entityIndex: number): boolean;

  // ── State read/write ──────────────────────────────────────────────────────

  /** Empty array when the slot has no body. Layout `[px,py,pz, qx,qy,qz,qw, vx,vy,vz, ax,ay,az]`. */
  physics3d_get_body_state(entityIndex: number): Float32Array;
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

  physics3d_get_linear_velocity(entityIndex: number): Float32Array;
  physics3d_set_linear_velocity(entityIndex: number, vx: number, vy: number, vz: number): boolean;

  // ── Angular velocity ──────────────────────────────────────────────────────

  physics3d_get_angular_velocity(entityIndex: number): Float32Array;
  physics3d_set_angular_velocity(entityIndex: number, ax: number, ay: number, az: number): boolean;

  // ── Impulse ───────────────────────────────────────────────────────────────

  physics3d_apply_impulse(entityIndex: number, ix: number, iy: number, iz: number): boolean;

  // ── Body kind ─────────────────────────────────────────────────────────────

  /** Returns `0`, `1` or `2`. Throws `PHYSICS3D:BODY_NOT_FOUND` when the slot has no body. */
  physics3d_get_body_kind(entityIndex: number): number;
  physics3d_set_body_kind(entityIndex: number, kind: number): boolean;

  // ── Kinematic positioning ──────────────────────────────────────────────────

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
  /** Returns the number of bodies moved. Throws `PHYSICS3D:BUFFER_LENGTH_MISMATCH`. */
  physics3d_bulk_step_kinematics?(
    slots: Uint32Array,
    vx: Float32Array,
    vy: Float32Array,
    vz: Float32Array,
    dt: number,
  ): number;
  /** Returns the number of bodies rotated. Throws `PHYSICS3D:BUFFER_LENGTH_MISMATCH`. */
  physics3d_bulk_step_kinematic_rotations?(
    slots: Uint32Array,
    wx: Float32Array,
    wy: Float32Array,
    wz: Float32Array,
    dt: number,
  ): number;

  // ── Angular impulse ───────────────────────────────────────────────────────

  physics3d_apply_angular_impulse?(
    entityIndex: number,
    ax: number,
    ay: number,
    az: number,
  ): boolean;

  // ── Collider management ───────────────────────────────────────────────────

  physics3d_add_box_collider?(
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
    layerBits: number,
    maskBits: number,
    colliderId: number,
  ): boolean;

  physics3d_add_sphere_collider?(
    entityIndex: number,
    radius: number,
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

  physics3d_add_capsule_collider?(
    entityIndex: number,
    radius: number,
    halfHeight: number,
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

  physics3d_add_heightfield_collider?(
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
  ): boolean;

  physics3d_update_heightfield_collider?(
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
  ): boolean;

  /** Returns `true`. Throws `PHYSICS3D:COLLIDER_NOT_FOUND` when the pair is unknown. */
  physics3d_remove_collider?(entityIndex: number, colliderId: number): boolean;

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

  physics3d_add_convex_collider?(
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
  ): boolean;

  physics3d_load_bvh_collider?(
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
  ): boolean;

  /** Returns the number of colliders inserted, equal to the number of shapes. */
  physics3d_add_compound_collider?(
    entityIndex: number,
    shapeData: Float32Array,
    layerBits: number,
    maskBits: number,
  ): number;

  /** Returns the number of bodies spawned. Nothing is written when it throws. */
  physics3d_bulk_spawn_static_boxes?(
    entityIndices: Uint32Array,
    positionsFlat: Float32Array,
    halfExtentsFlat: Float32Array,
    friction: number,
    restitution: number,
    layerBits: number,
    maskBits: number,
  ): number;

  // ── Sensor state ──────────────────────────────────────────────────────────

  /**
   * Packed state: bits 0-31 are the contact count, bit 32 is the active flag.
   * `0n` when no state was recorded for a registered body.
   */
  physics3d_get_sensor_state?(entityIndex: number, sensorId: number): bigint;
  physics3d_update_sensor_state?(
    entityIndex: number,
    sensorId: number,
    isActive: boolean,
    count: number,
  ): void;

  // ── Forces, gravity scale, locks, sleeping ────────────────────────────────

  physics3d_add_force?(entityIndex: number, fx: number, fy: number, fz: number): boolean;
  physics3d_add_torque?(entityIndex: number, tx: number, ty: number, tz: number): boolean;
  physics3d_add_force_at_point?(
    entityIndex: number,
    fx: number,
    fy: number,
    fz: number,
    px: number,
    py: number,
    pz: number,
  ): boolean;
  physics3d_set_gravity_scale?(entityIndex: number, scale: number): boolean;
  /** Returns the scale. Throws `PHYSICS3D:BODY_NOT_FOUND` when the slot has no body. */
  physics3d_get_gravity_scale?(entityIndex: number): number;
  physics3d_lock_translations?(entityIndex: number, x: boolean, y: boolean, z: boolean): boolean;
  physics3d_lock_rotations?(entityIndex: number, x: boolean, y: boolean, z: boolean): boolean;
  physics3d_set_body_sleeping?(entityIndex: number, sleeping: boolean): boolean;
  physics3d_is_body_sleeping?(entityIndex: number): boolean;

  // ── Joints ────────────────────────────────────────────────────────────────

  /** Returns the joint id. Throws `PHYSICS3D:BODY_NOT_FOUND` or `PHYSICS3D:INVALID_JOINT`. */
  physics3d_add_fixed_joint?(
    entityA: number,
    entityB: number,
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
  ): number;
  physics3d_add_revolute_joint?(
    entityA: number,
    entityB: number,
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    axisX: number,
    axisY: number,
    axisZ: number,
    useLimits: boolean,
    limitMin: number,
    limitMax: number,
  ): number;
  physics3d_add_prismatic_joint?(
    entityA: number,
    entityB: number,
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    axisX: number,
    axisY: number,
    axisZ: number,
    useLimits: boolean,
    limitMin: number,
    limitMax: number,
  ): number;
  physics3d_add_ball_joint?(
    entityA: number,
    entityB: number,
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    useConeLimit: boolean,
    coneAngle: number,
  ): number;
  physics3d_add_spring_joint?(
    entityA: number,
    entityB: number,
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    restLength: number,
    stiffness: number,
    damping: number,
  ): number;
  /** Returns `true`. Throws `PHYSICS3D:JOINT_NOT_FOUND` when the id is unknown. */
  physics3d_remove_joint?(id: number): boolean;
  physics3d_set_joint_motor_velocity?(id: number, velocity: number, maxForce: number): boolean;
  physics3d_set_joint_motor_position?(
    id: number,
    target: number,
    stiffness: number,
    damping: number,
  ): boolean;
  physics3d_set_joint_enabled?(id: number, enabled: boolean): boolean;

  // ── Navigation grid ───────────────────────────────────────────────────────

  /** Throws `PHYSICS3D:INVALID_NAVGRID` for a zero dimension, an overflow or a grid over the cell limit. */
  physics3d_init_navgrid_3d?(
    ptr: number,
    width: number,
    height: number,
    depth: number,
    cellSize: number,
    originX: number,
    originY: number,
    originZ: number,
  ): void;
  /** Returns the waypoint count. Throws `PHYSICS3D:NAVGRID_NOT_INITIALIZED` or `PHYSICS3D:INVALID_PATH_REQUEST`. */
  physics3d_find_path_3d?(
    fromX: number,
    fromY: number,
    fromZ: number,
    toX: number,
    toY: number,
    toZ: number,
  ): number;
  physics3d_get_path_buffer_ptr_3d?(): number;

  // ── Spatial queries ───────────────────────────────────────────────────────

  /** `[1, entity, toi, nx, ny, nz, px, py, pz]` on a hit, `[0]` on a miss. */
  physics3d_cast_ray?(
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    maxDist: number,
    layers: number,
    mask: number,
    solid: boolean,
  ): Float32Array;
  /** 15 floats on a hit, `[0]` on a miss. */
  physics3d_cast_shape?(
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
  ): Float32Array;
  /** Returns the overlap count. Throws `CORE:INVALID_SHARED_BUFFER` for an `outPtr` that is not a live shared buffer. */
  physics3d_overlap_shape?(
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
  ): number;
  /** `[1, entity, px, py, pz, isInside]` on a hit, `[0]` on a miss. */
  physics3d_project_point?(
    px: number,
    py: number,
    pz: number,
    layers: number,
    mask: number,
    solid: boolean,
  ): Float32Array;

  // ── Character controller ──────────────────────────────────────────────────

  /**
   * Returns the controller slot. Throws `PHYSICS3D:CHARACTER_CONTROLLER_LIMIT_REACHED`
   * when the pool is full. The pool is unchanged when it throws.
   */
  physics3d_add_character_controller?(
    entityIndex: number,
    stepHeight: number,
    slopeLimit: number,
    skinWidth: number,
    snapToGround: number,
    slideOnSteepSlopes: boolean,
    applyImpulsesToDynamic: boolean,
  ): number;
  physics3d_character_controller_move?(
    entityIndex: number,
    vx: number,
    vy: number,
    vz: number,
    dt: number,
  ): void;
  physics3d_remove_character_controller?(entityIndex: number): void;
  physics3d_get_cc_sab_ptr?(): number;
  physics3d_get_max_cc_entities?(): number;

  // ── Collision event ring buffer ───────────────────────────────────────────

  physics3d_get_collision_events_ptr?(): number;
  physics3d_get_collision_event_count?(): number;
  physics3d_consume_events?(): void;
}

// ─── Combined WASM engine type ──────────────────────────────────────────────

/**
 * Runtime engine contract:
 * - Base exports are always present.
 * - Physics-specific exports are present only in matching variants.
 */
export type WasmEngine = WasmEngineBase &
  Partial<Omit<WasmEnginePhysics2D, keyof WasmEngineBase>> &
  Partial<Omit<WasmEnginePhysics3D, keyof WasmEngineBase>>;

// ─── Init options ───────────────────────────────────────────────────────────

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
}

// ─── WasmBridge public interface ────────────────────────────────────────────

export interface WasmBridge {
  /** True if Rust/WASM core is initialized and ready. */
  isActive(): boolean;

  /** Active WASM variant. */
  readonly variant: CoreVariant;

  /** Whether physics exports are available (variant is 'physics2d' or 'physics3d'). */
  hasPhysics(): boolean;

  /**
   * Get physics-specific bridge.
   * @throws {GwenError} If the active variant is 'light'.
   */
  getPhysicsBridge(): WasmEnginePhysics2D | WasmEnginePhysics3D;

  /** Direct access to the Rust WasmEngine instance. Throws if not initialized. */
  engine(): WasmEngine;

  // ── Entity ──────────────────────────────────────────────────────────────

  /** Create a new entity and return its packed handle (index + generation). */
  createEntity(): WasmEntityId;
  /**
   * Create N entities, each with a transform.
   * `positions` length must be exactly `2 * N`. `rotations` length must be exactly `N`.
   * @throws {GwenError} code `CORE:BUFFER_LENGTH_MISMATCH` before any entity is created when
   *   `positions` has an odd length or `rotations` is not exactly `N`.
   * @throws {GwenError} code `CORE:ENTITY_LIMIT_REACHED` when N exceeds the remaining capacity.
   *   No entity is created in that case.
   */
  bulkSpawnWithTransforms(positions: Float32Array, rotations: Float32Array): Uint32Array;
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
   * @param entities       Packed `EntityId` handles (index + generation).
   * @param componentTypeId Component type ID from `registerComponentType()`.
   * @param componentSize  Byte size of one component instance.
   * @returns `Float32Array` of length `entities.length * (componentSize / 4)`.
   */
  readComponentsBulk(
    entities: EntityId[],
    componentTypeId: number,
    componentSize: number,
  ): Float32Array;

  /**
   * Writes component data for multiple entities in a single WASM call.
   *
   * @param entities        Packed `EntityId` handles (index + generation).
   * @param componentTypeId Component type ID from `registerComponentType()`.
   * @param data            Packed component data; total byte length must equal
   *                        `entities.length * componentSize`.
   * @throws {GwenWasmError} code `CORE:BUFFER_LENGTH_MISMATCH` when `data`
   *   is not that length for a type that already has a stride. The message
   *   names both sizes. Nothing is written.
   * @throws `CORE:COMPONENT_WRITE_REJECTED` when core storage refuses the write.
   *   A fixed-size type whose size differs from the stride is refused before
   *   any entity is written. A refusal found later, for one entity, leaves the
   *   entities before it in `entities` with their new value.
   */
  writeComponentsBulk(entities: EntityId[], componentTypeId: number, data: Float32Array): void;

  /**
   * Query entities with ALL given component types and bulk-read one component
   * type. One WASM call when the result fits in the slots buffer.
   *
   * @param componentTypeIds - Component type IDs every matching entity must have
   * @param readTypeId       - Which component type to read into the returned buffer
   * @param f32Stride        - Float32 values per entity (`component._f32Stride`)
   * @returns `{ entityCount, data, slots, gens }` where `data` is a zero-copy
   *   `Float32Array` view, and `slots`/`gens` are `Uint32Array` views for
   *   passing back to `queryWriteBulk`.
   * @throws `CORE:QUERY_CAPACITY_EXCEEDED` when the match count is longer
   *   than the slots buffer.
   */
  queryReadBulk(
    componentTypeIds: number[],
    readTypeId: number,
    f32Stride: number,
  ): { entityCount: number; data: Float32Array; slots: Uint32Array; gens: Uint32Array };

  /**
   * Write back component data for a previously-queried entity set in one WASM call.
   *
   * @param slots       - Entity slot indices (from `queryReadBulk` result)
   * @param gens        - Entity generation counters (from `queryReadBulk` result)
   * @param writeTypeId - Component type ID to write
   * @param data        - Updated packed Float32 data (`entityCount x f32Stride` elements)
   * @throws {GwenWasmError} code `CORE:BUFFER_LENGTH_MISMATCH` when `gens` or
   *   `data` has the wrong length. The message names both sizes. Nothing is written.
   */
  queryWriteBulk(
    slots: Uint32Array,
    gens: Uint32Array,
    writeTypeId: number,
    data: Float32Array,
  ): void;

  // ── Query ────────────────────────────────────────────────────────────────

  updateEntityArchetype(index: number, typeIds: number[]): void;
  removeEntityFromQuery(index: number): void;
  queryEntities(typeIds: number[]): EntityId[];
  queryEntitiesRaw(typeIds: number[]): number;
  forEachQueryResultRaw(typeIds: number[], callback: (entityIndex: number) => void): void;
  getEntityGeneration(index: number): number;

  // ── Shared memory (WASM plugin bridge) ───────────────────────────────────

  allocSharedBuffer(byteLength: number): number;
  /**
   * Release a buffer previously obtained from `allocSharedBuffer`.
   *
   * `ptr == 0` or `byteLength == 0` does nothing. Any other call must use the
   * pointer and the byte length recorded at allocation. After a successful
   * call the pointer is no longer live.
   *
   * @param ptr        Pointer returned by `allocSharedBuffer`.
   * @param byteLength Byte count used during `allocSharedBuffer`.
   * @throws {GwenWasmError} code `CORE:INVALID_SHARED_BUFFER` when `ptr` is
   *   unknown, already freed, or `byteLength` is not the recorded length.
   *   When the length differs, the message is
   *   `invalid shared buffer: ptr <ptr>, len <recorded>`.
   *   `len` is 0 when `ptr` is unknown or already freed.
   *   Nothing is deallocated.
   */
  freeSharedBuffer(ptr: number, byteLength: number): void;
  syncTransformsToBuffer(ptr: number, maxEntities: number): void;
  getLinearMemory(): WebAssembly.Memory | null;
  checkMemoryGrow(): boolean;

  // ── Stats ────────────────────────────────────────────────────────────────

  stats(): string;
}
