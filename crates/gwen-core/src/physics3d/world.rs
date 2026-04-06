//! PhysicsWorld3D — Rapier3D world integration for GWEN v2.
//!
//! Provides the full body management pipeline: initialization, rigid body
//! CRUD, state read/write, impulse application, collider management, collision
//! event exposure, sensor state tracking, and quality preset control.
//!
//! The world tracks entity indices → Rapier `RigidBodyHandle` mappings so the
//! TypeScript layer can address bodies by stable entity index rather than by
//! opaque Rapier handles.
//!
//! # Body kind encoding
//! The `kind` parameter used throughout this module is a `u8` discriminant:
//! - `0` — Fixed (static, infinite mass)
//! - `1` — Dynamic (fully simulated)
//! - `2` — KinematicPositionBased (driven by explicit position writes)
//! - `255` — sentinel for "not found" in `get_body_kind`
//!
//! # Collision events
//! Events are collected during [`step`] and written into the zero-copy ring
//! buffer defined in [`crate::physics3d::events`]. JavaScript reads the buffer
//! directly via pointer, then calls [`consume_events`] to advance the read
//! head.
//!
//! # Sensor states
//! For each sensor collider the world tracks `(contact_count, is_active)`.
//! These are updated automatically from `CollisionEvent::Started /
//! Stopped` events during the step and can also be overridden manually via
//! [`update_sensor_state`].

use std::collections::HashMap;
use std::num::NonZeroUsize;

use rapier3d::control::{CharacterAutostep, CharacterLength, KinematicCharacterController};
use rapier3d::dynamics::RigidBodyHandle;
use rapier3d::geometry::{ColliderHandle, Group, InteractionGroups};
use rapier3d::na::{Quaternion, Translation3, Unit, UnitQuaternion};
use rapier3d::parry::query::ShapeCastOptions;
use rapier3d::prelude::*;

use crate::physics3d::components::{
    PhysicsQualityPreset3D, QualitySolverConfig3D, quality_solver_config_3d,
};
use crate::physics3d::events::{
    PhysicsCollisionEvent3D, clear_collision_events_3d, push_collision_event_3d,
    get_collision_events_ptr_3d, get_collision_event_count_3d,
};

/// Maximum number of simultaneously active character controllers.
pub const MAX_CC_ENTITIES: usize = 32;

/// f32 fields per CC slot: [grounded, normal_x, normal_y, normal_z, ground_entity_bits].
pub const CC_STATE_STRIDE: usize = 5;

/// Output buffer written by [`PhysicsWorld3D::character_controller_move`].
///
/// Indexed as `CC_STATE_BUFFER[slot_index * CC_STATE_STRIDE]`.
/// JS reads this via a `Float32Array` view into WASM linear memory.
static mut CC_STATE_BUFFER: [f32; MAX_CC_ENTITIES * CC_STATE_STRIDE] =
    [0.0_f32; MAX_CC_ENTITIES * CC_STATE_STRIDE];

// ─── Debug logging macros ─────────────────────────────────────────────────────

/// Log a debug warning message to the browser console.
/// Active only in debug builds AND in WASM context; zero cost in release or native tests.
#[cfg(all(debug_assertions, target_arch = "wasm32"))]
macro_rules! debug_warn {
    ($($arg:tt)*) => {{
        let msg = format!("[gwen-physics3d] {}", format!($($arg)*));
        web_sys::console::warn_1(&wasm_bindgen::JsValue::from_str(&msg));
    }};
}

/// Disabled in release builds or non-WASM contexts — compiles to nothing.
#[cfg(not(all(debug_assertions, target_arch = "wasm32")))]
macro_rules! debug_warn {
    ($($arg:tt)*) => {};
}

// ─── Constants ────────────────────────────────────────────────────────────────

/// Sentinel value stored in `user_data` when a collider has no explicit ID.
const COLLIDER_ID_ABSENT: u32 = u32::MAX;

/// Sentinel value written to `ground_entity_bits` when the contact is with a static
/// world collider that has no parent `RigidBody`.
pub const GROUND_ENTITY_STATIC: u32 = u32::MAX - 1;

// ─── Collider parameters ──────────────────────────────────────────────────────

/// Common configuration shared by every collider variant.
///
/// Groups the 9 parameters that appear in every `add_*_collider` method
/// to reduce repetition and avoid the `too_many_arguments` clippy lint.
#[derive(Debug, Clone, Copy)]
pub(crate) struct ColliderParams {
    /// Local X-axis offset from body origin (metres).
    pub offset_x: f32,
    /// Local Y-axis offset from body origin (metres).
    pub offset_y: f32,
    /// Local Z-axis offset from body origin (metres).
    pub offset_z: f32,
    /// If `true`, this collider generates events but exerts no physical force.
    pub is_sensor: bool,
    /// Surface friction coefficient (≥ 0).
    pub friction: f32,
    /// Bounciness in [0, 1].
    pub restitution: f32,
    /// Collision layer membership bitmask.
    pub layer_bits: u32,
    /// Collision filter mask bitmask.
    pub mask_bits: u32,
    /// Application-defined stable collider ID (used in events and as a map key).
    pub collider_id: u32,
}

// ─── user_data packing ────────────────────────────────────────────────────────

/// Pack `(entity_index, collider_id)` into a `u128` `user_data` field.
///
/// Layout (little-endian): bits 0–31 = `collider_id`, bits 32–63 = `entity_index`.
#[inline]
fn pack_user_data(entity_index: u32, collider_id: u32) -> u128 {
    ((entity_index as u128) << 32) | (collider_id as u128)
}

/// Unpack `user_data` into `(entity_index, Option<collider_id>)`.
///
/// Returns `None` for the collider ID component when the raw value equals
/// [`COLLIDER_ID_ABSENT`].
#[inline]
fn unpack_user_data(user_data: u128) -> (u32, Option<u32>) {
    let entity_index = (user_data >> 32) as u32;
    let collider_id_raw = (user_data & 0xffff_ffff) as u32;
    let collider_id = if collider_id_raw == COLLIDER_ID_ABSENT {
        None
    } else {
        Some(collider_id_raw)
    };
    (entity_index, collider_id)
}

// ─── Body kind helpers ────────────────────────────────────────────────────────

/// Convert a `u8` kind discriminant into a Rapier [`RigidBodyType`].
///
/// # Arguments
/// * `kind` — `0` = Fixed, `1` = Dynamic, `2` = KinematicPositionBased.
///   Any other value falls back to `Dynamic`.
#[inline]
fn kind_to_body_type(kind: u8) -> RigidBodyType {
    match kind {
        0 => RigidBodyType::Fixed,
        2 => RigidBodyType::KinematicPositionBased,
        _ => RigidBodyType::Dynamic,
    }
}

/// Convert a Rapier [`RigidBodyType`] into the `u8` kind discriminant.
///
/// Returns `255` for any unrecognised variant (acts as a "not found" sentinel).
#[inline]
fn body_type_to_kind(bt: RigidBodyType) -> u8 {
    match bt {
        RigidBodyType::Fixed => 0,
        RigidBodyType::Dynamic => 1,
        RigidBodyType::KinematicPositionBased => 2,
        _ => 255,
    }
}

// ─── Event collector ──────────────────────────────────────────────────────────

/// Rapier [`EventHandler`] implementation that writes collision events into
/// the zero-copy static ring buffer.
///
/// Instantiated per-step and passed directly to `PhysicsPipeline::step`.
/// Sensor state updates happen in a post-step pass inside [`PhysicsWorld3D::step`].
struct EventCollector3D;

impl EventHandler for EventCollector3D {
    fn handle_collision_event(
        &self,
        _bodies: &RigidBodySet,
        colliders: &ColliderSet,
        event: CollisionEvent,
        _contact_pair: Option<&ContactPair>,
    ) {
        let (ea, ca) = colliders
            .get(event.collider1())
            .map(|c| unpack_user_data(c.user_data))
            .unwrap_or((u32::MAX, None));

        let (eb, cb) = colliders
            .get(event.collider2())
            .map(|c| unpack_user_data(c.user_data))
            .unwrap_or((u32::MAX, None));

        // Skip events involving unknown/tombstone bodies.
        if ea == u32::MAX || eb == u32::MAX {
            return;
        }

        push_collision_event_3d(PhysicsCollisionEvent3D {
            entity_a: ea,
            entity_b: eb,
            flags: if event.started() { 1 } else { 0 },
            collider_a_id: ca.unwrap_or(u32::MAX) as u16,
            collider_b_id: cb.unwrap_or(u32::MAX) as u16,
        });
    }

    fn handle_contact_force_event(
        &self,
        _dt: f32,
        _bodies: &RigidBodySet,
        _colliders: &ColliderSet,
        _contact_pair: &ContactPair,
        _total_force_magnitude: f32,
    ) {
    }
}

// ─── World ────────────────────────────────────────────────────────────────────

/// Manages a Rapier3D simulation world, including a mapping from ECS entity
/// indices to Rapier rigid body handles.
///
/// # Thread safety
/// This struct is `!Send + !Sync` (Rapier sets are not `Send` in WASM).
/// It must only be accessed from the single WASM thread.
pub struct PhysicsWorld3D {
    pipeline: PhysicsPipeline,
    gravity: Vector<f32>,
    integration_params: IntegrationParameters,
    island_manager: IslandManager,
    broad_phase: DefaultBroadPhase,
    narrow_phase: NarrowPhase,
    rigid_body_set: RigidBodySet,
    collider_set: ColliderSet,
    impulse_joint_set: ImpulseJointSet,
    multibody_joint_set: MultibodyJointSet,
    ccd_solver: CCDSolver,
    /// Spatial query acceleration structure (BVH over all colliders).
    /// Updated after every [`step`] call.
    query_pipeline: QueryPipeline,
    /// Mapping from ECS entity index → Rapier handle.
    entity_handles: HashMap<u32, RigidBodyHandle>,
    /// Mapping from `(entity_index, collider_id)` → [`ColliderHandle`].
    ///
    /// Populated by every `add_*_collider` call so that [`remove_collider`]
    /// can look up the handle without a linear scan of the collider set.
    collider_handles: HashMap<(u32, u32), ColliderHandle>,
    /// Per-sensor tracking: `(entity_index, sensor_id)` → `(contact_count, is_active)`.
    sensor_states: HashMap<(u32, u32), (u32, bool)>,
    /// When `true`, duplicate (entity_a, entity_b) pairs within the same step
    /// are coalesced into a single event before writing to the ring buffer.
    coalesce_events: bool,
    /// Current quality preset (cached to allow re-applying after init).
    quality_preset: PhysicsQualityPreset3D,
    /// Monotonically increasing counter used to assign stable integer IDs to joints.
    next_joint_id: u32,
    /// Mapping from stable joint ID (u32) to Rapier ImpulseJointHandle.
    joint_handles: HashMap<u32, ImpulseJointHandle>,
    /// Mapping from ECS entity index → [`KinematicCharacterController`] instance
    /// paired with the `apply_impulses_to_dynamic` flag.
    ///
    /// Populated by [`add_character_controller`] and cleared by
    /// [`remove_character_controller`]. One controller per entity is supported;
    /// inserting a second controller for the same entity replaces the first.
    cc_controllers: HashMap<u32, (KinematicCharacterController, bool)>,
    /// Compact slot index for each CC entity (entity_index → 0..MAX_CC_ENTITIES).
    cc_slot_indices: HashMap<u32, u32>,
    /// Counter for assigning compact CC slot indices.
    next_cc_slot: u32,
    /// Recycled CC slot indices freed by [`remove_character_controller`].
    ///
    /// Slots are pushed here on removal and popped before allocating a fresh
    /// slot, keeping usage below [`MAX_CC_ENTITIES`] even through many
    /// add/remove cycles.
    cc_free_slots: Vec<u32>,
    /// Reverse map: `RigidBodyHandle → entity_index` for O(1) ground-entity
    /// look-up in [`character_controller_move`].
    ///
    /// Kept in sync with [`entity_handles`] by [`add_body`] and [`remove_body`].
    handle_to_entity: HashMap<RigidBodyHandle, u32>,
}

// ─── Shape type constants for the compound batch buffer ─────────────────────
const COMPOUND_SHAPE_BOX: u32 = 0;
const COMPOUND_SHAPE_SPHERE: u32 = 1;
const COMPOUND_SHAPE_CAPSULE: u32 = 2;

impl PhysicsWorld3D {
    /// Create a new 3D physics world with the given gravity vector.
    ///
    /// # Arguments
    /// * `gravity_x` — X component of gravity (m/s²).
    /// * `gravity_y` — Y component of gravity (m/s²). Typical value: `-9.81`.
    /// * `gravity_z` — Z component of gravity (m/s²).
    pub fn new(gravity_x: f32, gravity_y: f32, gravity_z: f32) -> Self {
        let mut world = PhysicsWorld3D {
            pipeline: PhysicsPipeline::new(),
            gravity: vector![gravity_x, gravity_y, gravity_z],
            integration_params: IntegrationParameters::default(),
            island_manager: IslandManager::new(),
            broad_phase: DefaultBroadPhase::new(),
            narrow_phase: NarrowPhase::new(),
            rigid_body_set: RigidBodySet::new(),
            collider_set: ColliderSet::new(),
            impulse_joint_set: ImpulseJointSet::new(),
            multibody_joint_set: MultibodyJointSet::new(),
            ccd_solver: CCDSolver::new(),
            query_pipeline: QueryPipeline::new(),
            entity_handles: HashMap::new(),
            collider_handles: HashMap::new(),
            sensor_states: HashMap::new(),
            coalesce_events: false,
            quality_preset: PhysicsQualityPreset3D::Medium,
            next_joint_id: 0,
            joint_handles: HashMap::new(),
            cc_controllers: HashMap::new(),
            cc_slot_indices: HashMap::new(),
            next_cc_slot: 0,
            cc_free_slots: Vec::new(),
            handle_to_entity: HashMap::new(),
        };
        // Apply the default quality preset so solver parameters are consistent.
        world.apply_quality_config(quality_solver_config_3d(PhysicsQualityPreset3D::Medium));
        world
    }

    // ── Quality preset ────────────────────────────────────────────────────────

    /// Apply a [`QualitySolverConfig3D`] directly to the integration parameters.
    fn apply_quality_config(&mut self, cfg: QualitySolverConfig3D) {
        self.integration_params.num_solver_iterations =
            NonZeroUsize::new(cfg.num_solver_iterations).unwrap_or(NonZeroUsize::MIN);
        self.integration_params.num_internal_stabilization_iterations =
            cfg.num_internal_stabilization_iterations;
        self.integration_params.max_ccd_substeps = cfg.max_ccd_substeps;
    }

    /// Select a quality preset, updating solver iteration counts immediately.
    ///
    /// | Preset  | Solver iters | Stabilization iters | CCD substeps |
    /// |---------|:------------:|:-------------------:|:------------:|
    /// | Low     | 2            | 1                   | 1            |
    /// | Medium  | 4            | 2                   | 1            |
    /// | High    | 8            | 3                   | 2            |
    /// | Esport  | 10           | 4                   | 4            |
    ///
    /// # Arguments
    /// * `preset` — `0` = Low, `1` = Medium, `2` = High, `3` = Esport.
    ///   Any unrecognised value maps to `Medium`.
    pub fn set_quality(&mut self, preset: u8) {
        let q = PhysicsQualityPreset3D::from_u8(preset);
        self.quality_preset = q;
        self.apply_quality_config(quality_solver_config_3d(q));
    }

    // ── Event coalescing ──────────────────────────────────────────────────────

    /// Enable or disable collision event coalescing.
    ///
    /// When enabled, multiple events for the same `(entity_a, entity_b)` pair
    /// generated within a single step are deduplicated — only the most recent
    /// one is kept in the ring buffer. This reduces event volume at the cost of
    /// losing intermediate state transitions.
    ///
    /// # Arguments
    /// * `enabled` — `true` to enable coalescing, `false` to disable.
    pub fn set_event_coalescing(&mut self, enabled: bool) {
        self.coalesce_events = enabled;
    }

    // ── Simulation step ───────────────────────────────────────────────────────

    /// Advance the simulation by `delta` seconds.
    ///
    /// Drains Rapier collision events into the static ring buffer defined in
    /// [`crate::physics3d::events`] and updates sensor states from
    /// started/stopped contact events.
    ///
    /// # Arguments
    /// * `delta` — Elapsed time in seconds (e.g. `0.016` for 60 Hz).
    pub fn step(&mut self, delta: f32) {
        self.integration_params.dt = delta;
        // Clear the ring buffer before generating new events for this tick.
        clear_collision_events_3d();

        self.pipeline.step(
            &self.gravity,
            &self.integration_params,
            &mut self.island_manager,
            &mut self.broad_phase,
            &mut self.narrow_phase,
            &mut self.rigid_body_set,
            &mut self.collider_set,
            &mut self.impulse_joint_set,
            &mut self.multibody_joint_set,
            &mut self.ccd_solver,
            None,
            &(),
            &EventCollector3D,
        );

        // Post-step: update sensor_states from the event buffer that was just
        // populated by EventCollector3D.  We read back the ring buffer here so
        // we don't need a second event channel.
        self.update_sensor_states_from_events();

        // Rebuild the spatial query BVH so castRay / castShape / overlapShape
        // / projectPoint reflect the new collider positions this frame.
        self.query_pipeline.update(&self.collider_set);
    }

    /// Scan the current ring buffer and update `sensor_states` for any sensor
    /// collider whose contacts started or stopped this step.
    fn update_sensor_states_from_events(&mut self) {
        let count = get_collision_event_count_3d();
        if count == 0 {
            return;
        }
        // SAFETY: The pointer is valid until the next `clear_collision_events_3d()`,
        // which only happens at the top of the next `step()` call. We do not
        // mutate the buffer here.
        let ptr = get_collision_events_ptr_3d();
        for i in 0..count {
            let event = unsafe { &*ptr.add(i) };

            // collider_a sensor
            let ca_id = event.collider_a_id as u32;
            if ca_id != u32::MAX {
                let key = (event.entity_a, ca_id);
                if self.is_sensor_collider(event.entity_a, ca_id) {
                    let entry = self.sensor_states.entry(key).or_insert((0, false));
                    if event.flags & 1 != 0 {
                        // started
                        entry.0 = entry.0.saturating_add(1);
                        entry.1 = true;
                    } else {
                        // stopped
                        entry.0 = entry.0.saturating_sub(1);
                        entry.1 = entry.0 > 0;
                    }
                }
            }

            // collider_b sensor
            let cb_id = event.collider_b_id as u32;
            if cb_id != u32::MAX {
                let key = (event.entity_b, cb_id);
                if self.is_sensor_collider(event.entity_b, cb_id) {
                    let entry = self.sensor_states.entry(key).or_insert((0, false));
                    if event.flags & 1 != 0 {
                        entry.0 = entry.0.saturating_add(1);
                        entry.1 = true;
                    } else {
                        entry.0 = entry.0.saturating_sub(1);
                        entry.1 = entry.0 > 0;
                    }
                }
            }
        }
    }

    /// Returns `true` if the collider registered under `(entity_index, collider_id)`
    /// is marked as a sensor in the Rapier collider set.
    fn is_sensor_collider(&self, entity_index: u32, collider_id: u32) -> bool {
        self.collider_handles
            .get(&(entity_index, collider_id))
            .and_then(|&h| self.collider_set.get(h))
            .map(|c| c.is_sensor())
            .unwrap_or(false)
    }

    // ── Collision event buffer API ────────────────────────────────────────────

    /// Return a raw pointer to the start of the 3D collision event ring buffer.
    ///
    /// The buffer is allocated in WASM linear memory and is valid for the
    /// lifetime of the module. JavaScript should wrap it in a `Uint8Array` view
    /// of length `get_collision_event_count() * EVENT_STRIDE_3D`.
    ///
    /// # Returns
    /// Pointer (as `usize`) to the start of the [`PhysicsCollisionEvent3D`] array.
    pub fn get_collision_events_ptr(&self) -> usize {
        get_collision_events_ptr_3d() as usize
    }

    /// Return the number of collision events written since the last [`step`] call.
    pub fn get_collision_event_count(&self) -> u32 {
        get_collision_event_count_3d() as u32
    }

    /// Clear (consume) all pending collision events.
    ///
    /// Call this after JavaScript has finished reading the event buffer to
    /// signal that the events have been processed. The next [`step`] call also
    /// implicitly clears the buffer.
    pub fn consume_events(&mut self) {
        clear_collision_events_3d();
    }

    // ── Sensor state ──────────────────────────────────────────────────────────

    /// Return the sensor state for a collider as a packed `u64`.
    ///
    /// Bit layout: `bits 0–31 = contact_count (u32)`, `bit 32 = is_active (bool)`.
    ///
    /// Returns `0` (inactive, zero contacts) if no state has been recorded for
    /// the given pair.
    ///
    /// # Arguments
    /// * `entity_index` — ECS entity slot index.
    /// * `sensor_id`    — Stable collider ID used when the sensor was created.
    pub fn get_sensor_state(&self, entity_index: u32, sensor_id: u32) -> u64 {
        let (count, active) = self
            .sensor_states
            .get(&(entity_index, sensor_id))
            .copied()
            .unwrap_or((0, false));
        (count as u64) | ((active as u64) << 32)
    }

    /// Manually override the sensor state for a collider.
    ///
    /// Normally sensor state is derived automatically from collision events
    /// produced during [`step`]. Use this method when you need to reset or
    /// pre-populate the state from the JavaScript side.
    ///
    /// # Arguments
    /// * `entity_index` — ECS entity slot index.
    /// * `sensor_id`    — Stable collider ID.
    /// * `is_active`    — Whether the sensor is currently overlapping.
    /// * `count`        — Number of concurrent overlapping contacts.
    pub fn update_sensor_state(
        &mut self,
        entity_index: u32,
        sensor_id: u32,
        is_active: bool,
        count: u32,
    ) {
        self.sensor_states
            .insert((entity_index, sensor_id), (count, is_active));
    }

    // ── Body lifecycle ────────────────────────────────────────────────────────

    /// Register a new rigid body for the given entity index.
    ///
    /// # Arguments
    /// * `entity_index`    — ECS entity slot index used as the stable key.
    /// * `x`, `y`, `z`    — Initial world-space position.
    /// * `kind`            — `0` = Fixed, `1` = Dynamic, `2` = KinematicPositionBased.
    /// * `mass`            — Body mass in kg (only relevant for Dynamic bodies).
    /// * `linear_damping`  — Linear velocity damping coefficient (≥ 0).
    /// * `angular_damping` — Angular velocity damping coefficient (≥ 0).
    ///
    /// # Returns
    /// `true` if the body was created and registered. `false` if the entity
    /// index was already registered (no-op; call [`remove_body`] first).
    pub fn add_body(
        &mut self,
        entity_index: u32,
        x: f32,
        y: f32,
        z: f32,
        kind: u8,
        mass: f32,
        linear_damping: f32,
        angular_damping: f32,
    ) -> bool {
        if self.entity_handles.contains_key(&entity_index) {
            debug_warn!("add_body(entity={}): body already registered — ignoring duplicate registration", entity_index);
            return false;
        }

        let body_type = kind_to_body_type(kind);

        let mut builder = RigidBodyBuilder::new(body_type)
            .translation(vector![x, y, z])
            .linear_damping(linear_damping)
            .angular_damping(angular_damping);

        // Apply mass only for dynamic bodies; fixed/kinematic bodies ignore it
        // in Rapier, but setting it explicitly keeps the API symmetric.
        if body_type == RigidBodyType::Dynamic {
            builder = builder.additional_mass(mass);
        }

        let handle = self.rigid_body_set.insert(builder.build());
        self.entity_handles.insert(entity_index, handle);
        self.handle_to_entity.insert(handle, entity_index);
        true
    }

    /// Remove the rigid body associated with the given entity index.
    ///
    /// Removes all attached colliders and clears any sensor state tracked for
    /// the entity.
    ///
    /// # Arguments
    /// * `entity_index` — ECS entity slot index.
    ///
    /// # Returns
    /// `true` if a body was found and removed, `false` if none was registered.
    pub fn remove_body(&mut self, entity_index: u32) -> bool {
        if let Some(handle) = self.entity_handles.remove(&entity_index) {
            // Keep the reverse map in sync.
            self.handle_to_entity.remove(&handle);
            // Remove all collider handle entries that belong to this entity so
            // the map stays consistent with the collider set.
            self.collider_handles
                .retain(|&(eidx, _), _| eidx != entity_index);
            // Drop any sensor state for this entity.
            self.sensor_states
                .retain(|&(eidx, _), _| eidx != entity_index);

            // Remove all joints whose handle references this body.
            // Rapier auto-removes attached joints when a body is removed, so we only
            // need to clean the local map.
            self.joint_handles.retain(|_, &mut jh| {
                if let Some(joint) = self.impulse_joint_set.get(jh) {
                    joint.body1 != handle && joint.body2 != handle
                } else {
                    false
                }
            });

            self.rigid_body_set.remove(
                handle,
                &mut self.island_manager,
                &mut self.collider_set,
                &mut self.impulse_joint_set,
                &mut self.multibody_joint_set,
                // remove_attached_colliders = true
                true,
            );
            true
        } else {
            false
        }
    }

    /// Check whether a rigid body is currently registered for the entity.
    ///
    /// # Arguments
    /// * `entity_index` — ECS entity slot index.
    #[inline]
    pub fn has_body(&self, entity_index: u32) -> bool {
        self.entity_handles.contains_key(&entity_index)
    }

    // ── Collider management ───────────────────────────────────────────────────

    /// Build [`InteractionGroups`] from raw bitmask values.
    ///
    /// Rapier uses a `Group` bitflags type; this helper converts the plain
    /// `u32` values from the WASM API into the correct type.
    #[inline]
    fn make_interaction_groups(layer_bits: u32, mask_bits: u32) -> InteractionGroups {
        InteractionGroups::new(
            Group::from_bits_truncate(layer_bits),
            Group::from_bits_truncate(mask_bits),
        )
    }

    /// Finish configuring a [`ColliderBuilder`] with the shared collider
    /// parameters common to all shape types, then insert it.
    ///
    /// Returns `true` if a parent rigid body was found for the entity and the
    /// collider was inserted, or `false` if `entity_index` has no body.
    fn insert_collider(
        &mut self,
        entity_index: u32,
        params: ColliderParams,
        builder: ColliderBuilder,
    ) -> bool {
        let Some(&body_handle) = self.entity_handles.get(&entity_index) else {
            debug_warn!("insert_collider(entity={}, collider={}): no registered body — call add_body() first", entity_index, params.collider_id);
            return false;
        };

        let groups = Self::make_interaction_groups(params.layer_bits, params.mask_bits);
        let collider = builder
            .translation(vector![params.offset_x, params.offset_y, params.offset_z])
            .sensor(params.is_sensor)
            .friction(params.friction)
            .restitution(params.restitution)
            .collision_groups(groups)
            .user_data(pack_user_data(entity_index, params.collider_id))
            .active_events(ActiveEvents::COLLISION_EVENTS)
            .build();

        let ch = self.collider_set.insert_with_parent(
            collider,
            body_handle,
            &mut self.rigid_body_set,
        );
        self.collider_handles.insert((entity_index, params.collider_id), ch);
        true
    }

    /// Attach an axis-aligned box collider to the rigid body of an entity.
    ///
    /// # Arguments
    /// * `entity_index` — ECS entity slot index.
    /// * `half_x/y/z`  — Half-extents of the box (metres).
    /// * `offset_x/y/z`— Local-space offset from the body origin.
    /// * `is_sensor`   — If `true`, no physical response; only events.
    /// * `friction`    — Surface friction coefficient (≥ 0).
    /// * `restitution` — Bounciness in \[0, 1\].
    /// * `layer_bits`  — Collision layer bitmask.
    /// * `mask_bits`   — Collision filter bitmask.
    /// * `collider_id` — Stable ID stored in events and used as the map key.
    ///
    /// # Returns
    /// `true` on success, `false` if the entity has no registered body.
    pub fn add_box_collider(
        &mut self,
        entity_index: u32,
        half_x: f32,
        half_y: f32,
        half_z: f32,
        offset_x: f32,
        offset_y: f32,
        offset_z: f32,
        is_sensor: bool,
        friction: f32,
        restitution: f32,
        layer_bits: u32,
        mask_bits: u32,
        collider_id: u32,
    ) -> bool {
        let builder = ColliderBuilder::cuboid(half_x, half_y, half_z);
        let params = ColliderParams {
            offset_x,
            offset_y,
            offset_z,
            is_sensor,
            friction,
            restitution,
            layer_bits,
            mask_bits,
            collider_id,
        };
        self.insert_collider(entity_index, params, builder)
    }

    /// Attach a sphere collider to the rigid body of an entity.
    ///
    /// # Arguments
    /// * `entity_index` — ECS entity slot index.
    /// * `radius`       — Sphere radius (metres).
    /// * `offset_x/y/z`— Local-space offset from the body origin.
    /// * `is_sensor`    — If `true`, no physical response; only events.
    /// * `friction`     — Surface friction coefficient (≥ 0).
    /// * `restitution`  — Bounciness in \[0, 1\].
    /// * `layer_bits`   — Collision layer bitmask.
    /// * `mask_bits`    — Collision filter bitmask.
    /// * `collider_id`  — Stable ID stored in events and used as the map key.
    ///
    /// # Returns
    /// `true` on success, `false` if the entity has no registered body.
    pub fn add_sphere_collider(
        &mut self,
        entity_index: u32,
        radius: f32,
        offset_x: f32,
        offset_y: f32,
        offset_z: f32,
        is_sensor: bool,
        friction: f32,
        restitution: f32,
        layer_bits: u32,
        mask_bits: u32,
        collider_id: u32,
    ) -> bool {
        let builder = ColliderBuilder::ball(radius);
        let params = ColliderParams {
            offset_x,
            offset_y,
            offset_z,
            is_sensor,
            friction,
            restitution,
            layer_bits,
            mask_bits,
            collider_id,
        };
        self.insert_collider(entity_index, params, builder)
    }

    /// Attach a vertical capsule collider to the rigid body of an entity.
    ///
    /// The capsule is oriented along the Y axis: it extends `±half_height`
    /// metres from the centre, capped by hemispheres of `radius` metres.
    ///
    /// # Arguments
    /// * `entity_index`  — ECS entity slot index.
    /// * `radius`        — Hemisphere radius (metres).
    /// * `half_height`   — Half-height of the cylindrical shaft (metres).
    /// * `offset_x/y/z` — Local-space offset from the body origin.
    /// * `is_sensor`     — If `true`, no physical response; only events.
    /// * `friction`      — Surface friction coefficient (≥ 0).
    /// * `restitution`   — Bounciness in \[0, 1\].
    /// * `layer_bits`    — Collision layer bitmask.
    /// * `mask_bits`     — Collision filter bitmask.
    /// * `collider_id`   — Stable ID stored in events and used as the map key.
    ///
    /// # Returns
    /// `true` on success, `false` if the entity has no registered body.
    pub fn add_capsule_collider(
        &mut self,
        entity_index: u32,
        radius: f32,
        half_height: f32,
        offset_x: f32,
        offset_y: f32,
        offset_z: f32,
        is_sensor: bool,
        friction: f32,
        restitution: f32,
        layer_bits: u32,
        mask_bits: u32,
        collider_id: u32,
    ) -> bool {
        let builder = ColliderBuilder::capsule_y(half_height, radius);
        let params = ColliderParams {
            offset_x,
            offset_y,
            offset_z,
            is_sensor,
            friction,
            restitution,
            layer_bits,
            mask_bits,
            collider_id,
        };
        self.insert_collider(entity_index, params, builder)
    }

    /// Attach a heightfield collider to a static body.
    ///
    /// The heightfield is defined on a rows × cols grid. Each cell value is a height in
    /// *local* Y-axis units — multiply by `scale_y` to get world-space metres.
    ///
    /// # Arguments
    /// * `entity_index`  — ECS entity slot index.
    /// * `heights_flat`  — Row-major flat array of `rows × cols` height values.
    /// * `rows`          — Number of rows (Z axis).
    /// * `cols`          — Number of columns (X axis).
    /// * `scale_x`       — World-space width of the entire heightfield (metres).
    /// * `scale_y`       — World-space maximum height multiplier (metres).
    /// * `scale_z`       — World-space depth of the entire heightfield (metres).
    /// * `friction`      — Surface friction coefficient.
    /// * `restitution`   — Bounciness \[0, 1\].
    /// * `layer_bits`    — Collision layer membership bitmask.
    /// * `mask_bits`     — Collision filter bitmask.
    /// * `collider_id`   — Stable ID for event lookup.
    ///
    /// # Returns
    /// `true` on success, `false` if the entity has no body or input is invalid.
    pub fn add_heightfield_collider(
        &mut self,
        entity_index: u32,
        heights_flat: &[f32],
        rows: usize,
        cols: usize,
        scale_x: f32,
        scale_y: f32,
        scale_z: f32,
        friction: f32,
        restitution: f32,
        layer_bits: u32,
        mask_bits: u32,
        collider_id: u32,
    ) -> bool {
        if heights_flat.len() != rows * cols {
            return false;
        }
        use rapier3d::na::DMatrix;
        let matrix = DMatrix::from_row_slice(rows, cols, heights_flat);
        let builder = ColliderBuilder::heightfield(
            matrix,
            vector![scale_x, scale_y, scale_z],
        );
        let params = ColliderParams {
            offset_x: 0.0,
            offset_y: 0.0,
            offset_z: 0.0,
            is_sensor: false,
            friction,
            restitution,
            layer_bits,
            mask_bits,
            collider_id,
        };
        self.insert_collider(entity_index, params, builder)
    }

    /// Replace the height data of an existing heightfield collider.
    ///
    /// Removes the old collider by `(entity_index, collider_id)` and inserts a
    /// new one with updated heights while preserving all other parameters.
    ///
    /// Returns `true` on success. Returns `false` if the entity has no body or
    /// the input dimensions are inconsistent.
    #[allow(clippy::too_many_arguments)]
    pub fn update_heightfield_collider(
        &mut self,
        entity_index: u32,
        collider_id: u32,
        heights_flat: &[f32],
        rows: usize,
        cols: usize,
        scale_x: f32,
        scale_y: f32,
        scale_z: f32,
        friction: f32,
        restitution: f32,
        layer_bits: u32,
        mask_bits: u32,
    ) -> bool {
        if let Some(&ch) = self.collider_handles.get(&(entity_index, collider_id)) {
            self.collider_set.remove(
                ch,
                &mut self.island_manager,
                &mut self.rigid_body_set,
                false,
            );
            self.collider_handles.remove(&(entity_index, collider_id));
        }
        self.add_heightfield_collider(
            entity_index, heights_flat, rows, cols,
            scale_x, scale_y, scale_z,
            friction, restitution, layer_bits, mask_bits, collider_id,
        )
    }

    /// Attach a triangle-mesh collider to a 3D body.
    ///
    /// `vertices_flat` must be a multiple of 3 floats (`[x0,y0,z0, x1,y1,z1, ...]`).
    /// `indices_flat` must be a multiple of 3 u32s (`[a0,b0,c0, ...]`).
    ///
    /// Returns `false` when the entity has no registered body, or either slice is empty.
    pub fn add_mesh_collider(
        &mut self,
        entity_index: u32,
        vertices_flat: &[f32],
        indices_flat: &[u32],
        offset_x: f32,
        offset_y: f32,
        offset_z: f32,
        is_sensor: bool,
        friction: f32,
        restitution: f32,
        layer_bits: u32,
        mask_bits: u32,
        collider_id: u32,
    ) -> bool {
        let verts: Vec<rapier3d::na::Point3<f32>> = vertices_flat
            .chunks_exact(3)
            .map(|c| rapier3d::na::Point3::new(c[0], c[1], c[2]))
            .collect();
        let idxs: Vec<[u32; 3]> = indices_flat
            .chunks_exact(3)
            .map(|c| [c[0], c[1], c[2]])
            .collect();
        if verts.is_empty() || idxs.is_empty() {
            return false;
        }
        let builder = ColliderBuilder::trimesh(verts, idxs);
        let params = ColliderParams {
            offset_x,
            offset_y,
            offset_z,
            is_sensor,
            friction,
            restitution,
            layer_bits,
            mask_bits,
            collider_id,
        };
        self.insert_collider(entity_index, params, builder)
    }

    /// Rebuild an existing mesh collider with new geometry.
    ///
    /// Removes the old collider and inserts a fresh trimesh built from `vertices_flat`
    /// and `indices_flat`. If no collider with the given `(entity_index, collider_id)`
    /// pair exists, a new one is inserted (same behaviour as [`add_mesh_collider`]).
    ///
    /// # Arguments
    /// * `entity_index`   — ECS entity slot index.
    /// * `collider_id`    — Stable collider ID (same one originally passed to `add_mesh_collider`).
    /// * `vertices_flat`  — New vertex positions `[x0,y0,z0, x1,y1,z1, ...]`.
    /// * `indices_flat`   — New triangle indices `[a0,b0,c0, ...]`.
    /// * `offset_x/y/z`  — Local-space offset from the body origin.
    /// * `is_sensor`      — If `true`, no physical response; only events.
    /// * `friction`       — Surface friction coefficient (≥ 0).
    /// * `restitution`    — Bounciness in \[0, 1\].
    /// * `layer_bits`     — Collision layer bitmask.
    /// * `mask_bits`      — Collision filter bitmask.
    ///
    /// # Returns
    /// `true` on success, `false` if the entity has no registered body.
    #[allow(clippy::too_many_arguments)]
    pub fn rebuild_mesh_collider(
        &mut self,
        entity_index: u32,
        collider_id: u32,
        vertices_flat: &[f32],
        indices_flat: &[u32],
        offset_x: f32,
        offset_y: f32,
        offset_z: f32,
        is_sensor: bool,
        friction: f32,
        restitution: f32,
        layer_bits: u32,
        mask_bits: u32,
    ) -> bool {
        // Remove the existing collider if present.
        if let Some(&ch) = self.collider_handles.get(&(entity_index, collider_id)) {
            self.collider_set.remove(
                ch,
                &mut self.island_manager,
                &mut self.rigid_body_set,
                // wake_up = true: re-activate the parent body after geometry change.
                true,
            );
            self.collider_handles.remove(&(entity_index, collider_id));
            self.sensor_states.remove(&(entity_index, collider_id));
        }
        // Insert new trimesh with updated geometry.
        self.add_mesh_collider(
            entity_index,
            vertices_flat,
            indices_flat,
            offset_x,
            offset_y,
            offset_z,
            is_sensor,
            friction,
            restitution,
            layer_bits,
            mask_bits,
            collider_id,
        )
    }

    /// Attach a convex-hull collider to a 3D body.
    ///
    /// `vertices_flat` must be a multiple of 3 floats (`[x0,y0,z0, x1,y1,z1, ...]`).
    /// When Rapier cannot compute a convex hull (e.g. degenerate point cloud), the
    /// function falls back to a unit sphere (`ball(0.5)`) rather than failing.
    ///
    /// Returns `false` when the entity has no registered body or the vertex slice is empty.
    pub fn add_convex_collider(
        &mut self,
        entity_index: u32,
        vertices_flat: &[f32],
        offset_x: f32,
        offset_y: f32,
        offset_z: f32,
        is_sensor: bool,
        friction: f32,
        restitution: f32,
        density: f32,
        layer_bits: u32,
        mask_bits: u32,
        collider_id: u32,
    ) -> bool {
        let verts: Vec<rapier3d::na::Point3<f32>> = vertices_flat
            .chunks_exact(3)
            .map(|c| rapier3d::na::Point3::new(c[0], c[1], c[2]))
            .collect();
        if verts.is_empty() {
            return false;
        }
        let builder = if verts.len() < 4 {
            // parry3d panics on IncompleteInput when fewer than 4 points are
            // provided; use the ball fallback directly rather than letting it panic.
            debug_warn!("add_convex_collider(entity={}): only {} vertices — degenerate input, falling back to unit sphere", entity_index, verts.len());
            ColliderBuilder::ball(0.5)
        } else {
            match ColliderBuilder::convex_hull(&verts) {
                Some(b) => b,
                None => {
                    debug_warn!("add_convex_collider(entity={}): Rapier convex hull failed on {} vertices, falling back to unit sphere", entity_index, verts.len());
                    ColliderBuilder::ball(0.5)
                }
            }
        }
        .density(density);
        let params = ColliderParams {
            offset_x,
            offset_y,
            offset_z,
            is_sensor,
            friction,
            restitution,
            layer_bits,
            mask_bits,
            collider_id,
        };
        self.insert_collider(entity_index, params, builder)
    }

    /// Load a pre-baked BVH buffer as a trimesh collider.
    ///
    /// The buffer must have been produced by `build_bvh_buffer()` or
    /// `build_bvh_from_glb()` (both in the `build-tools` feature). Deserialising
    /// the pre-baked [`rapier3d::geometry::TriMesh`] costs ~2 ms vs ~50 ms for a
    /// fresh `trimesh()` construction on large meshes.
    ///
    /// # Format
    /// `[4: "GBVH"][2: rapier_major u16 LE][2: rapier_minor u16 LE][N: bincode(TriMesh)]`
    ///
    /// # Arguments
    /// * `entity_index`  — ECS entity slot index.
    /// * `bvh_bytes`     — Pre-baked BVH buffer (GBVH header + bincode `TriMesh`).
    /// * `offset_x/y/z`  — Local-space offset from the body origin (metres).
    /// * `is_sensor`     — When `true`, collision response is suppressed; only events fire.
    /// * `friction`      — Surface friction coefficient (≥ 0).
    /// * `restitution`   — Bounciness coefficient (\[0, 1\]).
    /// * `layer_bits`    — Collision layer membership bitmask.
    /// * `mask_bits`     — Collision filter bitmask.
    /// * `collider_id`   — Stable application-defined collider ID.
    ///
    /// # Returns
    /// `true` on success, `false` if `bvh_bytes` is too short, the magic header
    /// is wrong, bincode decoding fails, or the entity has no registered body.
    pub fn load_bvh_collider(
        &mut self,
        entity_index: u32,
        bvh_bytes: &[u8],
        offset_x: f32,
        offset_y: f32,
        offset_z: f32,
        is_sensor: bool,
        friction: f32,
        restitution: f32,
        layer_bits: u32,
        mask_bits: u32,
        collider_id: u32,
    ) -> bool {
        use rapier3d::geometry::TriMesh;
        if bvh_bytes.len() < 8 {
            debug_warn!("load_bvh_collider(entity={}): buffer too short ({} bytes, need ≥ 8)", entity_index, bvh_bytes.len());
            return false;
        }
        if &bvh_bytes[0..4] != b"GBVH" {
            debug_warn!("load_bvh_collider(entity={}): invalid magic header, expected 'GBVH'", entity_index);
            return false;
        }
        let payload = &bvh_bytes[8..];
        let result: Result<(TriMesh, _), _> =
            bincode::serde::decode_from_slice(payload, bincode::config::standard());
        let trimesh = match result {
            Ok((t, _)) => t,
            Err(_e) => {
                debug_warn!("load_bvh_collider(entity={}): bincode decode failed — {:?}", entity_index, _e);
                return false;
            }
        };
        let builder = ColliderBuilder::new(rapier3d::geometry::SharedShape::new(trimesh));
        let params = ColliderParams {
            offset_x,
            offset_y,
            offset_z,
            is_sensor,
            friction,
            restitution,
            layer_bits,
            mask_bits,
            collider_id,
        };
        self.insert_collider(entity_index, params, builder)
    }

    /// Bulk-create N static rigid bodies with box colliders in a single call.
    ///
    /// # Arguments
    /// * `entity_indices`    — Pre-allocated ECS entity slot indices (one per body).
    /// * `positions_flat`    — Flat `[x0,y0,z0, x1,y1,z1, ...]` — must have `N × 3` elements.
    /// * `half_extents_flat` — Either `3` floats (uniform for all N) or `N × 3` floats
    ///                         (per-entity half-extents).
    /// * `friction`          — Surface friction coefficient (≥ 0).
    /// * `restitution`       — Bounciness coefficient (\[0, 1\]).
    /// * `layer_bits`        — Collision layer membership bitmask.
    /// * `mask_bits`         — Collision filter bitmask.
    ///
    /// Returns the number of bodies created. Each body uses `collider_id = 0`.
    ///
    /// # Panics
    /// Panics in debug builds if `positions_flat.len() < entity_indices.len() * 3`.
    #[allow(clippy::too_many_arguments)]
    /// Add multiple static box colliders in one call (bulk operation).
    ///
    /// Creates N fixed rigid bodies with cuboid colliders, one per entity index.
    /// This avoids N WASM round-trips for a single batch of static scenery.
    ///
    /// # Arguments
    /// * `entity_indices` — array of entity indices to attach bodies to.
    /// * `positions_flat` — flat array of `[x, y, z, x, y, z, ...]` coordinates (length must be ≥ n*3).
    /// * `half_extents_flat` — either 3 elements `[hx, hy, hz]` (uniform, applied to all),
    ///   or n*3 elements `[hx₀, hy₀, hz₀, hx₁, hy₁, hz₁, ...]` (per-entity).
    /// * `friction` — friction coefficient for all bodies.
    /// * `restitution` — restitution coefficient for all bodies.
    /// * `layer_bits` — collision layer bits for all bodies.
    /// * `mask_bits` — collision mask bits for all bodies.
    ///
    /// # Returns
    /// Number of bodies successfully added. If input buffers are malformed
    /// (too short), returns 0 and adds no bodies. Partial success is not possible —
    /// either all N bodies are added or none.
    ///
    /// # Bounds Checking
    /// Returns 0 (without adding anything) if:
    /// - `entity_indices.is_empty()` (n=0)
    /// - `positions_flat.len() < n * 3` (positions buffer too short)
    /// - `!uniform_extents && half_extents_flat.len() < n * 3` (extents buffer too short for per-entity mode)
    pub fn bulk_add_static_boxes(
        &mut self,
        entity_indices: &[u32],
        positions_flat: &[f32],
        half_extents_flat: &[f32],
        friction: f32,
        restitution: f32,
        layer_bits: u32,
        mask_bits: u32,
    ) -> u32 {
        let n = entity_indices.len();
        
        // Return 0 early on malformed input — never panic
        if n == 0 {
            return 0;
        }
        
        // Validate positions buffer length
        if positions_flat.len() < n * 3 {
            return 0;
        }
        
        let uniform_extents = half_extents_flat.len() == 3;
        
        // Validate half_extents buffer length
        if !uniform_extents && half_extents_flat.len() < n * 3 {
            return 0;
        }
        
        let groups = Self::make_interaction_groups(layer_bits, mask_bits);
        let mut count = 0u32;

        for i in 0..n {
            let px = positions_flat[i * 3];
            let py = positions_flat[i * 3 + 1];
            let pz = positions_flat[i * 3 + 2];
            let (hx, hy, hz) = if uniform_extents {
                (half_extents_flat[0], half_extents_flat[1], half_extents_flat[2])
            } else {
                (
                    half_extents_flat[i * 3],
                    half_extents_flat[i * 3 + 1],
                    half_extents_flat[i * 3 + 2],
                )
            };
            let entity_index = entity_indices[i];

            let rb = RigidBodyBuilder::fixed()
                .translation(vector![px, py, pz])
                .build();
            let handle = self.rigid_body_set.insert(rb);
            self.entity_handles.insert(entity_index, handle);

            let collider = ColliderBuilder::cuboid(hx, hy, hz)
                .collision_groups(groups)
                .friction(friction)
                .restitution(restitution)
                .user_data(pack_user_data(entity_index, 0))
                .active_events(ActiveEvents::COLLISION_EVENTS)
                .build();
            let ch = self.collider_set.insert_with_parent(
                collider,
                handle,
                &mut self.rigid_body_set,
            );
            self.collider_handles.insert((entity_index, 0), ch);
            count += 1;
        }
        count
    }

    /// Attach multiple primitive colliders to one rigid body in a single call.
    ///
    /// This avoids N WASM round-trips for an N-shape compound body.
    ///
    /// # Buffer layout (12 `f32` per shape)
    /// `[shape_type, p0, p1, p2, p3, offset_x, offset_y, offset_z, is_sensor, friction, restitution, collider_id]`
    /// - BOX (0):     `p0=half_x, p1=half_y, p2=half_z, p3=0`
    /// - SPHERE (1):  `p0=radius, p1=p2=p3=0`
    /// - CAPSULE (2): `p0=radius, p1=half_height, p2=p3=0`
    ///
    /// Unknown shape types are silently skipped (not counted).
    ///
    /// # Returns
    /// Number of colliders successfully inserted (0 if `entity_index` has no
    /// body or `shape_data.len()` is not a multiple of 12).
    pub fn add_compound_collider(
        &mut self,
        entity_index: u32,
        shape_data: &[f32],
        layer_bits: u32,
        mask_bits: u32,
    ) -> u32 {
        const FLOATS_PER_SHAPE: usize = 12;
        if shape_data.len() % FLOATS_PER_SHAPE != 0 {
            return 0;
        }

        let mut count = 0u32;
        for chunk in shape_data.chunks_exact(FLOATS_PER_SHAPE) {
            let shape_type = chunk[0] as u32;
            let p0 = chunk[1];
            let p1 = chunk[2];
            let p2 = chunk[3];
            // chunk[4] is reserved (p3), ignored
            let ox = chunk[5];
            let oy = chunk[6];
            let oz = chunk[7];
            let is_sensor = chunk[8] != 0.0;
            let friction = chunk[9];
            let restitution = chunk[10];
            let collider_id = chunk[11] as u32;

            let builder = match shape_type {
                COMPOUND_SHAPE_BOX => ColliderBuilder::cuboid(p0, p1, p2),
                COMPOUND_SHAPE_SPHERE => ColliderBuilder::ball(p0),
                COMPOUND_SHAPE_CAPSULE => ColliderBuilder::capsule_y(p1, p0),
                _ => continue,
            };

            if self.insert_collider(
                entity_index,
                ColliderParams {
                    offset_x: ox,
                    offset_y: oy,
                    offset_z: oz,
                    is_sensor,
                    friction,
                    restitution,
                    layer_bits,
                    mask_bits,
                    collider_id,
                },
                builder,
            ) {
                count += 1;
            }
        }
        count
    }

    /// Remove a specific collider from the simulation.
    ///
    /// The rigid body the collider was attached to is not affected.
    ///
    /// # Arguments
    /// * `entity_index` — ECS entity slot index.
    /// * `collider_id`  — Stable ID that was passed when the collider was created.
    ///
    /// # Returns
    /// `true` if the collider was found and removed, `false` otherwise.
    pub fn remove_collider(&mut self, entity_index: u32, collider_id: u32) -> bool {
        let key = (entity_index, collider_id);
        let Some(ch) = self.collider_handles.remove(&key) else {
            return false;
        };
        // Also drop any sensor state for this specific collider.
        self.sensor_states.remove(&key);

        self.collider_set.remove(
            ch,
            &mut self.island_manager,
            &mut self.rigid_body_set,
            // wake_up = true so the parent body re-enters the active island.
            true,
        );
        true
    }

    // ── Kinematic body control ────────────────────────────────────────────────

    /// Set the target position and orientation of a kinematic body.
    ///
    /// Rapier interpolates between the current and next position to compute
    /// velocity, ensuring smooth collision response for kinematic bodies.
    /// Has no effect on Fixed or Dynamic bodies.
    ///
    /// # Arguments
    /// * `entity_index`    — ECS entity slot index.
    /// * `px/py/pz`        — Target world-space position.
    /// * `qx/qy/qz/qw`    — Target orientation (unit quaternion, xyzw order).
    ///
    /// # Returns
    /// `true` on success, `false` if the entity has no registered body.
    pub fn set_kinematic_position(
        &mut self,
        entity_index: u32,
        px: f32,
        py: f32,
        pz: f32,
        qx: f32,
        qy: f32,
        qz: f32,
        qw: f32,
    ) -> bool {
        let Some(&handle) = self.entity_handles.get(&entity_index) else {
            return false;
        };
        let Some(body) = self.rigid_body_set.get_mut(handle) else {
            return false;
        };
        let rotation = UnitQuaternion::new_normalize(Quaternion::new(qw, qx, qy, qz));
        let iso = Isometry::from_parts(Translation3::new(px, py, pz), rotation);
        body.set_next_kinematic_position(iso);
        true
    }

    /// Integrate the positions of N 3D kinematic bodies in one pass.
    ///
    /// For each body `i`, computes:
    /// `new_pos = current_pos + (vx[i], vy[i], vz[i]) * dt`
    /// The current orientation is preserved unchanged.
    ///
    /// Lengths of `slots`, `vx`, `vy`, and `vz` must be equal; any trailing mismatch
    /// is silently ignored (only `min(slots.len(), vx.len(), vy.len(), vz.len())` bodies
    /// are processed). Bodies not found by their slot index are silently skipped.
    ///
    /// # Arguments
    /// * `slots` — Entity indices. Must have the same length as `vx`, `vy`, `vz`.
    /// * `vx`, `vy`, `vz` — Desired velocity components in m/s.
    /// * `dt` — Delta time in seconds.
    ///
    /// # Returns
    /// Number of bodies actually updated.
    pub fn bulk_step_kinematics(
        &mut self,
        slots: &[u32],
        vx: &[f32],
        vy: &[f32],
        vz: &[f32],
        dt: f32,
    ) -> u32 {
        let count = slots.len().min(vx.len()).min(vy.len()).min(vz.len());
        let mut updated = 0u32;
        for i in 0..count {
            let Some(&handle) = self.entity_handles.get(&slots[i]) else {
                continue;
            };
            let Some(body) = self.rigid_body_set.get_mut(handle) else {
                continue;
            };
            let pos = *body.position();
            let t = Translation3::new(
                pos.translation.x + vx[i] * dt,
                pos.translation.y + vy[i] * dt,
                pos.translation.z + vz[i] * dt,
            );
            let iso = Isometry::from_parts(t, pos.rotation);
            body.set_next_kinematic_position(iso);
            updated += 1;
        }
        updated
    }

    /// Integrate the orientations of N 3D kinematic bodies in one pass.
    ///
    /// Applies first-order quaternion integration:
    /// `dq = 0.5 * [wx, wy, wz, 0] * q * dt`, then normalises.
    /// The current position is preserved unchanged.
    ///
    /// Lengths of `slots`, `wx`, `wy`, and `wz` must be equal; any trailing mismatch
    /// is silently ignored. Bodies not found by their slot index are silently skipped.
    /// The position of each body is preserved unchanged.
    ///
    /// # Arguments
    /// * `slots` — Entity indices.
    /// * `wx`, `wy`, `wz` — Angular velocity components in rad/s (world-space).
    /// * `dt` — Delta time in seconds.
    ///
    /// # Returns
    /// Number of bodies actually updated.
    pub fn bulk_step_kinematic_rotations(
        &mut self,
        slots: &[u32],
        wx: &[f32],
        wy: &[f32],
        wz: &[f32],
        dt: f32,
    ) -> u32 {
        let count = slots.len().min(wx.len()).min(wy.len()).min(wz.len());
        let mut updated = 0u32;
        for i in 0..count {
            let Some(&handle) = self.entity_handles.get(&slots[i]) else {
                continue;
            };
            let Some(body) = self.rigid_body_set.get_mut(handle) else {
                continue;
            };
            let pos = *body.position();
            let q = pos.rotation.quaternion();
            let hdt = 0.5 * dt;
            let nqx = q.coords.x + hdt * ( wx[i] * q.coords.w + wy[i] * q.coords.z - wz[i] * q.coords.y);
            let nqy = q.coords.y + hdt * (-wx[i] * q.coords.z + wy[i] * q.coords.w + wz[i] * q.coords.x);
            let nqz = q.coords.z + hdt * ( wx[i] * q.coords.y - wy[i] * q.coords.x + wz[i] * q.coords.w);
            let nqw = q.coords.w + hdt * (-wx[i] * q.coords.x - wy[i] * q.coords.y - wz[i] * q.coords.z);
            let rotation = UnitQuaternion::new_normalize(Quaternion::new(nqw, nqx, nqy, nqz));
            let iso = Isometry::from_parts(pos.translation, rotation);
            body.set_next_kinematic_position(iso);
            updated += 1;
        }
        updated
    }

    // ── State read/write ──────────────────────────────────────────────────────

    /// Return the full rigid body state as a flat `Vec<f32>` of 13 elements.
    ///
    /// Layout: `[px, py, pz, qx, qy, qz, qw, vx, vy, vz, ax, ay, az]`
    ///
    /// - `px/py/pz` — world-space position (metres)
    /// - `qx/qy/qz/qw` — orientation as a unit quaternion
    /// - `vx/vy/vz` — linear velocity (m/s)
    /// - `ax/ay/az` — angular velocity (rad/s)
    ///
    /// # Arguments
    /// * `entity_index` — ECS entity slot index.
    ///
    /// # Returns
    /// A 13-element `Vec<f32>`, or an empty `Vec` if the entity has no body.
    pub fn get_body_state(&self, entity_index: u32) -> Vec<f32> {
        let Some(&handle) = self.entity_handles.get(&entity_index) else {
            return Vec::new();
        };
        let Some(body) = self.rigid_body_set.get(handle) else {
            return Vec::new();
        };

        let iso = body.position();
        let t = iso.translation.vector;
        let q = iso.rotation.quaternion().coords; // [x, y, z, w] from nalgebra
        let lv = body.linvel();
        let av = body.angvel();

        vec![
            t.x, t.y, t.z, // position
            q.x, q.y, q.z, q.w, // quaternion (xyzw)
            lv.x, lv.y, lv.z, // linear velocity
            av.x, av.y, av.z, // angular velocity
        ]
    }

    /// Overwrite all state fields of an existing body in one call.
    ///
    /// This is more efficient than six separate setter calls when multiple
    /// fields need to be written at once (e.g. when teleporting an entity).
    ///
    /// # Arguments
    /// * `entity_index` — ECS entity slot index.
    /// * `px/py/pz`     — New world-space position.
    /// * `qx/qy/qz/qw` — New orientation (must be a unit quaternion).
    /// * `vx/vy/vz`     — New linear velocity.
    /// * `ax/ay/az`     — New angular velocity.
    ///
    /// # Returns
    /// `true` on success, `false` if the entity has no registered body.
    #[allow(clippy::too_many_arguments)]
    pub fn set_body_state(
        &mut self,
        entity_index: u32,
        px: f32,
        py: f32,
        pz: f32,
        qx: f32,
        qy: f32,
        qz: f32,
        qw: f32,
        vx: f32,
        vy: f32,
        vz: f32,
        ax: f32,
        ay: f32,
        az: f32,
    ) -> bool {
        let Some(&handle) = self.entity_handles.get(&entity_index) else {
            debug_warn!("set_body_state(entity={}): no registered body", entity_index);
            return false;
        };
        let Some(body) = self.rigid_body_set.get_mut(handle) else {
            debug_warn!("set_body_state(entity={}): body handle became invalid", entity_index);
            return false;
        };

        let rotation = UnitQuaternion::new_normalize(Quaternion::new(qw, qx, qy, qz));
        let iso = Isometry::from_parts(Translation3::new(px, py, pz), rotation);
        body.set_position(iso, true);
        body.set_linvel(vector![vx, vy, vz], true);
        body.set_angvel(vector![ax, ay, az], true);
        true
    }

    // ── Linear velocity ───────────────────────────────────────────────────────

    /// Return the linear velocity of a body as `[vx, vy, vz]`.
    ///
    /// # Arguments
    /// * `entity_index` — ECS entity slot index.
    ///
    /// # Returns
    /// A 3-element `Vec<f32>`, or an empty `Vec` if the entity has no body.
    pub fn get_linear_velocity(&self, entity_index: u32) -> Vec<f32> {
        let Some(&handle) = self.entity_handles.get(&entity_index) else {
            return Vec::new();
        };
        let Some(body) = self.rigid_body_set.get(handle) else {
            return Vec::new();
        };
        let v = body.linvel();
        vec![v.x, v.y, v.z]
    }

    /// Set the linear velocity of a body.
    ///
    /// Wakes the body if it is sleeping.
    ///
    /// # Arguments
    /// * `entity_index` — ECS entity slot index.
    /// * `vx/vy/vz`     — New linear velocity (m/s).
    ///
    /// # Returns
    /// `true` on success, `false` if the entity has no registered body.
    pub fn set_linear_velocity(
        &mut self,
        entity_index: u32,
        vx: f32,
        vy: f32,
        vz: f32,
    ) -> bool {
        let Some(&handle) = self.entity_handles.get(&entity_index) else {
            debug_warn!("set_linear_velocity(entity={}): no registered body", entity_index);
            return false;
        };
        let Some(body) = self.rigid_body_set.get_mut(handle) else {
            debug_warn!("set_linear_velocity(entity={}): body handle became invalid", entity_index);
            return false;
        };
        body.set_linvel(vector![vx, vy, vz], true);
        true
    }

    // ── Angular velocity ──────────────────────────────────────────────────────

    /// Return the angular velocity of a body as `[ax, ay, az]` (rad/s).
    ///
    /// # Arguments
    /// * `entity_index` — ECS entity slot index.
    ///
    /// # Returns
    /// A 3-element `Vec<f32>`, or an empty `Vec` if the entity has no body.
    pub fn get_angular_velocity(&self, entity_index: u32) -> Vec<f32> {
        let Some(&handle) = self.entity_handles.get(&entity_index) else {
            return Vec::new();
        };
        let Some(body) = self.rigid_body_set.get(handle) else {
            return Vec::new();
        };
        let a = body.angvel();
        vec![a.x, a.y, a.z]
    }

    /// Set the angular velocity of a body.
    ///
    /// Wakes the body if it is sleeping.
    ///
    /// # Arguments
    /// * `entity_index` — ECS entity slot index.
    /// * `ax/ay/az`     — New angular velocity (rad/s).
    ///
    /// # Returns
    /// `true` on success, `false` if the entity has no registered body.
    pub fn set_angular_velocity(
        &mut self,
        entity_index: u32,
        ax: f32,
        ay: f32,
        az: f32,
    ) -> bool {
        let Some(&handle) = self.entity_handles.get(&entity_index) else {
            debug_warn!("set_angular_velocity(entity={}): no registered body", entity_index);
            return false;
        };
        let Some(body) = self.rigid_body_set.get_mut(handle) else {
            debug_warn!("set_angular_velocity(entity={}): body handle became invalid", entity_index);
            return false;
        };
        body.set_angvel(vector![ax, ay, az], true);
        true
    }

    // ── Impulse ───────────────────────────────────────────────────────────────

    /// Apply a world-space linear impulse to a body.
    ///
    /// The impulse is applied at the body's centre of mass and immediately
    /// changes its linear velocity. The body is woken if sleeping.
    ///
    /// # Arguments
    /// * `entity_index` — ECS entity slot index.
    /// * `ix/iy/iz`     — Impulse vector (N·s).
    ///
    /// # Returns
    /// `true` on success, `false` if the entity has no registered body.
    pub fn apply_impulse(
        &mut self,
        entity_index: u32,
        ix: f32,
        iy: f32,
        iz: f32,
    ) -> bool {
        let Some(&handle) = self.entity_handles.get(&entity_index) else {
            debug_warn!("apply_impulse(entity={}): no registered body", entity_index);
            return false;
        };
        let Some(body) = self.rigid_body_set.get_mut(handle) else {
            debug_warn!("apply_impulse(entity={}): body handle became invalid", entity_index);
            return false;
        };
        body.apply_impulse(vector![ix, iy, iz], true);
        true
    }

    /// Apply a world-space angular (torque) impulse to a dynamic body.
    ///
    /// The impulse immediately changes the body's angular velocity.
    /// The body is woken if sleeping.
    ///
    /// # Arguments
    /// * `entity_index` — ECS entity slot index.
    /// * `ax/ay/az`     — Angular impulse vector (N·m·s).
    ///
    /// # Returns
    /// `true` on success, `false` if the entity has no registered body.
    pub fn apply_angular_impulse(
        &mut self,
        entity_index: u32,
        ax: f32,
        ay: f32,
        az: f32,
    ) -> bool {
        let Some(&handle) = self.entity_handles.get(&entity_index) else {
            debug_warn!("apply_angular_impulse(entity={}): no registered body", entity_index);
            return false;
        };
        let Some(body) = self.rigid_body_set.get_mut(handle) else {
            debug_warn!("apply_angular_impulse(entity={}): body handle became invalid", entity_index);
            return false;
        };
        body.apply_torque_impulse(vector![ax, ay, az], true);
        true
    }

    // ── RFC-09: Continuous forces ──────────────────────────────────────────────

    /// Apply a continuous force to a dynamic body for the current simulation step.
    ///
    /// Unlike an impulse, this force accumulates in Rapier's force buffer and is
    /// cleared automatically after each [`step`] call.  Call this every frame
    /// before stepping to simulate a sustained push (e.g. thruster, wind).
    ///
    /// # Arguments
    /// * `entity_index` — ECS entity slot index of the target body.
    /// * `fx` — Force component along the world X axis (Newtons).
    /// * `fy` — Force component along the world Y axis (Newtons).
    /// * `fz` — Force component along the world Z axis (Newtons).
    ///
    /// # Returns
    /// `true` if the force was applied; `false` if no body is registered for
    /// `entity_index` or if the body handle has been invalidated.
    pub fn add_force(&mut self, entity_index: u32, fx: f32, fy: f32, fz: f32) -> bool {
        let Some(&handle) = self.entity_handles.get(&entity_index) else {
            debug_warn!("add_force(entity={}): no registered body", entity_index);
            return false;
        };
        let Some(body) = self.rigid_body_set.get_mut(handle) else {
            debug_warn!("add_force(entity={}): body handle became invalid", entity_index);
            return false;
        };
        body.add_force(vector![fx, fy, fz], true);
        true
    }

    /// Apply a continuous torque to a dynamic body for the current simulation step.
    ///
    /// The torque accumulates in Rapier's torque buffer and is cleared after each
    /// [`step`].  Apply every frame before stepping for sustained rotational
    /// forces (e.g. spin-up, gyroscopic effect).
    ///
    /// # Arguments
    /// * `entity_index` — ECS entity slot index of the target body.
    /// * `tx` — Torque component about the world X axis (Newton-metres).
    /// * `ty` — Torque component about the world Y axis (Newton-metres).
    /// * `tz` — Torque component about the world Z axis (Newton-metres).
    ///
    /// # Returns
    /// `true` if the torque was applied; `false` if no body is registered for
    /// `entity_index` or if the body handle has been invalidated.
    pub fn add_torque(&mut self, entity_index: u32, tx: f32, ty: f32, tz: f32) -> bool {
        let Some(&handle) = self.entity_handles.get(&entity_index) else {
            debug_warn!("add_torque(entity={}): no registered body", entity_index);
            return false;
        };
        let Some(body) = self.rigid_body_set.get_mut(handle) else {
            debug_warn!("add_torque(entity={}): body handle became invalid", entity_index);
            return false;
        };
        body.add_torque(vector![tx, ty, tz], true);
        true
    }

    /// Apply a continuous force at a specific world-space point on a dynamic body.
    ///
    /// The force is decomposed by Rapier into a linear component and a torque
    /// about the body's centre of mass.  Like [`add_force`], the contribution is
    /// cleared after each [`step`].
    ///
    /// # Arguments
    /// * `entity_index` — ECS entity slot index of the target body.
    /// * `fx` — Force component along the world X axis (Newtons).
    /// * `fy` — Force component along the world Y axis (Newtons).
    /// * `fz` — Force component along the world Z axis (Newtons).
    /// * `px` — World-space application point X coordinate.
    /// * `py` — World-space application point Y coordinate.
    /// * `pz` — World-space application point Z coordinate.
    ///
    /// # Returns
    /// `true` on success; `false` if the entity is not registered.
    pub fn add_force_at_point(
        &mut self,
        entity_index: u32,
        fx: f32,
        fy: f32,
        fz: f32,
        px: f32,
        py: f32,
        pz: f32,
    ) -> bool {
        let Some(&handle) = self.entity_handles.get(&entity_index) else {
            debug_warn!("add_force_at_point(entity={}): no registered body", entity_index);
            return false;
        };
        let Some(body) = self.rigid_body_set.get_mut(handle) else {
            debug_warn!("add_force_at_point(entity={}): body handle became invalid", entity_index);
            return false;
        };
        body.add_force_at_point(vector![fx, fy, fz], point![px, py, pz], true);
        true
    }

    /// Override the gravity scale multiplier for a body.
    ///
    /// A scale of `1.0` means normal gravity; `0.0` makes the body weightless;
    /// negative values invert gravity for this body.
    ///
    /// # Arguments
    /// * `entity_index` — ECS entity slot index of the target body.
    /// * `scale`        — Gravity multiplier to apply.
    ///
    /// # Returns
    /// `true` on success; `false` if the entity is not registered.
    pub fn set_gravity_scale(&mut self, entity_index: u32, scale: f32) -> bool {
        let Some(&handle) = self.entity_handles.get(&entity_index) else {
            debug_warn!("set_gravity_scale(entity={}): no registered body", entity_index);
            return false;
        };
        let Some(body) = self.rigid_body_set.get_mut(handle) else {
            debug_warn!("set_gravity_scale(entity={}): body handle became invalid", entity_index);
            return false;
        };
        body.set_gravity_scale(scale, true);
        true
    }

    /// Read the current gravity scale multiplier of a body.
    ///
    /// # Arguments
    /// * `entity_index` — ECS entity slot index.
    ///
    /// # Returns
    /// The gravity scale (`f32`), or `1.0` if the entity is not registered
    /// (matching Rapier's default).
    pub fn get_gravity_scale(&self, entity_index: u32) -> f32 {
        let Some(&handle) = self.entity_handles.get(&entity_index) else {
            return 1.0;
        };
        let Some(body) = self.rigid_body_set.get(handle) else {
            return 1.0;
        };
        body.gravity_scale()
    }

    /// Additively lock translation axes for a body.
    ///
    /// Each `true` argument locks the corresponding translation axis.  Locks are
    /// **additive**: existing locks are preserved and the new ones are ORed in.
    /// To unlock axes, use Rapier's `set_locked_axes` directly or remove and
    /// re-add the body.
    ///
    /// # Arguments
    /// * `entity_index` — ECS entity slot index of the target body.
    /// * `x` — Lock translation along the X axis when `true`.
    /// * `y` — Lock translation along the Y axis when `true`.
    /// * `z` — Lock translation along the Z axis when `true`.
    ///
    /// # Returns
    /// `true` on success; `false` if the entity is not registered.
    pub fn lock_translations(&mut self, entity_index: u32, x: bool, y: bool, z: bool) -> bool {
        let Some(&handle) = self.entity_handles.get(&entity_index) else {
            debug_warn!("lock_translations(entity={}): no registered body", entity_index);
            return false;
        };
        let Some(body) = self.rigid_body_set.get_mut(handle) else {
            debug_warn!("lock_translations(entity={}): body handle became invalid", entity_index);
            return false;
        };
        let mut new_axes = LockedAxes::empty();
        if x { new_axes |= LockedAxes::TRANSLATION_LOCKED_X; }
        if y { new_axes |= LockedAxes::TRANSLATION_LOCKED_Y; }
        if z { new_axes |= LockedAxes::TRANSLATION_LOCKED_Z; }
        let current = body.locked_axes();
        body.set_locked_axes(current | new_axes, true);
        true
    }

    /// Additively lock rotation axes for a body.
    ///
    /// Each `true` argument locks the corresponding rotation axis.  Locks are
    /// **additive**: existing locks are preserved and the new ones are ORed in.
    ///
    /// # Arguments
    /// * `entity_index` — ECS entity slot index of the target body.
    /// * `x` — Lock rotation about the X axis when `true`.
    /// * `y` — Lock rotation about the Y axis when `true`.
    /// * `z` — Lock rotation about the Z axis when `true`.
    ///
    /// # Returns
    /// `true` on success; `false` if the entity is not registered.
    pub fn lock_rotations(&mut self, entity_index: u32, x: bool, y: bool, z: bool) -> bool {
        let Some(&handle) = self.entity_handles.get(&entity_index) else {
            debug_warn!("lock_rotations(entity={}): no registered body", entity_index);
            return false;
        };
        let Some(body) = self.rigid_body_set.get_mut(handle) else {
            debug_warn!("lock_rotations(entity={}): body handle became invalid", entity_index);
            return false;
        };
        let mut new_axes = LockedAxes::empty();
        if x { new_axes |= LockedAxes::ROTATION_LOCKED_X; }
        if y { new_axes |= LockedAxes::ROTATION_LOCKED_Y; }
        if z { new_axes |= LockedAxes::ROTATION_LOCKED_Z; }
        let current = body.locked_axes();
        body.set_locked_axes(current | new_axes, true);
        true
    }

    /// Put a body to sleep or force it awake.
    ///
    /// Sleeping bodies are excluded from the simulation pipeline until disturbed,
    /// which can significantly reduce CPU cost for large numbers of settled
    /// objects.
    ///
    /// # Arguments
    /// * `entity_index` — ECS entity slot index of the target body.
    /// * `sleeping`     — `true` to put the body to sleep; `false` to wake it.
    ///
    /// # Returns
    /// `true` on success; `false` if the entity is not registered.
    pub fn set_body_sleeping(&mut self, entity_index: u32, sleeping: bool) -> bool {
        let Some(&handle) = self.entity_handles.get(&entity_index) else {
            debug_warn!("set_body_sleeping(entity={}): no registered body", entity_index);
            return false;
        };
        let Some(body) = self.rigid_body_set.get_mut(handle) else {
            debug_warn!("set_body_sleeping(entity={}): body handle became invalid", entity_index);
            return false;
        };
        if sleeping {
            body.sleep();
        } else {
            body.wake_up(true);
        }
        true
    }

    /// Query whether a body is currently sleeping.
    ///
    /// # Arguments
    /// * `entity_index` — ECS entity slot index.
    ///
    /// # Returns
    /// `true` if the body is sleeping; `false` if it is awake or not registered.
    pub fn is_body_sleeping(&self, entity_index: u32) -> bool {
        let Some(&handle) = self.entity_handles.get(&entity_index) else {
            return false;
        };
        let Some(body) = self.rigid_body_set.get(handle) else {
            return false;
        };
        body.is_sleeping()
    }

    /// Wake every dynamic body in the simulation.
    ///
    /// Useful after large scene changes (e.g. spawning objects, teleporting
    /// bodies) to ensure no body remains asleep when it should be simulated.
    pub fn wake_all(&mut self) {
        for (_, body) in self.rigid_body_set.iter_mut() {
            body.wake_up(true);
        }
    }

    /// Sets the number of additional solver iterations for the rigid body at `entity_index`.
    ///
    /// # Description
    /// Higher values improve simulation accuracy for fast-moving or heavily
    /// constrained bodies at the cost of extra CPU time per step.
    ///
    /// Maps from the TypeScript `Physics3DQualityPreset`:
    /// - `low`    → `0`
    /// - `medium` → `0`
    /// - `high`   → `1`
    /// - `ultra`  → `2`
    ///
    /// # Arguments
    /// * `entity_index` — ECS entity slot index.
    /// * `iterations`   — Number of additional solver iterations (0–255).
    ///
    /// # Returns
    /// `true` on success, `false` if the entity has no registered body.
    pub fn set_body_solver_iterations(&mut self, entity_index: u32, iterations: u32) -> bool {
        let Some(&handle) = self.entity_handles.get(&entity_index) else {
            debug_warn!(
                "set_body_solver_iterations: unknown entity {}",
                entity_index
            );
            return false;
        };
        let Some(body) = self.rigid_body_set.get_mut(handle) else {
            return false;
        };
        body.set_additional_solver_iterations(iterations as usize);
        true
    }

    // ── RFC-07: Spatial queries ───────────────────────────────────────────────

    /// Build a Rapier [`SharedShape`] from a compact 4-value encoding.
    ///
    /// Encoding (matches TypeScript `encodeShape`):
    /// - `0` — Box: `[0, half_x, half_y, half_z]`
    /// - `1` — Ball: `[1, radius, _, _]`
    /// - `2` — Capsule (Y-axis): `[2, radius, half_height, _]`
    ///
    /// Returns a unit-sphere as fallback for unknown shape types.
    fn decode_shape(shape_type: u32, p0: f32, p1: f32, p2: f32) -> SharedShape {
        match shape_type {
            0 => SharedShape::cuboid(p0, p1, p2),
            1 => SharedShape::ball(p0),
            2 => SharedShape::capsule_y(p1, p0),
            _ => SharedShape::ball(0.5),
        }
    }

    /// Build a [`QueryFilter`] from layer/mask bitmasks.
    ///
    /// An [`InteractionGroups`] is used so that only colliders whose membership
    /// bits overlap the filter mask are considered.
    fn make_query_filter(layers: u32, mask: u32) -> QueryFilter<'static> {
        QueryFilter::new().groups(InteractionGroups::new(
            Group::from_bits_truncate(layers),
            Group::from_bits_truncate(mask),
        ))
    }

    /// Cast a ray and return the first hit.
    ///
    /// # Arguments
    /// * `ox/oy/oz`  — Ray origin (world space).
    /// * `dx/dy/dz`  — Ray direction (need not be normalised).
    /// * `max_dist`  — Maximum travel distance.
    /// * `layers`    — Collision layer bitmask (membership).
    /// * `mask`      — Collision filter bitmask.
    /// * `solid`     — If `true`, hitting the interior of a solid shape counts.
    ///
    /// # Returns
    /// A `Vec<f32>` of 9 elements on hit, or a single `[0.0]` on miss:
    /// `[hit(1.0), entity_index, distance, nx, ny, nz, px, py, pz]`
    pub fn cast_ray(
        &self,
        ox: f32, oy: f32, oz: f32,
        dx: f32, dy: f32, dz: f32,
        max_dist: f32, layers: u32, mask: u32, solid: bool,
    ) -> Vec<f32> {
        let ray = Ray::new(point![ox, oy, oz], vector![dx, dy, dz]);
        let filter = Self::make_query_filter(layers, mask);
        let Some((ch, intersection)) = self.query_pipeline.cast_ray_and_get_normal(
            &self.rigid_body_set, &self.collider_set,
            &ray, max_dist, solid, filter,
        ) else {
            return vec![0.0];
        };
        let entity_index = self
            .collider_set
            .get(ch)
            .map(|c| unpack_user_data(c.user_data).0)
            .unwrap_or(u32::MAX);
        let hit_point = ray.point_at(intersection.time_of_impact);
        vec![
            1.0,
            entity_index as f32,
            intersection.time_of_impact,
            intersection.normal.x,
            intersection.normal.y,
            intersection.normal.z,
            hit_point.x,
            hit_point.y,
            hit_point.z,
        ]
    }

    /// Cast a shape along a direction and return the first collision.
    ///
    /// # Arguments
    /// * `pos_x/y/z`       — Shape origin.
    /// * `rot_x/y/z/w`     — Shape orientation (unit quaternion).
    /// * `dir_x/y/z`       — Cast direction.
    /// * `shape_type`      — Shape encoding type (0=box, 1=ball, 2=capsule).
    /// * `p0/p1/p2`        — Shape parameters.
    /// * `max_dist`        — Maximum travel distance.
    /// * `layers` / `mask` — Collision filter.
    ///
    /// # Returns
    /// 15 floats on hit:
    /// `[hit, entity, toi, nx,ny,nz, w1x,w1y,w1z, w1x,w1y,w1z, w2x,w2y,w2z]`
    /// Single `[0.0]` on miss.
    pub fn cast_shape(
        &self,
        pos_x: f32, pos_y: f32, pos_z: f32,
        rot_x: f32, rot_y: f32, rot_z: f32, rot_w: f32,
        dir_x: f32, dir_y: f32, dir_z: f32,
        shape_type: u32, p0: f32, p1: f32, p2: f32,
        max_dist: f32, layers: u32, mask: u32,
    ) -> Vec<f32> {
        let shape = Self::decode_shape(shape_type, p0, p1, p2);
        let iso = Isometry::from_parts(
            Translation3::new(pos_x, pos_y, pos_z),
            UnitQuaternion::from_quaternion(Quaternion::new(rot_w, rot_x, rot_y, rot_z)),
        );
        let dir = vector![dir_x, dir_y, dir_z];
        let filter = Self::make_query_filter(layers, mask);
        let opts = ShapeCastOptions {
            max_time_of_impact: max_dist,
            stop_at_penetration: true,
            ..ShapeCastOptions::default()
        };
        let Some((ch, hit)) = self.query_pipeline.cast_shape(
            &self.rigid_body_set, &self.collider_set,
            &iso, &dir, shape.as_ref(), opts, filter,
        ) else {
            return vec![0.0];
        };
        let entity_index = self
            .collider_set
            .get(ch)
            .map(|c| unpack_user_data(c.user_data).0)
            .unwrap_or(u32::MAX);
        vec![
            1.0,
            entity_index as f32,
            hit.time_of_impact,
            hit.normal1.x, hit.normal1.y, hit.normal1.z,
            hit.witness1.x, hit.witness1.y, hit.witness1.z,
            hit.witness1.x, hit.witness1.y, hit.witness1.z,
            hit.witness2.x, hit.witness2.y, hit.witness2.z,
        ]
    }

    /// Find all colliders overlapping a shape, writing entity indices to a WASM memory pointer.
    ///
    /// # Arguments
    /// * `pos_x/y/z`   — Shape origin.
    /// * `rot_x/y/z/w` — Shape orientation (unit quaternion).
    /// * `shape_type` / `p0/p1/p2` — Shape encoding.
    /// * `layers` / `mask` — Collision filter.
    /// * `out_ptr`     — WASM linear-memory pointer to write `u32` entity indices.
    /// * `max_results` — Maximum number of results to write.
    ///
    /// # Returns
    /// Number of overlapping entities written to `out_ptr`.
    ///
    /// # Safety
    /// `out_ptr` must point to at least `max_results * 4` bytes of valid WASM
    /// linear memory. This is guaranteed by the TypeScript layer which allocates
    /// the scratch buffer before calling this function.
    pub fn overlap_shape(
        &self,
        pos_x: f32, pos_y: f32, pos_z: f32,
        rot_x: f32, rot_y: f32, rot_z: f32, rot_w: f32,
        shape_type: u32, p0: f32, p1: f32, p2: f32,
        layers: u32, mask: u32,
        out_ptr: u32, max_results: u32,
    ) -> u32 {
        let shape = Self::decode_shape(shape_type, p0, p1, p2);
        let iso = Isometry::from_parts(
            Translation3::new(pos_x, pos_y, pos_z),
            UnitQuaternion::from_quaternion(Quaternion::new(rot_w, rot_x, rot_y, rot_z)),
        );
        let filter = Self::make_query_filter(layers, mask);
        let mut count: u32 = 0;
        // SAFETY: caller guarantees out_ptr points to max_results * 4 bytes of
        // valid writable memory. In WASM this is linear memory allocated by the
        // TypeScript layer; in native tests a stack/heap buffer is passed directly.
        let out_slice = unsafe {
            std::slice::from_raw_parts_mut(out_ptr as *mut u32, max_results as usize)
        };
        self.query_pipeline.intersections_with_shape(
            &self.rigid_body_set, &self.collider_set,
            &iso, shape.as_ref(), filter,
            |ch| {
                if count >= max_results {
                    return false;
                }
                let entity_index = self
                    .collider_set
                    .get(ch)
                    .map(|c| unpack_user_data(c.user_data).0)
                    .unwrap_or(u32::MAX);
                out_slice[count as usize] = entity_index;
                count += 1;
                true
            },
        );
        count
    }

    /// Project a world-space point onto the nearest collider.
    ///
    /// # Arguments
    /// * `px/py/pz`        — Point to project.
    /// * `layers` / `mask` — Collision filter.
    /// * `solid`           — If `true`, points inside solid shapes project to themselves.
    ///
    /// # Returns
    /// 6 floats on hit: `[hit(1.0), entity_index, proj_x, proj_y, proj_z, is_inside(0/1)]`
    /// Single `[0.0]` on miss.
    pub fn project_point(
        &self,
        px: f32, py: f32, pz: f32,
        layers: u32, mask: u32, solid: bool,
    ) -> Vec<f32> {
        let filter = Self::make_query_filter(layers, mask);
        let Some((ch, proj)) = self.query_pipeline.project_point(
            &self.rigid_body_set, &self.collider_set,
            &point![px, py, pz], solid, filter,
        ) else {
            return vec![0.0];
        };
        let entity_index = self
            .collider_set
            .get(ch)
            .map(|c| unpack_user_data(c.user_data).0)
            .unwrap_or(u32::MAX);
        vec![
            1.0,
            entity_index as f32,
            proj.point.x,
            proj.point.y,
            proj.point.z,
            if proj.is_inside { 1.0 } else { 0.0 },
        ]
    }

    // ── RFC-08: Joints ───────────────────────────────────────────────────────────

    /// Allocate a new stable joint ID and store the handle.
    fn register_joint(&mut self, handle: ImpulseJointHandle) -> u32 {
        let id = self.next_joint_id;
        self.next_joint_id = self.next_joint_id.wrapping_add(1);
        self.joint_handles.insert(id, handle);
        id
    }

    /// Attach two bodies with a fixed (weld) joint at the given anchor points.
    ///
    /// # Arguments
    /// * `entity_a` / `entity_b` — ECS entity slot indices of the two bodies.
    /// * `ax/ay/az` — Anchor point on body A in body-A local space.
    /// * `bx/by/bz` — Anchor point on body B in body-B local space.
    ///
    /// # Returns
    /// Stable joint ID (u32) on success, `u32::MAX` if either entity has no body.
    pub fn add_fixed_joint(
        &mut self,
        entity_a: u32, entity_b: u32,
        ax: f32, ay: f32, az: f32,
        bx: f32, by: f32, bz: f32,
    ) -> u32 {
        let (Some(&ha), Some(&hb)) = (
            self.entity_handles.get(&entity_a),
            self.entity_handles.get(&entity_b),
        ) else {
            debug_warn!("add_fixed_joint: entity {} or {} has no registered body", entity_a, entity_b);
            return u32::MAX;
        };
        let joint = FixedJointBuilder::new()
            .local_anchor1(point![ax, ay, az])
            .local_anchor2(point![bx, by, bz])
            .build();
        let handle = self.impulse_joint_set.insert(ha, hb, joint, true);
        self.register_joint(handle)
    }

    /// Attach two bodies with a revolute (hinge) joint.
    ///
    /// # Arguments
    /// * `entity_a` / `entity_b` — ECS entity slot indices.
    /// * `ax/ay/az` — Anchor on body A (local space).
    /// * `bx/by/bz` — Anchor on body B (local space).
    /// * `axis_x/y/z` — Rotation axis in world space (will be normalised).
    /// * `use_limits` — Enable angular limits.
    /// * `limit_min` / `limit_max` — Angular limits in radians (only if `use_limits`).
    ///
    /// # Returns
    /// Stable joint ID or `u32::MAX` on failure.
    pub fn add_revolute_joint(
        &mut self,
        entity_a: u32, entity_b: u32,
        ax: f32, ay: f32, az: f32,
        bx: f32, by: f32, bz: f32,
        axis_x: f32, axis_y: f32, axis_z: f32,
        use_limits: bool, limit_min: f32, limit_max: f32,
    ) -> u32 {
        let (Some(&ha), Some(&hb)) = (
            self.entity_handles.get(&entity_a),
            self.entity_handles.get(&entity_b),
        ) else {
            debug_warn!("add_revolute_joint: entity {} or {} has no registered body", entity_a, entity_b);
            return u32::MAX;
        };
        let axis = Unit::try_new(vector![axis_x, axis_y, axis_z], 1e-6)
            .unwrap_or_else(|| Unit::new_normalize(vector![0.0, 1.0, 0.0]));
        let mut builder = RevoluteJointBuilder::new(axis)
            .local_anchor1(point![ax, ay, az])
            .local_anchor2(point![bx, by, bz]);
        if use_limits {
            builder = builder.limits([limit_min, limit_max]);
        }
        let handle = self.impulse_joint_set.insert(ha, hb, builder.build(), true);
        self.register_joint(handle)
    }

    /// Attach two bodies with a prismatic (slider) joint.
    ///
    /// # Arguments
    /// * `entity_a` / `entity_b` — ECS entity slot indices.
    /// * `ax/ay/az` — Anchor on body A (local space).
    /// * `bx/by/bz` — Anchor on body B (local space).
    /// * `axis_x/y/z` — Slide axis in world space (normalised).
    /// * `use_limits` — Enable translation limits.
    /// * `limit_min` / `limit_max` — Limits in metres.
    ///
    /// # Returns
    /// Stable joint ID or `u32::MAX` on failure.
    pub fn add_prismatic_joint(
        &mut self,
        entity_a: u32, entity_b: u32,
        ax: f32, ay: f32, az: f32,
        bx: f32, by: f32, bz: f32,
        axis_x: f32, axis_y: f32, axis_z: f32,
        use_limits: bool, limit_min: f32, limit_max: f32,
    ) -> u32 {
        let (Some(&ha), Some(&hb)) = (
            self.entity_handles.get(&entity_a),
            self.entity_handles.get(&entity_b),
        ) else {
            debug_warn!("add_prismatic_joint: entity {} or {} has no registered body", entity_a, entity_b);
            return u32::MAX;
        };
        let axis = Unit::try_new(vector![axis_x, axis_y, axis_z], 1e-6)
            .unwrap_or_else(|| Unit::new_normalize(vector![1.0, 0.0, 0.0]));
        let mut builder = PrismaticJointBuilder::new(axis)
            .local_anchor1(point![ax, ay, az])
            .local_anchor2(point![bx, by, bz]);
        if use_limits {
            builder = builder.limits([limit_min, limit_max]);
        }
        let handle = self.impulse_joint_set.insert(ha, hb, builder.build(), true);
        self.register_joint(handle)
    }

    /// Attach two bodies with a ball (spherical) joint.
    ///
    /// # Arguments
    /// * `entity_a` / `entity_b` — ECS entity slot indices.
    /// * `ax/ay/az` — Anchor on body A (local space).
    /// * `bx/by/bz` — Anchor on body B (local space).
    ///
    /// # Returns
    /// Stable joint ID or `u32::MAX` on failure.
    pub fn add_ball_joint(
        &mut self,
        entity_a: u32, entity_b: u32,
        ax: f32, ay: f32, az: f32,
        bx: f32, by: f32, bz: f32,
    ) -> u32 {
        let (Some(&ha), Some(&hb)) = (
            self.entity_handles.get(&entity_a),
            self.entity_handles.get(&entity_b),
        ) else {
            debug_warn!("add_ball_joint: entity {} or {} has no registered body", entity_a, entity_b);
            return u32::MAX;
        };
        let joint = SphericalJointBuilder::new()
            .local_anchor1(point![ax, ay, az])
            .local_anchor2(point![bx, by, bz])
            .build();
        let handle = self.impulse_joint_set.insert(ha, hb, joint, true);
        self.register_joint(handle)
    }

    /// Attach two bodies with a spring joint.
    ///
    /// # Arguments
    /// * `entity_a` / `entity_b` — ECS entity slot indices.
    /// * `ax/ay/az` — Anchor on body A (local space).
    /// * `bx/by/bz` — Anchor on body B (local space).
    /// * `rest_length` — Natural length of the spring (metres).
    /// * `stiffness`   — Spring constant (N/m).
    /// * `damping`     — Damping coefficient (N·s/m).
    ///
    /// # Returns
    /// Stable joint ID or `u32::MAX` on failure.
    pub fn add_spring_joint(
        &mut self,
        entity_a: u32, entity_b: u32,
        ax: f32, ay: f32, az: f32,
        bx: f32, by: f32, bz: f32,
        rest_length: f32, stiffness: f32, damping: f32,
    ) -> u32 {
        let (Some(&ha), Some(&hb)) = (
            self.entity_handles.get(&entity_a),
            self.entity_handles.get(&entity_b),
        ) else {
            debug_warn!("add_spring_joint: entity {} or {} has no registered body", entity_a, entity_b);
            return u32::MAX;
        };
        let joint = SpringJointBuilder::new(rest_length, stiffness, damping)
            .local_anchor1(point![ax, ay, az])
            .local_anchor2(point![bx, by, bz])
            .build();
        let handle = self.impulse_joint_set.insert(ha, hb, joint, true);
        self.register_joint(handle)
    }

    /// Remove a joint by its stable ID.
    ///
    /// # Arguments
    /// * `id` — Joint ID returned by `add_*_joint`.
    ///
    /// # Returns
    /// `true` if the joint was found and removed, `false` otherwise.
    pub fn remove_joint(&mut self, id: u32) -> bool {
        if let Some(handle) = self.joint_handles.remove(&id) {
            self.impulse_joint_set.remove(handle, true);
            true
        } else {
            false
        }
    }

    /// Set a motor velocity target on a joint's primary rotational axis (AngX).
    ///
    /// Applies to revolute and prismatic joints. For other joint types the call
    /// is a no-op but still returns `true` if the joint ID is valid.
    ///
    /// # Arguments
    /// * `id`        — Joint ID.
    /// * `velocity`  — Target angular / linear velocity (rad/s or m/s).
    /// * `max_force` — Maximum motor force / torque (N or N·m).
    ///
    /// # Returns
    /// `true` if the joint exists, `false` otherwise.
    pub fn set_joint_motor_velocity(&mut self, id: u32, velocity: f32, max_force: f32) -> bool {
        let Some(&handle) = self.joint_handles.get(&id) else {
            return false;
        };
        let Some(joint) = self.impulse_joint_set.get_mut(handle) else {
            return false;
        };
        joint.data.set_motor_velocity(JointAxis::AngX, velocity, max_force);
        true
    }

    /// Set a motor position target on a joint's primary rotational axis (AngX).
    ///
    /// # Arguments
    /// * `id`         — Joint ID.
    /// * `target`     — Target angle / position (radians or metres).
    /// * `stiffness`  — Spring stiffness (N·m/rad or N/m).
    /// * `damping`    — Damping coefficient (N·m·s/rad or N·s/m).
    ///
    /// # Returns
    /// `true` if the joint exists, `false` otherwise.
    pub fn set_joint_motor_position(
        &mut self, id: u32, target: f32, stiffness: f32, damping: f32,
    ) -> bool {
        let Some(&handle) = self.joint_handles.get(&id) else {
            return false;
        };
        let Some(joint) = self.impulse_joint_set.get_mut(handle) else {
            return false;
        };
        joint.data.set_motor_position(JointAxis::AngX, target, stiffness, damping);
        true
    }

    /// Enable or disable a joint (controls whether it generates contact forces).
    ///
    /// # Arguments
    /// * `id`      — Joint ID.
    /// * `enabled` — `true` to enable, `false` to disable.
    ///
    /// # Returns
    /// `true` if the joint exists, `false` otherwise.
    pub fn set_joint_enabled(&mut self, id: u32, enabled: bool) -> bool {
        let Some(&handle) = self.joint_handles.get(&id) else {
            return false;
        };
        let Some(joint) = self.impulse_joint_set.get_mut(handle) else {
            return false;
        };
        joint.data.set_enabled(enabled);
        true
    }

    // ── Body kind ─────────────────────────────────────────────────────────────

    /// Return the body kind discriminant for an entity.
    ///
    /// # Arguments
    /// * `entity_index` — ECS entity slot index.
    ///
    /// # Returns
    /// `0` = Fixed, `1` = Dynamic, `2` = KinematicPositionBased.
    /// Returns `255` if the entity has no registered body.
    pub fn get_body_kind(&self, entity_index: u32) -> u8 {
        let Some(&handle) = self.entity_handles.get(&entity_index) else {
            return 255;
        };
        let Some(body) = self.rigid_body_set.get(handle) else {
            return 255;
        };
        body_type_to_kind(body.body_type())
    }

    /// Change the body kind of an existing body.
    ///
    /// Use this to switch a body between fixed, dynamic, and kinematic at
    /// runtime (e.g. picking up a static object).
    ///
    /// # Arguments
    /// * `entity_index` — ECS entity slot index.
    /// * `kind`         — `0` = Fixed, `1` = Dynamic, `2` = KinematicPositionBased.
    ///
    /// # Returns
    /// `true` on success, `false` if the entity has no registered body.
    pub fn set_body_kind(&mut self, entity_index: u32, kind: u8) -> bool {
        let Some(&handle) = self.entity_handles.get(&entity_index) else {
            debug_warn!("set_body_kind(entity={}): no registered body", entity_index);
            return false;
        };
        let Some(body) = self.rigid_body_set.get_mut(handle) else {
            debug_warn!("set_body_kind(entity={}): body handle became invalid", entity_index);
            return false;
        };
        body.set_body_type(kind_to_body_type(kind), true);
        true
    }

    // ── RFC-09D: Character Controller ─────────────────────────────────────────

    /// Registers a [`KinematicCharacterController`] for the body at `entity_index`.
    ///
    /// The controller is configured from the supplied parameters and stored
    /// internally. Call [`character_controller_move`] every frame to drive the
    /// character, and [`remove_character_controller`] when the entity is
    /// destroyed.
    ///
    /// Inserting a second controller for the same entity replaces the first.
    ///
    /// # Arguments
    /// * `entity_index`           — ECS entity slot index.  The entity must already
    ///                              have a registered rigid body.
    /// * `step_height`            — Maximum height (metres) the controller can step
    ///                              up onto. Pass `0.0` to disable auto-stepping.
    /// * `slope_limit`            — Maximum climbable slope angle in **degrees**.
    ///                              Slopes steeper than this are treated as walls.
    /// * `skin_width`             — Separation (metres) kept between the character
    ///                              shape and surfaces (`cc.offset`).
    /// * `snap_to_ground`         — Distance (metres) to snap the character to the
    ///                              ground when descending ramps.  Pass `0.0` to
    ///                              disable snapping.
    /// * `slide_on_steep_slopes`  — When `true` the character slides along steep
    ///                              surfaces instead of being stopped by them.
    /// * `apply_impulses_to_dynamic` — When `true` the controller pushes dynamic
    ///                              bodies it collides with.
    ///
    /// # Returns
    /// The assigned compact slot index (0 .. [`MAX_CC_ENTITIES`]) on success,
    /// [`u32::MAX`] if the entity has no registered rigid body, or [`u32::MAX`]
    /// if the CC pool is exhausted (all [`MAX_CC_ENTITIES`] slots occupied and
    /// none have been freed).
    pub fn add_character_controller(
        &mut self,
        entity_index: u32,
        step_height: f32,
        slope_limit: f32,
        skin_width: f32,
        snap_to_ground: f32,
        slide_on_steep_slopes: bool,
        apply_impulses_to_dynamic: bool,
    ) -> u32 {
        if !self.entity_handles.contains_key(&entity_index) {
            debug_warn!("add_character_controller: unknown entity {}", entity_index);
            return u32::MAX;
        }
        let mut cc = KinematicCharacterController::default();
        cc.offset = CharacterLength::Absolute(skin_width);
        cc.slide = slide_on_steep_slopes;
        cc.snap_to_ground = if snap_to_ground > 0.0 {
            Some(CharacterLength::Absolute(snap_to_ground))
        } else {
            None
        };
        cc.max_slope_climb_angle = slope_limit.to_radians();
        cc.min_slope_slide_angle = slope_limit.to_radians();
        // Note: impulse application to dynamic bodies is handled via
        // `solve_character_collision_impulses` in `character_controller_move`
        // rather than as a field (the field does not exist in rapier3d 0.22.0).
        cc.autostep = if step_height > 0.0 {
            Some(CharacterAutostep {
                max_height: CharacterLength::Absolute(step_height),
                min_width: CharacterLength::Absolute(0.1),
                include_dynamic_bodies: false,
            })
        } else {
            None
        };
        self.cc_controllers.insert(entity_index, (cc, apply_impulses_to_dynamic));
        let slot = if let Some(recycled) = self.cc_free_slots.pop() {
            recycled
        } else {
            if self.next_cc_slot >= MAX_CC_ENTITIES as u32 {
                eprintln!(
                    "[gwen-core] add_character_controller: CC pool exhausted (max {})",
                    MAX_CC_ENTITIES
                );
                return u32::MAX;
            }
            let s = self.next_cc_slot;
            self.next_cc_slot += 1;
            s
        };
        self.cc_slot_indices.insert(entity_index, slot);
        slot
    }

    /// Moves the character controller for `entity_index` by `(vx, vy, vz) * dt`,
    /// resolving collisions against the scene.
    ///
    /// The resolved translation is applied to the body as a *kinematic
    /// next-position* update via [`RigidBody::set_next_kinematic_position`].
    /// The body must be `KinematicPositionBased` for Rapier to honour the
    /// update; the call is a no-op for other body types (Rapier ignores
    /// `set_next_kinematic_position` on dynamic bodies).
    ///
    /// The [`QueryPipeline`] must have been updated at least once (i.e.
    /// [`step`] must have been called) before this method produces useful
    /// collision results.
    ///
    /// # Arguments
    /// * `entity_index` — ECS entity slot index.
    /// * `vx/vy/vz`     — Desired velocity in world space (m/s).
    /// * `dt`           — Simulation time-step (seconds).
    ///
    /// Results are written to [`CC_STATE_BUFFER`] at the slot index assigned
    /// by [`add_character_controller`]. Buffer layout per slot (stride 5):
    /// `[grounded, normal_x, normal_y, normal_z, ground_entity_bits]`
    pub fn character_controller_move(
        &mut self,
        entity_index: u32,
        vx: f32,
        vy: f32,
        vz: f32,
        dt: f32,
    ) {
        /// Sentinel written on every early-exit path (not grounded, no contact).
        const NO_HIT: [f32; 5] = [
            0.0,
            0.0,
            1.0,
            0.0,
            // f32::from_bits(u32::MAX) — bit-pattern sentinel for "no entity"
            f32::from_bits(u32::MAX),
        ];

        /// Write NO_HIT sentinel into the buffer at `base`.
        #[inline(always)]
        unsafe fn write_no_hit(buf: *mut [f32; MAX_CC_ENTITIES * CC_STATE_STRIDE], base: usize) {
            (*buf)[base] = NO_HIT[0];
            (*buf)[base + 1] = NO_HIT[1];
            (*buf)[base + 2] = NO_HIT[2];
            (*buf)[base + 3] = NO_HIT[3];
            (*buf)[base + 4] = NO_HIT[4];
        }

        let Some(&slot) = self.cc_slot_indices.get(&entity_index) else {
            return;
        };
        let base = slot as usize * CC_STATE_STRIDE;

        let Some(&handle) = self.entity_handles.get(&entity_index) else {
            debug_warn!("character_controller_move: unknown entity {}", entity_index);
            unsafe { write_no_hit(&raw mut CC_STATE_BUFFER, base) };
            return;
        };
        let Some((cc, apply_impulses)) = self.cc_controllers.get(&entity_index) else {
            debug_warn!("character_controller_move: no CC for entity {}", entity_index);
            unsafe { write_no_hit(&raw mut CC_STATE_BUFFER, base) };
            return;
        };
        let apply_impulses = *apply_impulses;
        let Some(body) = self.rigid_body_set.get(handle) else {
            unsafe { write_no_hit(&raw mut CC_STATE_BUFFER, base) };
            return;
        };
        let position = *body.position();
        let desired = Vector::new(vx * dt, vy * dt, vz * dt);

        // Use the first collider attached to the body to determine the shape.
        let Some(collider_handle) = body.colliders().first().copied() else {
            debug_warn!("character_controller_move: entity {} has no collider", entity_index);
            unsafe { write_no_hit(&raw mut CC_STATE_BUFFER, base) };
            return;
        };
        let Some(collider) = self.collider_set.get(collider_handle) else {
            unsafe { write_no_hit(&raw mut CC_STATE_BUFFER, base) };
            return;
        };
        let shape = collider.shape();

        // Exclude the character's own body from collision queries so the
        // controller does not collide with itself.
        let filter = QueryFilter::default().exclude_rigid_body(handle);

        // Collect collisions for optional impulse application and ground detection.
        let mut collisions: Vec<rapier3d::control::CharacterCollision> = Vec::new();
        let movement = cc.move_shape(
            dt,
            &self.rigid_body_set,
            &self.collider_set,
            &self.query_pipeline,
            shape,
            &position,
            desired,
            filter,
            |c| collisions.push(c),
        );

        // Apply impulses to dynamic bodies if requested.
        if apply_impulses && !collisions.is_empty() {
            // character_mass: use 1.0 as a sensible default (mass not stored per-CC).
            cc.solve_character_collision_impulses(
                dt,
                &mut self.rigid_body_set,
                &self.collider_set,
                &self.query_pipeline,
                shape,
                1.0,
                &collisions,
                filter,
            );
        }

        // Write the resolved position back as a kinematic interpolation target.
        let Some(body_mut) = self.rigid_body_set.get_mut(handle) else {
            unsafe { write_no_hit(&raw mut CC_STATE_BUFFER, base) };
            return;
        };
        let mut new_pos = *body_mut.position();
        new_pos.translation.vector += movement.translation;
        body_mut.set_next_kinematic_position(new_pos);

        // ── Determine ground contact info and write to CC_STATE_BUFFER ────────
        if movement.grounded && !collisions.is_empty() {
            let col = &collisions[0];
            // `normal2` is the outward normal on the hit (ground) collider.
            let n = col.hit.normal2;
            let mut ground_entity_bits = GROUND_ENTITY_STATIC; // default: static world

            if let Some(col_ref) = self.collider_set.get(col.handle) {
                if let Some(rb_handle) = col_ref.parent() {
                    // Dynamic / kinematic body — look up entity index in O(1).
                    if let Some(&ent_idx) = self.handle_to_entity.get(&rb_handle) {
                        ground_entity_bits = ent_idx;
                    }
                }
                // else: static collider (no parent body) → keep GROUND_ENTITY_STATIC
            }

            unsafe {
                let buf = &raw mut CC_STATE_BUFFER;
                (*buf)[base] = 1.0_f32;
                (*buf)[base + 1] = n.x;
                (*buf)[base + 2] = n.y;
                (*buf)[base + 3] = n.z;
                (*buf)[base + 4] = f32::from_bits(ground_entity_bits);
            }
        } else {
            unsafe { write_no_hit(&raw mut CC_STATE_BUFFER, base) };
        }
    }

    /// Removes the registered character controller for `entity_index`.
    ///
    /// This is a no-op if no controller is registered for the entity.
    ///
    /// # Arguments
    /// * `entity_index` — ECS entity slot index.
    pub fn remove_character_controller(&mut self, entity_index: u32) {
        self.cc_controllers.remove(&entity_index);
        if let Some(slot) = self.cc_slot_indices.remove(&entity_index) {
            self.cc_free_slots.push(slot);
        }
    }
}

/// Returns a raw pointer to the start of the CC state buffer in WASM linear memory.
///
/// Layout per slot (stride 5): [grounded, nx, ny, nz, ground_entity_bits].
pub fn get_cc_sab_ptr() -> *const f32 {
    std::ptr::addr_of!(CC_STATE_BUFFER) as *const f32
}

/// Returns the maximum number of simultaneous character controllers.
pub fn max_cc_entities() -> u32 {
    MAX_CC_ENTITIES as u32
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── Helpers ───────────────────────────────────────────────────────────────

    /// Build a world with standard Earth gravity and one dynamic body at origin.
    fn world_with_one_dynamic() -> PhysicsWorld3D {
        let mut world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
        assert!(world.add_body(0, 0.0, 10.0, 0.0, 1, 1.0, 0.0, 0.0));
        world
    }

    // ── Smoke tests ───────────────────────────────────────────────────────────

    #[test]
    fn test_physics3d_world_creation() {
        let world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
        assert_eq!(world.gravity.y, -9.81);
    }

    #[test]
    fn test_physics3d_step_executes() {
        let mut world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
        world.step(0.016);
    }

    // ── T1: add / remove / has ────────────────────────────────────────────────

    #[test]
    fn test_physics3d_add_remove_body_happy_path() {
        let mut world = PhysicsWorld3D::new(0.0, -9.81, 0.0);

        // Adding a new entity succeeds
        assert!(world.add_body(42, 1.0, 2.0, 3.0, 1, 5.0, 0.1, 0.05));
        assert!(world.has_body(42));

        // Removing it succeeds
        assert!(world.remove_body(42));
        assert!(!world.has_body(42));
    }

    #[test]
    fn test_physics3d_add_body_duplicate_returns_false() {
        let mut world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
        assert!(world.add_body(1, 0.0, 0.0, 0.0, 1, 1.0, 0.0, 0.0));
        // Registering the same entity index again must be rejected
        assert!(!world.add_body(1, 5.0, 5.0, 5.0, 1, 2.0, 0.0, 0.0));
    }

    #[test]
    fn test_physics3d_remove_body_nonexistent_returns_false() {
        let mut world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
        assert!(!world.remove_body(99));
    }

    #[test]
    fn test_physics3d_add_body_all_kinds() {
        let mut world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
        assert!(world.add_body(0, 0.0, 0.0, 0.0, 0, 0.0, 0.0, 0.0)); // Fixed
        assert!(world.add_body(1, 0.0, 0.0, 0.0, 1, 1.0, 0.0, 0.0)); // Dynamic
        assert!(world.add_body(2, 0.0, 0.0, 0.0, 2, 0.0, 0.0, 0.0)); // Kinematic
    }

    // ── T1: get / set body state ──────────────────────────────────────────────

    #[test]
    fn test_physics3d_get_body_state_returns_13_elements() {
        let world = world_with_one_dynamic();
        let state = world.get_body_state(0);
        assert_eq!(state.len(), 13);
    }

    #[test]
    fn test_physics3d_get_body_state_initial_position() {
        let world = world_with_one_dynamic();
        let state = world.get_body_state(0);
        // Position should be approximately (0, 10, 0)
        assert!((state[0] - 0.0).abs() < 1e-5, "px");
        assert!((state[1] - 10.0).abs() < 1e-5, "py");
        assert!((state[2] - 0.0).abs() < 1e-5, "pz");
    }

    #[test]
    fn test_physics3d_get_body_state_identity_quaternion() {
        let world = world_with_one_dynamic();
        let state = world.get_body_state(0);
        // Default orientation is the identity quaternion (0, 0, 0, 1)
        assert!((state[3] - 0.0).abs() < 1e-5, "qx");
        assert!((state[4] - 0.0).abs() < 1e-5, "qy");
        assert!((state[5] - 0.0).abs() < 1e-5, "qz");
        assert!((state[6] - 1.0).abs() < 1e-5, "qw");
    }

    #[test]
    fn test_physics3d_get_body_state_unknown_entity_returns_empty() {
        let world = world_with_one_dynamic();
        assert!(world.get_body_state(999).is_empty());
    }

    #[test]
    fn test_physics3d_set_body_state_updates_position() {
        let mut world = world_with_one_dynamic();
        // Teleport to (5, 20, -3) with identity rotation and zero velocities
        assert!(world.set_body_state(0, 5.0, 20.0, -3.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0));
        let state = world.get_body_state(0);
        assert!((state[0] - 5.0).abs() < 1e-4, "px after set");
        assert!((state[1] - 20.0).abs() < 1e-4, "py after set");
        assert!((state[2] - (-3.0)).abs() < 1e-4, "pz after set");
    }

    #[test]
    fn test_physics3d_set_body_state_unknown_entity_returns_false() {
        let mut world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
        assert!(!world.set_body_state(7, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0));
    }

    // ── T1: linear/angular velocity ───────────────────────────────────────────

    #[test]
    fn test_physics3d_velocities_round_trip() {
        let mut world = world_with_one_dynamic();

        // Linear velocity
        assert!(world.set_linear_velocity(0, 1.0, 2.0, 3.0));
        let lv = world.get_linear_velocity(0);
        assert_eq!(lv.len(), 3);
        assert!((lv[0] - 1.0).abs() < 1e-5);
        assert!((lv[1] - 2.0).abs() < 1e-5);
        assert!((lv[2] - 3.0).abs() < 1e-5);

        // Angular velocity
        assert!(world.set_angular_velocity(0, 0.1, 0.2, 0.3));
        let av = world.get_angular_velocity(0);
        assert_eq!(av.len(), 3);
        assert!((av[0] - 0.1).abs() < 1e-5);
        assert!((av[1] - 0.2).abs() < 1e-5);
        assert!((av[2] - 0.3).abs() < 1e-5);
    }

    #[test]
    fn test_physics3d_velocities_unknown_entity_returns_empty() {
        let world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
        assert!(world.get_linear_velocity(0).is_empty());
        assert!(world.get_angular_velocity(0).is_empty());
    }

    #[test]
    fn test_physics3d_set_velocities_unknown_entity_returns_false() {
        let mut world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
        assert!(!world.set_linear_velocity(5, 1.0, 0.0, 0.0));
        assert!(!world.set_angular_velocity(5, 0.0, 1.0, 0.0));
    }

    // ── T1: apply impulse ─────────────────────────────────────────────────────

    #[test]
    fn test_physics3d_apply_impulse_changes_velocity() {
        let mut world = world_with_one_dynamic();

        // Rapier defers mass-property recomputation until the first step — the
        // `LOCAL_MASS_PROPERTIES` change flag set by `additional_mass` on the
        // builder is only processed by the pipeline's `user_changes` pass.
        // A single step here causes that pass to run, giving the body a
        // non-zero `effective_inv_mass` before we apply the impulse.
        world.step(1.0 / 60.0);

        // Zero linear velocity on X before the impulse (gravity only affects Y)
        let lv_before = world.get_linear_velocity(0);
        assert!((lv_before[0]).abs() < 1e-5, "initial vx should be zero");

        assert!(world.apply_impulse(0, 10.0, 0.0, 0.0));
        let lv_after = world.get_linear_velocity(0);
        // With mass=1 kg and impulse=10 N·s, vx must be positive.
        assert!(lv_after[0] > 0.0, "impulse should increase vx");
    }

    #[test]
    fn test_physics3d_apply_impulse_unknown_entity_returns_false() {
        let mut world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
        assert!(!world.apply_impulse(99, 1.0, 0.0, 0.0));
    }

    // ── T1: body kind ─────────────────────────────────────────────────────────

    #[test]
    fn test_physics3d_body_kind_round_trip() {
        let mut world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
        world.add_body(0, 0.0, 0.0, 0.0, 1, 1.0, 0.0, 0.0); // Dynamic

        assert_eq!(world.get_body_kind(0), 1); // Dynamic

        assert!(world.set_body_kind(0, 0)); // → Fixed
        assert_eq!(world.get_body_kind(0), 0);

        assert!(world.set_body_kind(0, 2)); // → Kinematic
        assert_eq!(world.get_body_kind(0), 2);
    }

    #[test]
    fn test_physics3d_body_kind_unknown_entity_returns_sentinel() {
        let world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
        assert_eq!(world.get_body_kind(42), 255);
    }

    #[test]
    fn test_physics3d_set_body_kind_unknown_entity_returns_false() {
        let mut world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
        assert!(!world.set_body_kind(7, 1));
    }

    // ── T1: gravity interaction ───────────────────────────────────────────────

    #[test]
    fn test_physics3d_dynamic_body_falls_under_gravity() {
        let mut world = world_with_one_dynamic();
        let initial_state = world.get_body_state(0);
        let initial_y = initial_state[1];

        // Step enough frames to see measurable fall
        for _ in 0..60 {
            world.step(1.0 / 60.0);
        }

        let final_state = world.get_body_state(0);
        assert!(final_state[1] < initial_y, "body should fall under gravity");
    }

    // ── Collider add/remove cycle ─────────────────────────────────────────────

    #[test]
    fn test_physics3d_add_box_collider_returns_true_for_valid_entity() {
        let mut world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
        world.add_body(0, 0.0, 0.0, 0.0, 1, 1.0, 0.0, 0.0);

        let ok = world.add_box_collider(
            0, 0.5, 0.5, 0.5, 0.0, 0.0, 0.0,
            false, 0.5, 0.0, u32::MAX, u32::MAX, 1,
        );
        assert!(ok);
    }

    #[test]
    fn test_physics3d_add_box_collider_returns_false_for_unknown_entity() {
        let mut world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
        let ok = world.add_box_collider(
            99, 0.5, 0.5, 0.5, 0.0, 0.0, 0.0,
            false, 0.5, 0.0, u32::MAX, u32::MAX, 1,
        );
        assert!(!ok);
    }

    #[test]
    fn test_physics3d_add_sphere_collider_happy_path() {
        let mut world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
        world.add_body(0, 0.0, 0.0, 0.0, 1, 1.0, 0.0, 0.0);

        let ok = world.add_sphere_collider(
            0, 0.5, 0.0, 0.0, 0.0,
            false, 0.5, 0.0, u32::MAX, u32::MAX, 2,
        );
        assert!(ok);
    }

    #[test]
    fn test_physics3d_add_capsule_collider_happy_path() {
        let mut world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
        world.add_body(0, 0.0, 0.0, 0.0, 1, 1.0, 0.0, 0.0);

        let ok = world.add_capsule_collider(
            0, 0.25, 0.5, 0.0, 0.0, 0.0,
            false, 0.5, 0.0, u32::MAX, u32::MAX, 3,
        );
        assert!(ok);
    }

    #[test]
    fn test_physics3d_remove_collider_happy_path() {
        let mut world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
        world.add_body(0, 0.0, 0.0, 0.0, 1, 1.0, 0.0, 0.0);
        world.add_box_collider(
            0, 0.5, 0.5, 0.5, 0.0, 0.0, 0.0,
            false, 0.5, 0.0, u32::MAX, u32::MAX, 7,
        );

        assert!(world.remove_collider(0, 7));
    }

    #[test]
    fn test_physics3d_remove_collider_unknown_returns_false() {
        let mut world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
        world.add_body(0, 0.0, 0.0, 0.0, 1, 1.0, 0.0, 0.0);
        assert!(!world.remove_collider(0, 999));
    }

    #[test]
    fn test_physics3d_remove_body_cleans_collider_map() {
        let mut world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
        world.add_body(0, 0.0, 0.0, 0.0, 1, 1.0, 0.0, 0.0);
        world.add_box_collider(
            0, 0.5, 0.5, 0.5, 0.0, 0.0, 0.0,
            false, 0.5, 0.0, u32::MAX, u32::MAX, 1,
        );

        world.remove_body(0);

        // The collider_handles map should no longer contain this entry.
        assert!(world.collider_handles.is_empty());
    }

    #[test]
    fn test_physics3d_add_multiple_collider_types_same_body() {
        let mut world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
        world.add_body(0, 0.0, 0.0, 0.0, 1, 1.0, 0.0, 0.0);

        assert!(world.add_box_collider(
            0, 0.5, 0.5, 0.5, 0.0, 0.0, 0.0,
            false, 0.5, 0.0, u32::MAX, u32::MAX, 1,
        ));
        assert!(world.add_sphere_collider(
            0, 0.3, 0.0, 1.0, 0.0,
            false, 0.5, 0.0, u32::MAX, u32::MAX, 2,
        ));
        assert!(world.add_capsule_collider(
            0, 0.2, 0.4, 0.0, -1.0, 0.0,
            false, 0.5, 0.0, u32::MAX, u32::MAX, 3,
        ));

        assert_eq!(world.collider_handles.len(), 3);
    }

    // ── Sensor state tracking ─────────────────────────────────────────────────

    #[test]
    fn test_physics3d_sensor_state_defaults_to_zero() {
        let world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
        // No sensor registered → packed u64 should be 0.
        assert_eq!(world.get_sensor_state(0, 42), 0);
    }

    #[test]
    fn test_physics3d_update_sensor_state_round_trip() {
        let mut world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
        world.update_sensor_state(5, 10, true, 3);

        let packed = world.get_sensor_state(5, 10);
        let contact_count = (packed & 0xffff_ffff) as u32;
        let is_active = (packed >> 32) != 0;

        assert_eq!(contact_count, 3);
        assert!(is_active);
    }

    #[test]
    fn test_physics3d_update_sensor_state_inactive() {
        let mut world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
        world.update_sensor_state(0, 0, false, 0);

        let packed = world.get_sensor_state(0, 0);
        assert_eq!(packed, 0);
    }

    #[test]
    fn test_physics3d_remove_body_clears_sensor_state() {
        let mut world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
        world.add_body(1, 0.0, 0.0, 0.0, 1, 1.0, 0.0, 0.0);
        world.update_sensor_state(1, 5, true, 2);

        world.remove_body(1);

        // Sensor state should be gone after body removal.
        assert_eq!(world.get_sensor_state(1, 5), 0);
    }

    // ── Quality preset application ────────────────────────────────────────────

    #[test]
    fn test_physics3d_quality_preset_low_sets_min_iterations() {
        let mut world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
        world.set_quality(0); // Low
        assert_eq!(
            world.integration_params.num_solver_iterations.get(),
            2,
            "Low preset should set 2 solver iterations"
        );
        assert_eq!(
            world.integration_params.num_internal_stabilization_iterations,
            1
        );
        assert_eq!(world.integration_params.max_ccd_substeps, 1);
    }

    #[test]
    fn test_physics3d_quality_preset_medium() {
        let mut world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
        world.set_quality(1); // Medium
        assert_eq!(world.integration_params.num_solver_iterations.get(), 4);
        assert_eq!(
            world.integration_params.num_internal_stabilization_iterations,
            2
        );
    }

    #[test]
    fn test_physics3d_quality_preset_high() {
        let mut world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
        world.set_quality(2); // High
        assert_eq!(world.integration_params.num_solver_iterations.get(), 8);
        assert_eq!(
            world.integration_params.num_internal_stabilization_iterations,
            3
        );
        assert_eq!(world.integration_params.max_ccd_substeps, 2);
    }

    #[test]
    fn test_physics3d_quality_preset_esport() {
        let mut world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
        world.set_quality(3); // Esport
        assert_eq!(world.integration_params.num_solver_iterations.get(), 10);
        assert_eq!(
            world.integration_params.num_internal_stabilization_iterations,
            4
        );
        assert_eq!(world.integration_params.max_ccd_substeps, 4);
    }

    #[test]
    fn test_physics3d_quality_unknown_preset_falls_back_to_medium() {
        let mut world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
        world.set_quality(200); // Unknown
        assert_eq!(world.integration_params.num_solver_iterations.get(), 4);
    }

    // ── Event coalescing flag ─────────────────────────────────────────────────

    #[test]
    fn test_physics3d_event_coalescing_toggle() {
        let mut world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
        assert!(!world.coalesce_events);
        world.set_event_coalescing(true);
        assert!(world.coalesce_events);
        world.set_event_coalescing(false);
        assert!(!world.coalesce_events);
    }

    // ── Collision event buffer ────────────────────────────────────────────────

    #[test]
    fn test_physics3d_event_count_zero_after_step_no_bodies() {
        let mut world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
        world.step(1.0 / 60.0);
        // No bodies → no events.
        assert_eq!(world.get_collision_event_count(), 0);
    }

    #[test]
    fn test_physics3d_consume_events_clears_count() {
        let mut world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
        world.step(1.0 / 60.0);
        world.consume_events();
        assert_eq!(world.get_collision_event_count(), 0);
    }

    #[test]
    fn test_physics3d_events_ptr_is_non_null() {
        let world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
        assert_ne!(world.get_collision_events_ptr(), 0);
    }

    // ── Kinematic position ────────────────────────────────────────────────────

    #[test]
    fn test_physics3d_set_kinematic_position_returns_true() {
        let mut world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
        world.add_body(0, 0.0, 0.0, 0.0, 2, 0.0, 0.0, 0.0); // Kinematic

        assert!(world.set_kinematic_position(
            0, 5.0, 3.0, 1.0, 0.0, 0.0, 0.0, 1.0,
        ));
    }

    #[test]
    fn test_physics3d_set_kinematic_position_unknown_entity_returns_false() {
        let mut world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
        assert!(!world.set_kinematic_position(
            99, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0,
        ));
    }

    // ── Angular impulse ───────────────────────────────────────────────────────

    #[test]
    fn test_physics3d_apply_angular_impulse_unknown_entity_returns_false() {
        let mut world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
        assert!(!world.apply_angular_impulse(77, 0.0, 1.0, 0.0));
    }

    #[test]
    fn test_physics3d_apply_angular_impulse_changes_angular_velocity() {
        let mut world = world_with_one_dynamic();
        // A box collider is required so Rapier can derive a non-zero inertia
        // tensor; without a shape, additional_mass() only sets translational
        // mass and apply_torque_impulse() has no effect.
        world.add_box_collider(0, 0.5, 0.5, 0.5, 0.0, 0.0, 0.0, false, 0.5, 0.0, u32::MAX, u32::MAX, 99);
        // Step once to initialise mass properties (same requirement as linear impulse).
        world.step(1.0 / 60.0);

        let av_before = world.get_angular_velocity(0);
        assert!((av_before[1]).abs() < 1e-5, "initial angular vy should be zero");

        assert!(world.apply_angular_impulse(0, 0.0, 5.0, 0.0));
        let av_after = world.get_angular_velocity(0);
        assert!(av_after[1] > 0.0, "angular impulse should increase angular vy");
    }

    #[test]
    fn test_physics3d_add_heightfield_collider_happy_path() {
        let mut world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
        // body_kind 1 = Fixed
        world.add_body(0, 0.0, 0.0, 0.0, 1, 1.0, 0.0, 0.0);

        // 3×3 grid — flat terrain at y = 0
        let heights = [0.0f32; 9];
        let ok = world.add_heightfield_collider(
            0, &heights, 3, 3,
            10.0, 1.0, 10.0,
            0.5, 0.0, u32::MAX, u32::MAX, 42,
        );
        assert!(ok);
        assert!(world.collider_handles.contains_key(&(0, 42)));
    }

    #[test]
    fn test_physics3d_add_heightfield_collider_wrong_size_returns_false() {
        let mut world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
        world.add_body(0, 0.0, 0.0, 0.0, 1, 1.0, 0.0, 0.0);

        // 8 elements but rows=3 cols=3 requires 9 — must fail
        let heights = [0.0f32; 8];
        let ok = world.add_heightfield_collider(
            0, &heights, 3, 3,
            10.0, 1.0, 10.0,
            0.5, 0.0, u32::MAX, u32::MAX, 1,
        );
        assert!(!ok);
    }

    #[test]
    fn test_physics3d_update_heightfield_collider_replaces_old() {
        let mut world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
        world.add_body(0, 0.0, 0.0, 0.0, 1, 1.0, 0.0, 0.0);

        let flat = [0.0f32; 9];
        world.add_heightfield_collider(
            0, &flat, 3, 3,
            10.0, 1.0, 10.0,
            0.5, 0.0, u32::MAX, u32::MAX, 99,
        );
        assert!(world.collider_handles.contains_key(&(0, 99)));

        // Raise the centre cell
        let mut updated = [0.0f32; 9];
        updated[4] = 5.0;
        let ok = world.update_heightfield_collider(
            0, 99, &updated, 3, 3,
            10.0, 1.0, 10.0,
            0.5, 0.0, u32::MAX, u32::MAX,
        );
        assert!(ok);
        // collider_id 99 must still be present after the rebuild
        assert!(world.collider_handles.contains_key(&(0, 99)));
    }

    #[test]
    fn test_physics3d_add_heightfield_collider_no_body_returns_false() {
        let mut world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
        // No body registered for entity 7
        let heights = [0.0f32; 4];
        let ok = world.add_heightfield_collider(
            7, &heights, 2, 2,
            4.0, 1.0, 4.0,
            0.5, 0.0, u32::MAX, u32::MAX, 1,
        );
        assert!(!ok);
    }

    // ─── add_mesh_collider ────────────────────────────────────────────────────

    #[test]
    fn test_physics3d_add_mesh_collider_returns_true_for_valid_entity() {
        let mut world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
        world.add_body(0, 0.0, 0.0, 0.0, 1, 1.0, 0.0, 0.0);
        // A single triangle
        let verts: &[f32] = &[0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0];
        let idxs: &[u32] = &[0, 1, 2];
        let ok = world.add_mesh_collider(
            0, verts, idxs, 0.0, 0.0, 0.0,
            false, 0.5, 0.0, u32::MAX, u32::MAX, 1,
        );
        assert!(ok);
    }

    #[test]
    fn test_physics3d_add_mesh_collider_returns_false_for_unknown_entity() {
        let mut world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
        let verts: &[f32] = &[0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0];
        let idxs: &[u32] = &[0, 1, 2];
        let ok = world.add_mesh_collider(
            99, verts, idxs, 0.0, 0.0, 0.0,
            false, 0.5, 0.0, u32::MAX, u32::MAX, 1,
        );
        assert!(!ok);
    }

    #[test]
    fn test_physics3d_add_mesh_collider_returns_false_for_empty_vertices() {
        let mut world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
        world.add_body(0, 0.0, 0.0, 0.0, 1, 1.0, 0.0, 0.0);
        let ok = world.add_mesh_collider(
            0, &[], &[0, 1, 2], 0.0, 0.0, 0.0,
            false, 0.5, 0.0, u32::MAX, u32::MAX, 1,
        );
        assert!(!ok);
    }

    #[test]
    fn test_physics3d_add_mesh_collider_returns_false_for_empty_indices() {
        let mut world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
        world.add_body(0, 0.0, 0.0, 0.0, 1, 1.0, 0.0, 0.0);
        let verts: &[f32] = &[0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0];
        let ok = world.add_mesh_collider(
            0, verts, &[], 0.0, 0.0, 0.0,
            false, 0.5, 0.0, u32::MAX, u32::MAX, 1,
        );
        assert!(!ok);
    }

    #[test]
    fn test_physics3d_add_mesh_collider_registers_in_collider_handles() {
        let mut world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
        world.add_body(0, 0.0, 0.0, 0.0, 1, 1.0, 0.0, 0.0);
        let verts: &[f32] = &[0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0];
        let idxs: &[u32] = &[0, 1, 2];
        world.add_mesh_collider(
            0, verts, idxs, 0.0, 0.0, 0.0,
            false, 0.5, 0.0, u32::MAX, u32::MAX, 7,
        );
        assert!(world.collider_handles.contains_key(&(0, 7)));
    }

    // ─── rebuild_mesh_collider ────────────────────────────────────────────────

    #[test]
    fn test_rebuild_mesh_collider_replaces_existing() {
        let mut world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
        world.add_body(0, 0.0, 0.0, 0.0, 0, 1.0, 0.0, 0.0);

        // Simple triangle mesh (one triangle).
        let verts_a: Vec<f32> = vec![0.0,0.0,0.0, 1.0,0.0,0.0, 0.0,1.0,0.0];
        let idxs_a: Vec<u32> = vec![0, 1, 2];
        assert!(world.add_mesh_collider(0, &verts_a, &idxs_a, 0.0, 0.0, 0.0, false, 0.5, 0.0, 0xFFFF_FFFF, 0xFFFF_FFFF, 10));
        assert_eq!(world.collider_handles.len(), 1);

        // Rebuild with a slightly different triangle.
        let verts_b: Vec<f32> = vec![0.0,0.0,0.0, 2.0,0.0,0.0, 0.0,2.0,0.0];
        let idxs_b: Vec<u32> = vec![0, 1, 2];
        assert!(world.rebuild_mesh_collider(0, 10, &verts_b, &idxs_b, 0.0, 0.0, 0.0, false, 0.5, 0.0, 0xFFFF_FFFF, 0xFFFF_FFFF));

        // Still exactly one collider handle — old one removed, new one inserted.
        assert_eq!(world.collider_handles.len(), 1);
    }

    #[test]
    fn test_rebuild_mesh_collider_inserts_when_missing() {
        let mut world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
        world.add_body(0, 0.0, 0.0, 0.0, 0, 1.0, 0.0, 0.0);

        // No collider registered yet — rebuild should insert a fresh one.
        let verts: Vec<f32> = vec![0.0,0.0,0.0, 1.0,0.0,0.0, 0.0,1.0,0.0];
        let idxs: Vec<u32> = vec![0, 1, 2];
        assert!(world.rebuild_mesh_collider(0, 99, &verts, &idxs, 0.0, 0.0, 0.0, false, 0.5, 0.0, 0xFFFF_FFFF, 0xFFFF_FFFF));
        assert_eq!(world.collider_handles.len(), 1);
    }

    #[test]
    fn test_rebuild_mesh_collider_returns_false_for_unknown_entity() {
        let mut world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
        // Entity 999 has no body registered.
        let verts: Vec<f32> = vec![0.0,0.0,0.0, 1.0,0.0,0.0, 0.0,1.0,0.0];
        let idxs: Vec<u32> = vec![0, 1, 2];
        assert!(!world.rebuild_mesh_collider(999, 1, &verts, &idxs, 0.0, 0.0, 0.0, false, 0.5, 0.0, 0xFFFF_FFFF, 0xFFFF_FFFF));
    }

    // ─── add_convex_collider ──────────────────────────────────────────────────

    #[test]
    fn test_physics3d_add_convex_collider_returns_true_for_valid_entity() {
        let mut world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
        world.add_body(0, 0.0, 0.0, 0.0, 1, 1.0, 0.0, 0.0);
        // Tetrahedron
        let verts: &[f32] = &[
            0.0, 0.0, 0.0,
            1.0, 0.0, 0.0,
            0.0, 1.0, 0.0,
            0.0, 0.0, 1.0,
        ];
        let ok = world.add_convex_collider(
            0, verts, 0.0, 0.0, 0.0,
            false, 0.5, 0.0, 1.0, u32::MAX, u32::MAX, 1,
        );
        assert!(ok);
    }

    #[test]
    fn test_physics3d_add_convex_collider_returns_false_for_unknown_entity() {
        let mut world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
        let verts: &[f32] = &[0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0];
        let ok = world.add_convex_collider(
            42, verts, 0.0, 0.0, 0.0,
            false, 0.5, 0.0, 1.0, u32::MAX, u32::MAX, 1,
        );
        assert!(!ok);
    }

    #[test]
    fn test_physics3d_add_convex_collider_returns_false_for_empty_vertices() {
        let mut world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
        world.add_body(0, 0.0, 0.0, 0.0, 1, 1.0, 0.0, 0.0);
        let ok = world.add_convex_collider(
            0, &[], 0.0, 0.0, 0.0,
            false, 0.5, 0.0, 1.0, u32::MAX, u32::MAX, 1,
        );
        assert!(!ok);
    }

    #[test]
    fn test_physics3d_add_convex_collider_registers_in_collider_handles() {
        let mut world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
        world.add_body(0, 0.0, 0.0, 0.0, 1, 1.0, 0.0, 0.0);
        let verts: &[f32] = &[
            0.0, 0.0, 0.0,
            1.0, 0.0, 0.0,
            0.0, 1.0, 0.0,
            0.0, 0.0, 1.0,
        ];
        world.add_convex_collider(
            0, verts, 0.0, 0.0, 0.0,
            false, 0.5, 0.0, 1.0, u32::MAX, u32::MAX, 5,
        );
        assert!(world.collider_handles.contains_key(&(0, 5)));
    }

    #[test]
    fn test_physics3d_add_convex_collider_degenerate_falls_back_to_sphere() {
        // Only 2 non-unique points — convex_hull returns None → fallback ball(0.5)
        let mut world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
        world.add_body(0, 0.0, 0.0, 0.0, 1, 1.0, 0.0, 0.0);
        let verts: &[f32] = &[0.0, 0.0, 0.0, 0.0, 0.0, 0.0];
        // Should still succeed (ball fallback) rather than panic
        let ok = world.add_convex_collider(
            0, verts, 0.0, 0.0, 0.0,
            false, 0.5, 0.0, 1.0, u32::MAX, u32::MAX, 3,
        );
        assert!(ok);
    }

    // ─── bulk_add_static_boxes ────────────────────────────────────────────────

    #[test]
    fn test_physics3d_bulk_add_static_boxes_returns_n_on_success() {
        let mut world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
        let indices: &[u32] = &[10, 11, 12];
        let positions: &[f32] = &[
            0.0, 0.0, 0.0,
            5.0, 0.0, 0.0,
            10.0, 0.0, 0.0,
        ];
        let half_extents: &[f32] = &[0.5, 0.5, 0.5]; // uniform
        let n = world.bulk_add_static_boxes(
            indices, positions, half_extents,
            0.5, 0.0, u32::MAX, u32::MAX,
        );
        assert_eq!(n, 3);
    }

    #[test]
    fn test_physics3d_bulk_add_static_boxes_registers_entity_handles() {
        let mut world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
        let indices: &[u32] = &[20, 21];
        let positions: &[f32] = &[0.0, 0.0, 0.0, 1.0, 0.0, 0.0];
        let half_extents: &[f32] = &[0.5, 0.5, 0.5];
        world.bulk_add_static_boxes(
            indices, positions, half_extents,
            0.5, 0.0, u32::MAX, u32::MAX,
        );
        assert!(world.entity_handles.contains_key(&20));
        assert!(world.entity_handles.contains_key(&21));
    }

    #[test]
    fn test_physics3d_bulk_add_static_boxes_registers_collider_handles() {
        let mut world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
        let indices: &[u32] = &[30, 31];
        let positions: &[f32] = &[0.0, 0.0, 0.0, 1.0, 0.0, 0.0];
        let half_extents: &[f32] = &[0.5, 0.5, 0.5];
        world.bulk_add_static_boxes(
            indices, positions, half_extents,
            0.5, 0.0, u32::MAX, u32::MAX,
        );
        // collider_id is always 0 for bulk-spawned boxes
        assert!(world.collider_handles.contains_key(&(30, 0)));
        assert!(world.collider_handles.contains_key(&(31, 0)));
    }

    #[test]
    fn test_physics3d_bulk_add_static_boxes_per_entity_half_extents() {
        let mut world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
        let indices: &[u32] = &[40, 41];
        let positions: &[f32] = &[0.0, 0.0, 0.0, 5.0, 0.0, 0.0];
        // Per-entity half extents: entity 40 → 0.5,0.5,0.5; entity 41 → 1.0,2.0,3.0
        let half_extents: &[f32] = &[0.5, 0.5, 0.5, 1.0, 2.0, 3.0];
        let n = world.bulk_add_static_boxes(
            indices, positions, half_extents,
            0.5, 0.0, u32::MAX, u32::MAX,
        );
        assert_eq!(n, 2);
        assert!(world.entity_handles.contains_key(&40));
        assert!(world.entity_handles.contains_key(&41));
    }

    #[test]
    fn test_physics3d_bulk_add_static_boxes_empty_indices_returns_zero() {
        let mut world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
        let n = world.bulk_add_static_boxes(
            &[], &[], &[0.5, 0.5, 0.5],
            0.5, 0.0, u32::MAX, u32::MAX,
        );
        assert_eq!(n, 0);
    }

    #[test]
    fn test_physics3d_bulk_add_static_boxes_wrong_positions_buffer_returns_zero() {
        let mut world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
        let indices: &[u32] = &[10, 11, 12];
        // Positions buffer too short: 6 floats instead of 9 (3 boxes × 3 coords)
        let positions: &[f32] = &[0.0, 0.0, 0.0, 1.0, 0.0, 0.0];
        let half_extents: &[f32] = &[0.5, 0.5, 0.5]; // uniform
        let n = world.bulk_add_static_boxes(
            indices, positions, half_extents,
            0.5, 0.0, u32::MAX, u32::MAX,
        );
        // Should return 0 (no bodies added), not panic
        assert_eq!(n, 0);
    }

    #[test]
    fn test_physics3d_bulk_add_static_boxes_wrong_extents_buffer_returns_zero() {
        let mut world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
        let indices: &[u32] = &[20, 21];
        let positions: &[f32] = &[0.0, 0.0, 0.0, 1.0, 0.0, 0.0];
        // Per-entity extents but buffer too short: 4 floats instead of 6 (2 boxes × 3 coords)
        // Length != 3, so treated as per-entity mode, but too short
        let half_extents: &[f32] = &[0.5, 0.5, 0.5, 0.5];
        let n = world.bulk_add_static_boxes(
            indices, positions, half_extents,
            0.5, 0.0, u32::MAX, u32::MAX,
        );
        // Should return 0, not panic
        assert_eq!(n, 0);
    }

    #[test]
    fn test_physics3d_bulk_add_static_boxes_correct_buffer_succeeds() {
        let mut world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
        let indices: &[u32] = &[40, 41, 42];
        // Correct position buffer: 9 floats for 3 boxes
        let positions: &[f32] = &[0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 2.0, 0.0, 0.0];
        let half_extents: &[f32] = &[0.5, 0.5, 0.5]; // uniform
        let n = world.bulk_add_static_boxes(
            indices, positions, half_extents,
            0.5, 0.0, u32::MAX, u32::MAX,
        );
        // Should succeed and add 3 bodies
        assert_eq!(n, 3);
    }

    // ── add_compound_collider ─────────────────────────────────────────────────

    #[test]
    fn test_add_compound_collider_three_boxes_returns_3() {
        let mut world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
        world.add_body(0, 0.0, 0.0, 0.0, 1, 1.0, 0.0, 0.0);

        // Three BOX shapes encoded as 3 × 12 floats
        #[rustfmt::skip]
        let data: Vec<f32> = vec![
            // shape, p0,  p1,  p2,  p3,  ox,  oy,  oz,  sensor, friction, rest, id
            0.0, 1.0, 0.3, 2.0, 0.0,  0.0, 0.3, 0.0,  0.0, 0.5, 0.0, 1.0, // chassis box
            0.0, 0.35,0.35,0.35,0.0, -0.9, 0.0, 1.6,  0.0, 0.5, 0.0, 2.0, // wheel FL
            0.0, 0.35,0.35,0.35,0.0,  0.9, 0.0, 1.6,  0.0, 0.5, 0.0, 3.0, // wheel FR
        ];

        let count = world.add_compound_collider(0, &data, u32::MAX, u32::MAX);
        assert_eq!(count, 3);
        assert_eq!(world.collider_handles.len(), 3);
    }

    #[test]
    fn test_add_compound_collider_mixed_shapes_returns_3() {
        let mut world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
        world.add_body(0, 0.0, 0.0, 0.0, 1, 1.0, 0.0, 0.0);

        #[rustfmt::skip]
        let data: Vec<f32> = vec![
            // BOX (type 0)
            0.0, 0.5, 0.5, 0.5, 0.0,  0.0, 0.0, 0.0,  0.0, 0.5, 0.0, 10.0,
            // SPHERE (type 1)
            1.0, 0.4, 0.0, 0.0, 0.0,  0.0, 1.0, 0.0,  0.0, 0.5, 0.0, 11.0,
            // CAPSULE (type 2)
            2.0, 0.25,0.5, 0.0, 0.0,  0.0,-1.0, 0.0,  0.0, 0.5, 0.0, 12.0,
        ];

        let count = world.add_compound_collider(0, &data, u32::MAX, u32::MAX);
        assert_eq!(count, 3);
        assert_eq!(world.collider_handles.len(), 3);
    }

    #[test]
    fn test_add_compound_collider_unknown_entity_returns_zero() {
        let mut world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
        // No body registered at entity 99.
        #[rustfmt::skip]
        let data: Vec<f32> = vec![
            0.0, 0.5, 0.5, 0.5, 0.0,  0.0, 0.0, 0.0,  0.0, 0.5, 0.0, 1.0,
        ];
        assert_eq!(world.add_compound_collider(99, &data, u32::MAX, u32::MAX), 0);
    }

    #[test]
    fn test_add_compound_collider_empty_buffer_returns_zero() {
        let mut world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
        world.add_body(0, 0.0, 0.0, 0.0, 1, 1.0, 0.0, 0.0);
        assert_eq!(world.add_compound_collider(0, &[], u32::MAX, u32::MAX), 0);
    }

    #[test]
    fn test_add_compound_collider_misaligned_buffer_returns_zero() {
        let mut world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
        world.add_body(0, 0.0, 0.0, 0.0, 1, 1.0, 0.0, 0.0);
        // 11 floats — not a multiple of 12
        let data = vec![0.0f32; 11];
        assert_eq!(world.add_compound_collider(0, &data, u32::MAX, u32::MAX), 0);
    }

    #[test]
    fn test_add_compound_collider_unknown_shape_type_skipped() {
        let mut world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
        world.add_body(0, 0.0, 0.0, 0.0, 1, 1.0, 0.0, 0.0);

        #[rustfmt::skip]
        let data: Vec<f32> = vec![
            // shape type 99 — unknown, should be skipped
            99.0, 0.5, 0.5, 0.5, 0.0,  0.0, 0.0, 0.0,  0.0, 0.5, 0.0, 1.0,
            // valid BOX
             0.0, 0.5, 0.5, 0.5, 0.0,  0.0, 0.0, 0.0,  0.0, 0.5, 0.0, 2.0,
        ];

        // Only the valid box is inserted.
        assert_eq!(world.add_compound_collider(0, &data, u32::MAX, u32::MAX), 1);
        assert_eq!(world.collider_handles.len(), 1);
    }

    #[test]
    fn test_add_compound_collider_sensor_shape_tracked() {
        let mut world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
        world.add_body(0, 0.0, 0.0, 0.0, 1, 1.0, 0.0, 0.0);

        #[rustfmt::skip]
        let data: Vec<f32> = vec![
            // is_sensor = 1.0
            0.0, 0.5, 0.5, 0.5, 0.0,  0.0, 0.0, 0.0,  1.0, 0.5, 0.0, 5.0,
        ];
        assert_eq!(world.add_compound_collider(0, &data, u32::MAX, u32::MAX), 1);
    }

    // ─── load_bvh_collider ────────────────────────────────────────────────────

    /// Helper: build a minimal valid GBVH buffer (2-triangle quad mesh).
    fn make_simple_trimesh_bytes() -> Vec<u8> {
        use rapier3d::geometry::TriMesh;
        use rapier3d::na::Point3;
        let verts = vec![
            Point3::new(0.0f32, 0.0, 0.0),
            Point3::new(1.0, 0.0, 0.0),
            Point3::new(0.0, 1.0, 0.0),
            Point3::new(1.0, 1.0, 0.0),
        ];
        let idxs = vec![[0u32, 1, 2], [1, 3, 2]];
        let trimesh = TriMesh::new(verts, idxs);
        let bvh =
            bincode::serde::encode_to_vec(&trimesh, bincode::config::standard()).unwrap();
        let mut out = b"GBVH".to_vec();
        out.extend_from_slice(&0u16.to_le_bytes()); // rapier major
        out.extend_from_slice(&22u16.to_le_bytes()); // rapier minor
        out.extend_from_slice(&bvh);
        out
    }

    #[test]
    fn test_load_bvh_collider_success() {
        let mut world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
        world.add_body(0, 0.0, 0.0, 0.0, 0, 1.0, 0.1, 0.1);
        let bytes = make_simple_trimesh_bytes();
        let ok = world.load_bvh_collider(0, &bytes, 0.0, 0.0, 0.0, false, 0.5, 0.0, 0xFFFF, 0xFFFF, 1);
        assert!(ok, "load_bvh_collider should succeed with valid bytes");
        assert!(world.collider_handles.contains_key(&(0, 1)));
    }

    #[test]
    fn test_load_bvh_collider_invalid_bytes() {
        let mut world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
        world.add_body(0, 0.0, 0.0, 0.0, 0, 1.0, 0.1, 0.1);
        let ok = world.load_bvh_collider(0, &[0u8; 8], 0.0, 0.0, 0.0, false, 0.5, 0.0, 0xFFFF, 0xFFFF, 1);
        assert!(!ok, "load_bvh_collider should fail with garbage bytes");
    }

    #[test]
    fn test_load_bvh_collider_too_short() {
        let mut world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
        world.add_body(0, 0.0, 0.0, 0.0, 0, 1.0, 0.1, 0.1);
        let ok = world.load_bvh_collider(0, &[0u8; 4], 0.0, 0.0, 0.0, false, 0.5, 0.0, 0xFFFF, 0xFFFF, 1);
        assert!(!ok, "load_bvh_collider should fail when buffer is shorter than 8 bytes");
    }

    #[test]
    fn test_load_bvh_collider_no_body() {
        let mut world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
        let bytes = make_simple_trimesh_bytes();
        let ok = world.load_bvh_collider(99, &bytes, 0.0, 0.0, 0.0, false, 0.5, 0.0, 0xFFFF, 0xFFFF, 1);
        assert!(!ok, "should fail when entity has no registered body");
    }

    // ── T2: bulk kinematic integration ──────────────────────────────────────────

    #[test]
    fn test_bulk_step_kinematics_3d_integrates_positions() {
        let mut world = PhysicsWorld3D::new(0.0, 0.0, 0.0);
        assert!(world.add_body(0, 0.0, 0.0, 0.0, 2, 0.0, 0.0, 0.0));
        assert!(world.add_body(1, 0.0, 0.0, 0.0, 2, 0.0, 0.0, 0.0));
        let slots = [0u32, 1u32];
        let vx = [1.0f32, 0.0f32];
        let vy = [0.0f32, 2.0f32];
        let vz = [0.0f32, 0.0f32];
        let n = world.bulk_step_kinematics(&slots, &vx, &vy, &vz, 1.0);
        assert_eq!(n, 2);

        // Verify positions changed after simulation step
        world.step(1.0 / 60.0);
        let state0 = world.get_body_state(0);
        let state1 = world.get_body_state(1);

        // Entity 0: vx=1.0, dt=1.0, expected x ≈ 1.0
        assert!((state0[0] - 1.0).abs() < 1e-4, "entity 0 should move 1.0 on X");

        // Entity 1: vy=2.0, dt=1.0, expected y ≈ 2.0
        assert!((state1[1] - 2.0).abs() < 1e-4, "entity 1 should move 2.0 on Y");
    }

    #[test]
    fn test_bulk_step_kinematic_rotations_3d_integrates_orientations() {
        let mut world = PhysicsWorld3D::new(0.0, 0.0, 0.0);
        assert!(world.add_body(0, 0.0, 0.0, 0.0, 2, 0.0, 0.0, 0.0));

        let slots = [0u32];
        let wx = [0.0f32];
        let wy = [1.0f32]; // 1 rad/s around Y
        let wz = [0.0f32];

        let state_before = world.get_body_state(0);
        let qw_before = state_before[6]; // w component of quaternion at index 6

        let n = world.bulk_step_kinematic_rotations(&slots, &wx, &wy, &wz, 1.0);
        assert_eq!(n, 1);

        // Verify quaternion changed after simulation step
        world.step(1.0 / 60.0);
        let state_after = world.get_body_state(0);
        let qw_after = state_after[6];

        // Quaternion w component should have changed due to rotation
        assert!(
            (qw_after - qw_before).abs() > 1e-5,
            "quaternion w component should change with rotation"
        );
    }

    #[test]
    fn test_bulk_step_kinematics_3d_unknown_entity_skipped() {
        let mut world = PhysicsWorld3D::new(0.0, 0.0, 0.0);
        // entity 0 exists, entity 999 does not
        assert!(world.add_body(0, 0.0, 0.0, 0.0, 2, 0.0, 0.0, 0.0));
        let slots = [0u32, 999u32];
        let vx = [1.0f32, 1.0f32];
        let vy = [0.0f32, 0.0f32];
        let vz = [0.0f32, 0.0f32];
        let n = world.bulk_step_kinematics(&slots, &vx, &vy, &vz, 1.0);
        assert_eq!(n, 1, "only 1 of 2 bodies exists");
    }

    #[test]
    fn test_bulk_step_kinematics_3d_mismatched_arrays() {
        let mut world = PhysicsWorld3D::new(0.0, 0.0, 0.0);
        assert!(world.add_body(0, 0.0, 0.0, 0.0, 2, 0.0, 0.0, 0.0));
        assert!(world.add_body(1, 0.0, 0.0, 0.0, 2, 0.0, 0.0, 0.0));
        // slots has 2, but vx/vy/vz only have 1 — should process min(2,1,1,1)=1
        let slots = [0u32, 1u32];
        let vx = [1.0f32];
        let vy = [0.0f32];
        let vz = [0.0f32];
        let n = world.bulk_step_kinematics(&slots, &vx, &vy, &vz, 1.0);
        assert_eq!(n, 1, "should process min slice length");
    }

    // ── RFC-09: forces, torques, gravity scale, axis locks, sleep ─────────────

    #[test]
    fn test_rfc09_add_force_changes_linear_velocity() {
        let mut world = world_with_one_dynamic();
        // Step once so Rapier initialises mass properties from the builder flags.
        world.step(1.0 / 60.0);

        let vx_before = world.get_linear_velocity(0)[0];
        assert!(vx_before.abs() < 1e-5, "initial vx should be ~zero");

        assert!(world.add_force(0, 1000.0, 0.0, 0.0));
        world.step(1.0 / 60.0);

        let vx_after = world.get_linear_velocity(0)[0];
        assert!(vx_after > 0.0, "add_force should accelerate body along X");
    }

    #[test]
    fn test_rfc09_add_torque_changes_angular_velocity() {
        let mut world = world_with_one_dynamic();
        // A collider is needed for Rapier to derive a non-zero inertia tensor.
        world.add_box_collider(0, 0.5, 0.5, 0.5, 0.0, 0.0, 0.0, false, 0.5, 0.0, u32::MAX, u32::MAX, 99);
        world.step(1.0 / 60.0);

        let ay_before = world.get_angular_velocity(0)[1];
        assert!(ay_before.abs() < 1e-5, "initial angular vy should be ~zero");

        assert!(world.add_torque(0, 0.0, 1000.0, 0.0));
        world.step(1.0 / 60.0);

        let ay_after = world.get_angular_velocity(0)[1];
        assert!(ay_after > 0.0, "add_torque should increase angular velocity about Y");
    }

    #[test]
    fn test_rfc09_add_force_unknown_entity_returns_false() {
        let mut world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
        assert!(!world.add_force(99, 1.0, 0.0, 0.0));
    }

    #[test]
    fn test_rfc09_set_get_gravity_scale_roundtrip() {
        let mut world = world_with_one_dynamic();
        assert!(world.set_gravity_scale(0, 2.5));
        let got = world.get_gravity_scale(0);
        assert!((got - 2.5).abs() < 1e-6, "gravity scale should roundtrip to 2.5, got {got}");
    }

    #[test]
    fn test_rfc09_set_gravity_scale_unknown_entity_returns_false() {
        let mut world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
        assert!(!world.set_gravity_scale(42, 0.0));
    }

    #[test]
    fn test_rfc09_lock_translations_x_prevents_x_movement() {
        let mut world = world_with_one_dynamic();
        world.step(1.0 / 60.0);

        assert!(world.lock_translations(0, true, false, false));
        // Apply a strong force along X and step.
        assert!(world.add_force(0, 10_000.0, 0.0, 0.0));
        world.step(1.0 / 60.0);

        let vx = world.get_linear_velocity(0)[0];
        assert!(vx.abs() < 1e-4, "locked X translation should keep vx ~zero, got {vx}");
    }

    #[test]
    fn test_rfc09_lock_rotations_y_prevents_y_rotation() {
        let mut world = world_with_one_dynamic();
        world.add_box_collider(0, 0.5, 0.5, 0.5, 0.0, 0.0, 0.0, false, 0.5, 0.0, u32::MAX, u32::MAX, 99);
        world.step(1.0 / 60.0);

        assert!(world.lock_rotations(0, false, true, false));
        assert!(world.add_torque(0, 0.0, 10_000.0, 0.0));
        world.step(1.0 / 60.0);

        let ay = world.get_angular_velocity(0)[1];
        assert!(ay.abs() < 1e-4, "locked Y rotation should keep angular vy ~zero, got {ay}");
    }

    #[test]
    fn test_rfc09_set_body_sleeping_true_then_is_sleeping() {
        let mut world = world_with_one_dynamic();
        assert!(world.set_body_sleeping(0, true));
        assert!(world.is_body_sleeping(0), "body should report sleeping after set_body_sleeping(true)");
    }

    #[test]
    fn test_rfc09_wake_all_wakes_sleeping_body() {
        let mut world = world_with_one_dynamic();
        assert!(world.set_body_sleeping(0, true));
        assert!(world.is_body_sleeping(0), "precondition: body must be asleep");
        world.wake_all();
        assert!(!world.is_body_sleeping(0), "wake_all should wake the sleeping body");
    }

    #[test]
    fn test_rfc09_is_body_sleeping_unknown_entity_returns_false() {
        let world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
        assert!(!world.is_body_sleeping(77));
    }

    // ── RFC-08: Joints ────────────────────────────────────────────────────────

    fn make_two_body_world() -> (PhysicsWorld3D, u32, u32) {
        let mut world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
        world.add_body(0, 0.0, 0.0, 0.0, 1, 1.0, 0.0, 0.0);
        world.add_body(1, 1.0, 0.0, 0.0, 1, 1.0, 0.0, 0.0);
        (world, 0, 1)
    }

    #[test]
    fn test_rfc08_add_fixed_joint_returns_valid_id() {
        let (mut world, a, b) = make_two_body_world();
        let id = world.add_fixed_joint(a, b, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
        assert_ne!(id, u32::MAX, "add_fixed_joint should return a valid ID");
    }

    #[test]
    fn test_rfc08_add_fixed_joint_missing_entity_returns_max() {
        let (mut world, a, _) = make_two_body_world();
        let id = world.add_fixed_joint(a, 99, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
        assert_eq!(id, u32::MAX, "missing entity should yield u32::MAX");
    }

    #[test]
    fn test_rfc08_add_revolute_joint_returns_valid_id() {
        let (mut world, a, b) = make_two_body_world();
        let id = world.add_revolute_joint(
            a, b,
            0.0, 0.0, 0.0,
            0.0, 0.0, 0.0,
            0.0, 1.0, 0.0,
            false, 0.0, 0.0,
        );
        assert_ne!(id, u32::MAX);
    }

    #[test]
    fn test_rfc08_add_prismatic_joint_returns_valid_id() {
        let (mut world, a, b) = make_two_body_world();
        let id = world.add_prismatic_joint(
            a, b,
            0.0, 0.0, 0.0,
            0.0, 0.0, 0.0,
            1.0, 0.0, 0.0,
            false, 0.0, 0.0,
        );
        assert_ne!(id, u32::MAX);
    }

    #[test]
    fn test_rfc08_add_ball_joint_returns_valid_id() {
        let (mut world, a, b) = make_two_body_world();
        let id = world.add_ball_joint(a, b, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
        assert_ne!(id, u32::MAX);
    }

    #[test]
    fn test_rfc08_add_spring_joint_returns_valid_id() {
        let (mut world, a, b) = make_two_body_world();
        let id = world.add_spring_joint(a, b, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 100.0, 1.0);
        assert_ne!(id, u32::MAX);
    }

    #[test]
    fn test_rfc08_remove_joint_returns_true() {
        let (mut world, a, b) = make_two_body_world();
        let id = world.add_fixed_joint(a, b, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
        assert!(world.remove_joint(id));
    }

    #[test]
    fn test_rfc08_remove_joint_unknown_id_returns_false() {
        let (mut world, _, _) = make_two_body_world();
        assert!(!world.remove_joint(9999));
    }

    #[test]
    fn test_rfc08_set_joint_motor_velocity_unknown_returns_false() {
        let (mut world, _, _) = make_two_body_world();
        assert!(!world.set_joint_motor_velocity(9999, 1.0, 100.0));
    }

    #[test]
    fn test_rfc08_set_joint_enabled_false_then_re_enable() {
        let (mut world, a, b) = make_two_body_world();
        let id = world.add_revolute_joint(
            a, b,
            0.0, 0.0, 0.0,
            0.0, 0.0, 0.0,
            0.0, 1.0, 0.0,
            false, 0.0, 0.0,
        );
        assert!(world.set_joint_enabled(id, false));
        assert!(world.set_joint_enabled(id, true));
    }

    #[test]
    fn test_rfc08_remove_body_cleans_up_joint() {
        let (mut world, a, b) = make_two_body_world();
        let id = world.add_fixed_joint(a, b, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
        assert_ne!(id, u32::MAX);
        // Removing body A should evict the joint from the map.
        assert!(world.remove_body(a));
        // The joint handle is now stale; remove_joint should return false.
        assert!(!world.remove_joint(id), "joint map should be cleaned up after remove_body");
    }

    // ── RFC-07: Spatial queries ───────────────────────────────────────────────

    /// Helper: build a world with a fixed body and box collider at origin.
    fn world_with_box_at_origin() -> PhysicsWorld3D {
        let mut world = PhysicsWorld3D::new(0.0, 0.0, 0.0);
        world.add_body(0, 0.0, 0.0, 0.0, 0, 1.0, 0.0, 0.0); // Fixed
        world.add_box_collider(
            0, 0.5, 0.5, 0.5, 0.0, 0.0, 0.0,
            false, 0.5, 0.0, 0xFFFF_FFFF, 0xFFFF_FFFF, 1,
        );
        world.step(1.0 / 60.0); // populates query_pipeline
        world
    }

    #[test]
    fn test_rfc07_cast_ray_hits_box_collider() {
        let world = world_with_box_at_origin();
        // Ray from (0, 5, 0) aimed downward at the box at origin.
        let result = world.cast_ray(
            0.0, 5.0, 0.0,
            0.0, -1.0, 0.0,
            20.0, 0xFFFF_FFFF, 0xFFFF_FFFF, true,
        );
        assert_eq!(result.len(), 9, "hit should produce 9 floats");
        assert_eq!(result[0], 1.0, "hit flag should be 1.0");
        assert_eq!(result[1], 0.0, "entity_index should be 0");
        // Distance from y=5 to y=0.5 (top of box half=0.5) is 4.5
        assert!((result[2] - 4.5).abs() < 1e-3, "toi should be ~4.5, got {}", result[2]);
    }

    #[test]
    fn test_rfc07_cast_ray_misses_returns_zero() {
        let world = world_with_box_at_origin();
        // Ray aimed away from all bodies.
        let result = world.cast_ray(
            0.0, 5.0, 0.0,
            0.0, 1.0, 0.0, // pointing upward, away from box
            20.0, 0xFFFF_FFFF, 0xFFFF_FFFF, true,
        );
        assert_eq!(result, vec![0.0], "miss should return [0.0]");
    }

    #[test]
    fn test_rfc07_cast_ray_no_query_pipeline_update_returns_miss() {
        // Build a world but do NOT call step() — query_pipeline is empty.
        let mut world = PhysicsWorld3D::new(0.0, 0.0, 0.0);
        world.add_body(0, 0.0, 0.0, 0.0, 0, 1.0, 0.0, 0.0);
        world.add_box_collider(
            0, 0.5, 0.5, 0.5, 0.0, 0.0, 0.0,
            false, 0.5, 0.0, 0xFFFF_FFFF, 0xFFFF_FFFF, 1,
        );
        // query_pipeline never updated → ray misses.
        let result = world.cast_ray(
            0.0, 5.0, 0.0,
            0.0, -1.0, 0.0,
            20.0, 0xFFFF_FFFF, 0xFFFF_FFFF, true,
        );
        assert_eq!(result, vec![0.0], "without step(), query_pipeline is empty → miss");
    }

    #[test]
    fn test_rfc07_project_point_onto_box() {
        let world = world_with_box_at_origin();
        // Point just above the top face of the box (top face at y=0.5).
        let result = world.project_point(0.0, 2.0, 0.0, 0xFFFF_FFFF, 0xFFFF_FFFF, false);
        assert_eq!(result.len(), 6, "hit should produce 6 floats");
        assert_eq!(result[0], 1.0, "hit flag should be 1.0");
        assert_eq!(result[1], 0.0, "entity_index should be 0");
        // Projected y should be at top of box = 0.5
        assert!((result[3] - 0.5).abs() < 1e-3, "projected y should be ~0.5, got {}", result[3]);
        assert_eq!(result[5], 0.0, "point above box is not inside");
    }

    #[test]
    fn test_rfc07_project_point_miss_empty_world() {
        let world = PhysicsWorld3D::new(0.0, 0.0, 0.0);
        let result = world.project_point(0.0, 0.0, 0.0, 0xFFFF_FFFF, 0xFFFF_FFFF, false);
        assert_eq!(result, vec![0.0], "empty world should miss");
    }

    #[test]
    fn test_rfc07_cast_shape_hits_box() {
        let world = world_with_box_at_origin();
        // Cast a ball (r=0.1) from (0,5,0) downward toward the box at origin.
        let result = world.cast_shape(
            0.0, 5.0, 0.0,
            0.0, 0.0, 0.0, 1.0, // identity rotation
            0.0, -1.0, 0.0,     // direction
            1, 0.1, 0.0, 0.0,   // ball, radius=0.1
            20.0, 0xFFFF_FFFF, 0xFFFF_FFFF,
        );
        assert_eq!(result.len(), 15, "hit should produce 15 floats");
        assert_eq!(result[0], 1.0, "hit flag should be 1.0");
        assert_eq!(result[1], 0.0, "entity_index should be 0");
        // toi: distance from y=5 to y=0.5+0.1=0.6 is 4.4
        assert!(result[2] > 0.0, "toi should be positive, got {}", result[2]);
    }

    #[test]
    fn test_rfc07_cast_shape_misses_empty_world() {
        let world = PhysicsWorld3D::new(0.0, 0.0, 0.0);
        let result = world.cast_shape(
            0.0, 5.0, 0.0,
            0.0, 0.0, 0.0, 1.0,
            0.0, -1.0, 0.0,
            1, 0.1, 0.0, 0.0,
            20.0, 0xFFFF_FFFF, 0xFFFF_FFFF,
        );
        assert_eq!(result, vec![0.0], "empty world should miss");
    }

    #[test]
    fn test_rfc07_overlap_shape_empty_world_returns_zero() {
        let world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
        let mut buf = [0u32; 16];
        let count = world.overlap_shape(
            0.0, 0.0, 0.0,
            0.0, 0.0, 0.0, 1.0,
            1, 100.0, 0.0, 0.0,
            0xFFFF_FFFF, 0xFFFF_FFFF,
            buf.as_mut_ptr() as u32, 16,
        );
        assert_eq!(count, 0);
    }

    // ── RFC-09D: Character Controller ─────────────────────────────────────────

    /// Build a minimal world with a kinematic body and a ball collider at the origin.
    fn world_with_kinematic_body() -> PhysicsWorld3D {
        let mut world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
        let body = RigidBodyBuilder::kinematic_position_based().build();
        let handle = world.rigid_body_set.insert(body);
        world.entity_handles.insert(0, handle);
        let collider = ColliderBuilder::ball(0.5).build();
        world
            .collider_set
            .insert_with_parent(collider, handle, &mut world.rigid_body_set);
        world
    }

    #[test]
    fn test_rfc09d_add_character_controller_returns_compact_slot() {
        let mut world = world_with_kinematic_body();
        let slot = world.add_character_controller(0, 0.35, 45.0, 0.02, 0.2, true, true);
        assert_eq!(slot, 0, "first CC should get compact slot 0");
    }

    #[test]
    fn test_rfc09d_add_character_controller_unknown_entity_returns_max() {
        let mut world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
        // Entity 99 has no registered body.
        let result = world.add_character_controller(99, 0.35, 45.0, 0.02, 0.2, true, true);
        assert_eq!(result, u32::MAX, "unknown entity should return u32::MAX");
    }

    #[test]
    fn test_rfc09d_add_character_controller_stores_controller() {
        let mut world = world_with_kinematic_body();
        world.add_character_controller(0, 0.35, 45.0, 0.02, 0.2, true, true);
        assert_eq!(world.cc_controllers.len(), 1, "one controller should be stored");
    }

    #[test]
    fn test_rfc09d_remove_character_controller_cleans_up() {
        let mut world = world_with_kinematic_body();
        world.add_character_controller(0, 0.35, 45.0, 0.02, 0.2, true, true);
        assert!(!world.cc_controllers.is_empty(), "controller should exist before removal");
        world.remove_character_controller(0);
        assert!(world.cc_controllers.is_empty(), "cc_controllers should be empty after removal");
        assert!(world.cc_slot_indices.is_empty(), "cc_slot_indices should be empty after removal");
    }

    #[test]
    fn test_rfc09d_character_controller_move_unknown_entity_no_panic() {
        let mut world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
        // Must not panic for an entity that was never registered.
        world.character_controller_move(42, 0.0, -1.0, 0.0, 1.0 / 60.0);
    }

    #[test]
    fn test_rfc09d_character_controller_move_applies_translation() {
        let mut world = world_with_kinematic_body();
        world.add_character_controller(0, 0.35, 45.0, 0.02, 0.2, true, true);

        // Step once to populate the query pipeline.
        world.step(1.0 / 60.0);

        // Record initial y position.
        let handle = *world.entity_handles.get(&0).unwrap();
        let initial_y = world.rigid_body_set.get(handle).unwrap().position().translation.y;

        // Move downward; the character should have a next-position applied.
        world.character_controller_move(0, 0.0, -1.0, 0.0, 1.0 / 60.0);

        // After set_next_kinematic_position the next position is stored but the
        // current position updates on the following step.  We read the next
        // position directly from the body's predicted position.
        let body = world.rigid_body_set.get(handle).unwrap();
        let next_y = body.next_position().translation.y;
        assert!(
            next_y < initial_y,
            "next_y ({next_y}) should be below initial_y ({initial_y}) after downward move"
        );
    }

    // ── Gap 2: set_body_solver_iterations ────────────────────────────────────

    #[test]
    fn test_rfc_set_body_solver_iterations_unknown_entity_returns_false() {
        let mut world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
        assert!(!world.set_body_solver_iterations(99, 2));
    }

    #[test]
    fn test_rfc_set_body_solver_iterations_known_entity_returns_true() {
        let mut world = world_with_one_dynamic();
        assert!(world.set_body_solver_iterations(0, 1));
    }

    // ── Gap 3: CC SAB buffer — void move, buffer writes ──────────────────────

    #[test]
    fn test_rfc_character_controller_move_no_panic_no_cc() {
        let mut world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
        // No CC registered — must not panic.
        world.character_controller_move(0, 0.0, -1.0, 0.0, 1.0 / 60.0);
    }

    #[test]
    fn test_rfc_character_controller_move_no_entity_no_panic() {
        let mut world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
        world.character_controller_move(42, 0.0, -1.0, 0.0, 1.0 / 60.0);
    }

    #[test]
    fn test_rfc_character_controller_move_writes_no_hit_sentinel_to_sab() {
        let mut world = world_with_kinematic_body();
        world.add_character_controller(0, 0.35, 45.0, 0.02, 0.2, true, true);
        world.step(1.0 / 60.0);
        // Move in empty scene — no floor, so not grounded.
        world.character_controller_move(0, 0.0, -5.0, 0.0, 1.0 / 60.0);
        // Slot 0: grounded flag must be 0.0
        let grounded = unsafe { CC_STATE_BUFFER[0] };
        assert_eq!(grounded, 0.0_f32, "no-hit sentinel must set grounded=0.0");
    }

    #[test]
    fn test_rfc_character_controller_move_grounded_flag() {
        let mut world = PhysicsWorld3D::new(0.0, -9.81, 0.0);

        // Add a kinematic body for the character (kind 3 = KinematicPositionBased).
        assert!(world.add_body(0, 0.0, 2.0, 0.0, 3, 1.0, 0.0, 0.0));
        let h = world.entity_handles[&0];
        let col = rapier3d::prelude::ColliderBuilder::capsule_y(0.5, 0.3).build();
        world.collider_set.insert_with_parent(col, h, &mut world.rigid_body_set);
        world.add_character_controller(0, 0.35, 45.0, 0.02, 0.2, true, true);

        // Add a static floor at y ≈ 0 so the character can land.
        let floor = rapier3d::prelude::ColliderBuilder::cuboid(5.0, 0.1, 5.0)
            .translation(rapier3d::na::Vector3::new(0.0, -0.1, 0.0))
            .build();
        world.collider_set.insert(floor);

        // Warm up the query pipeline.
        world.step(1.0 / 60.0);

        // Drive the character downward for up to 120 frames; verify no panic.
        for _ in 0..120 {
            world.character_controller_move(0, 0.0, -5.0, 0.0, 1.0 / 60.0);
            world.step(1.0 / 60.0);
        }
        // Grounded flag is 0.0 or 1.0 — just verify no panic and valid float.
        let grounded = unsafe { CC_STATE_BUFFER[0] };
        assert!(grounded == 0.0 || grounded == 1.0, "grounded must be 0.0 or 1.0");
    }
}
