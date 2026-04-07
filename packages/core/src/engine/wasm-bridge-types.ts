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
   *      previously constructed JS views become "detached" and must be
   *      recreated.  `getLinearMemory()` on the bridge always returns the
   *      live `WebAssembly.Memory` object, so callers should re-wrap
   *      `memory.buffer` on every frame rather than caching the buffer.
   */
  memory?: WebAssembly.Memory;
}

// ─── WASM engine base interface ─────────────────────────────────────────────

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
   * @param positions Flat `[x0, y0, x1, y1, ...]` array — length must be `2 * N`.
   * @param rotations Flat `[r0, r1, ...]` array — length must be `N` (or empty for all-zero).
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

// ─── Physics 3D variant ─────────────────────────────────────────────────────

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

  physics3d_init(gx: number, gy: number, gz: number, maxEntities: number): void;
  physics3d_step(delta: number): void;

  // ── Body lifecycle ────────────────────────────────────────────────────────

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
  physics3d_remove_body(entityIndex: number): boolean;
  physics3d_has_body(entityIndex: number): boolean;

  // ── State read/write ──────────────────────────────────────────────────────

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

  // ── Sensor state ──────────────────────────────────────────────────────────

  physics3d_get_sensor_state?(entityIndex: number, sensorId: number): BigInt64Array | number[];
  physics3d_update_sensor_state?(
    entityIndex: number,
    sensorId: number,
    isActive: number,
    count: number,
  ): void;

  // ── Quality & coalescing ──────────────────────────────────────────────────

  physics3d_set_quality?(preset: number): void;
  physics3d_set_event_coalescing?(enabled: number): void;

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
  /**
   * Whether SharedArrayBuffer is strictly required (default: false).
   * If true and SAB is unavailable, `initWasm` will throw.
   */
  requireSAB?: boolean;
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

  // ── Game loop ────────────────────────────────────────────────────────────

  tick(deltaMs: number): void;

  // ── Shared memory (WASM plugin bridge) ───────────────────────────────────

  allocSharedBuffer(byteLength: number): number;
  syncTransformsToBuffer(ptr: number, maxEntities: number): void;
  syncTransformsToBufferSparse(ptr: number): void;
  dirtyTransformCount(): number;
  clearTransformDirty(): void;
  syncTransformsFromBuffer(ptr: number, maxEntities: number): void;
  getLinearMemory(): WebAssembly.Memory | null;
  checkMemoryGrow(): boolean;

  // ── Stats ────────────────────────────────────────────────────────────────

  stats(): string;
}
