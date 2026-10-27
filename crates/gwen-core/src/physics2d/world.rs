//! PhysicsWorld — Rapier2D pipeline + ECS mapping.
//!
//! Encapsulates the full Rapier2D simulation state and maintains a
//! bidirectional mapping between GWEN entity indices (u32) and Rapier
//! `RigidBodyHandle`s.

use crate::physics2d::components::{BodyOptions, BodyType, ColliderOptions};
use crate::physics2d::error::Physics2DError;
use crate::physics2d::events::{
    CollisionEventBuffer, PhysicsCollisionEvent as StaticCollisionEvent,
};
use rapier2d::prelude::*;
use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, PoisonError};

const COLLIDER_ID_ABSENT: u32 = u32::MAX;
const MAX_BODY_ADDITIONAL_SOLVER_ITERATIONS: usize = 16;

/// Largest absolute coordinate a query accepts, and the position past which a dynamic body is disabled.
///
/// This is a game-world policy. The value stays `1.0e7`.
/// On 2026-10-27, rapier 0.36.1 did not panic at or below it.
/// `tests/physics3d_magnitude_probe.rs` `broad_phase_extent_scan` stepped a dynamic box and ran a
/// ray, a point and a shape query at `1.0e6`, `1.0e7`, `1.0e8`, `4.9e8`, `8.4e8`, `1.0e9`,
/// `1.2e9`, `2.0e9` and `2.5e9`. Every call returned.
/// `tests/physics2d_float_probe.rs` `broad_phase_extent_scan` stepped a dynamic ball of radius
/// `0.5` at the same magnitudes. Every step returned.
pub const MAX_WORLD_EXTENT: f32 = 1.0e7;

/// Default linear-speed cap, in metres per second.
pub const DEFAULT_MAX_LINEAR_VELOCITY: f32 = 400.0;

const REASON_NON_FINITE: u32 = 0;
const REASON_OUT_OF_BOUNDS: u32 = 1;
const REASON_VELOCITY: u32 = 2;
/// Room for 16 `[slot, reason]` pairs. `step` does not grow this buffer when nothing is disabled.
const DISABLED_SLOT_CAPACITY: usize = 32;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum PhysicsQualityPreset {
    Low = 0,
    Medium = 1,
    High = 2,
    Esport = 3,
}

impl PhysicsQualityPreset {
    pub fn from_u8(v: u8) -> Self {
        match v {
            0 => PhysicsQualityPreset::Low,
            2 => PhysicsQualityPreset::High,
            3 => PhysicsQualityPreset::Esport,
            _ => PhysicsQualityPreset::Medium,
        }
    }
}

#[derive(Debug, Clone, Copy)]
struct QualitySolverConfig {
    num_solver_iterations: usize,
    num_internal_stabilization_iterations: usize,
    max_ccd_substeps: usize,
}

fn quality_solver_config(preset: PhysicsQualityPreset) -> QualitySolverConfig {
    match preset {
        PhysicsQualityPreset::Low => QualitySolverConfig {
            num_solver_iterations: 2,
            num_internal_stabilization_iterations: 1,
            max_ccd_substeps: 1,
        },
        PhysicsQualityPreset::Medium => QualitySolverConfig {
            num_solver_iterations: 4,
            num_internal_stabilization_iterations: 2,
            max_ccd_substeps: 1,
        },
        PhysicsQualityPreset::High => QualitySolverConfig {
            num_solver_iterations: 8,
            num_internal_stabilization_iterations: 3,
            max_ccd_substeps: 2,
        },
        PhysicsQualityPreset::Esport => QualitySolverConfig {
            num_solver_iterations: 10,
            num_internal_stabilization_iterations: 4,
            max_ccd_substeps: 4,
        },
    }
}

#[inline]
fn pack_collider_user_data(entity_index: u32, collider_id: u32) -> u128 {
    ((entity_index as u128) << 32) | (collider_id as u128)
}

#[inline]
fn unpack_collider_user_data(user_data: u128) -> (u32, Option<u32>) {
    let entity_index = (user_data >> 32) as u32;
    let collider_id = (user_data & 0xffff_ffff) as u32;
    let resolved = if collider_id == COLLIDER_ID_ABSENT {
        None
    } else {
        Some(collider_id)
    };
    (entity_index, resolved)
}

// ─── Event collector ─────────────────────────────────────────────────────────

/// Collects one step's collision events into this world's buffer.
///
/// Rapier's `EventHandler` takes `&self`, so the exclusive borrow sits behind a
/// [`Mutex`]. `unsync-callbacks` is on for the `rapier2d` dependency in
/// `crates/gwen-core/Cargo.toml`, so the type is not required to be `Sync`. One
/// uncontended lock per event. On `wasm32` without atomics, std uses a no-threads
/// mutex.
struct EventCollector<'a> {
    buf: Mutex<&'a mut CollisionEventBuffer>,
}

/// The event the handler stores, or `None` when a collider is unknown or its entity is `u32::MAX`.
fn collision_record(
    colliders: &ColliderSet,
    event: CollisionEvent,
) -> Option<StaticCollisionEvent> {
    let (ea, ca) = colliders
        .get(event.collider1())
        .map(|c| unpack_collider_user_data(c.user_data))
        .unwrap_or((u32::MAX, None));
    let (eb, cb) = colliders
        .get(event.collider2())
        .map(|c| unpack_collider_user_data(c.user_data))
        .unwrap_or((u32::MAX, None));
    if ea == u32::MAX || eb == u32::MAX {
        return None;
    }
    Some(StaticCollisionEvent {
        entity_a: ea,
        entity_b: eb,
        collider_a_id: ca.unwrap_or(u32::MAX),
        collider_b_id: cb.unwrap_or(u32::MAX),
        flags: if event.started() { 1 } else { 0 },
    })
}

impl EventHandler for EventCollector<'_> {
    fn handle_collision_event(
        &self,
        _bodies: &RigidBodySet,
        colliders: &ColliderSet,
        event: CollisionEvent,
        _contact_pair: Option<&ContactPair>,
    ) {
        if let Some(record) = collision_record(colliders, event) {
            let mut guard = self.buf.lock().unwrap_or_else(PoisonError::into_inner);
            guard.push(record);
        }
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

    fn handle_soft_body_tear_event(&self, _soft_bodies: &SoftBodySet, _event: &SoftBodyTearEvent) {}
}

// ─── PhysicsWorld ─────────────────────────────────────────────────────────────

/// Manages the 2D physics simulation and its integration with the ECS.
pub struct PhysicsWorld {
    pipeline: PhysicsPipeline,
    gravity: Vector,
    integration_params: IntegrationParameters,
    island_manager: IslandManager,
    broad_phase: DefaultBroadPhase,
    narrow_phase: NarrowPhase,
    rigid_body_set: RigidBodySet,
    collider_set: ColliderSet,
    impulse_joint_set: ImpulseJointSet,
    multibody_joint_set: MultibodyJointSet,
    ccd_solver: CCDSolver,
    soft_bodies: SoftBodySet,

    pub entity_to_body: HashMap<u32, RigidBodyHandle>,
    pub body_to_entity: HashMap<RigidBodyHandle, u32>,
    handle_by_raw: HashMap<u32, RigidBodyHandle>,
    /// Maps tilemap chunk IDs to their pseudo-entity indices for unload/lookup.
    tilemap_chunk_to_entity: HashMap<u32, u32>,
    quality_preset: PhysicsQualityPreset,
    global_ccd_enabled: bool,
    pub one_way_colliders: HashSet<ColliderHandle>,
    collision_events: CollisionEventBuffer,
    /// Reused by `physics_step` so a step does not allocate a pose list.
    dynamic_pose_scratch: Vec<(u32, f32, f32, f32)>,
    /// Metres per second. Dynamic bodies faster than this are scaled down in [`Self::step`].
    max_linear_velocity: f32,
    /// Interleaved `[slot, reason]` pairs. Drained by [`Self::take_disabled_slots`].
    disabled_slots: Vec<u32>,
}

struct OneWayHooks<'a> {
    set: &'a HashSet<ColliderHandle>,
}

impl PhysicsHooks for OneWayHooks<'_> {
    fn modify_solver_contacts(&self, context: &mut ContactModificationContext) {
        let is_c1 = self.set.contains(&context.collider1);
        let is_c2 = self.set.contains(&context.collider2);
        if !is_c1 && !is_c2 {
            return;
        }
        // Platform is c1 → allowed_local_n1 = +Y (normal points up from platform toward character)
        // Platform is c2 → allowed_local_n1 = -Y (local_n1 is from c1/character perspective, points down)
        let allowed = if is_c1 { Vector::Y } else { -Vector::Y };
        context.update_as_oneway_platform(allowed, std::f32::consts::FRAC_PI_4);
    }
}

impl PhysicsWorld {
    /// Creates a new PhysicsWorld with the given gravity.
    pub fn new(gravity_x: f32, gravity_y: f32) -> Self {
        let mut world = PhysicsWorld {
            pipeline: PhysicsPipeline::new(),
            gravity: Vector::new(gravity_x, gravity_y),
            integration_params: IntegrationParameters::default(),
            island_manager: IslandManager::new(),
            broad_phase: DefaultBroadPhase::new(),
            narrow_phase: NarrowPhase::new(),
            rigid_body_set: RigidBodySet::new(),
            collider_set: ColliderSet::new(),
            impulse_joint_set: ImpulseJointSet::new(),
            multibody_joint_set: MultibodyJointSet::new(),
            ccd_solver: CCDSolver::new(),
            soft_bodies: SoftBodySet::new(),
            entity_to_body: HashMap::new(),
            body_to_entity: HashMap::new(),
            handle_by_raw: HashMap::new(),
            tilemap_chunk_to_entity: HashMap::new(),
            quality_preset: PhysicsQualityPreset::Medium,
            global_ccd_enabled: false,
            one_way_colliders: HashSet::new(),
            collision_events: CollisionEventBuffer::new(),
            dynamic_pose_scratch: Vec::new(),
            max_linear_velocity: DEFAULT_MAX_LINEAR_VELOCITY,
            disabled_slots: Vec::with_capacity(DISABLED_SLOT_CAPACITY),
        };
        world.set_quality_preset(PhysicsQualityPreset::Medium);
        world.integration_params.normalized_max_linear_velocity = DEFAULT_MAX_LINEAR_VELOCITY;
        world
    }

    /// Sets the quality preset for the simulation.
    pub fn set_quality_preset(&mut self, preset: PhysicsQualityPreset) {
        self.quality_preset = preset;
        let cfg = quality_solver_config(preset);
        self.integration_params.num_solver_iterations = cfg.num_solver_iterations;
        self.integration_params
            .num_internal_stabilization_iterations = cfg.num_internal_stabilization_iterations;
        self.integration_params.max_ccd_substeps = cfg.max_ccd_substeps;
    }

    /// Adds a rigid body to the simulation.
    ///
    /// A slot that already has a body is refused. The first body stays.
    pub fn add_rigid_body(
        &mut self,
        entity_index: u32,
        x: f32,
        y: f32,
        body_type: BodyType,
        opts: BodyOptions,
    ) -> Result<u32, Physics2DError> {
        if self.entity_to_body.contains_key(&entity_index) {
            return Err(Physics2DError::BodyAlreadyExists { slot: entity_index });
        }

        let mut builder = match body_type {
            BodyType::Fixed => RigidBodyBuilder::fixed(),
            BodyType::Dynamic => RigidBodyBuilder::dynamic()
                .additional_mass(opts.mass)
                .sleeping(false),
            BodyType::Kinematic => RigidBodyBuilder::kinematic_position_based(),
        };

        builder = builder
            .translation(Vector::new(x, y))
            .gravity_scale(opts.gravity_scale)
            .linear_damping(opts.linear_damping)
            .angular_damping(opts.angular_damping);

        let mut rb = builder.build();
        rb.wake_up(true);
        let ccd_enabled = opts.ccd_enabled.unwrap_or(self.global_ccd_enabled);
        rb.enable_ccd(ccd_enabled);
        if let Some(extra) = opts.additional_solver_iterations {
            rb.set_additional_solver_iterations(extra.min(MAX_BODY_ADDITIONAL_SOLVER_ITERATIONS));
        }

        if body_type == BodyType::Dynamic {
            let (vx, vy) = opts.initial_velocity;
            if vx != 0.0 || vy != 0.0 {
                rb.set_linvel(Vector::new(vx, vy), true);
            }
        }

        let handle = self.rigid_body_set.insert(rb);
        let raw = handle.0.into_raw_parts().0;

        self.entity_to_body.insert(entity_index, handle);
        self.body_to_entity.insert(handle, entity_index);
        self.handle_by_raw.insert(raw, handle);

        Ok(raw)
    }

    /// Adds a box collider to an existing rigid body.
    pub fn add_box_collider(
        &mut self,
        body_handle_raw: u32,
        hw: f32,
        hh: f32,
        opts: ColliderOptions,
    ) -> Result<(), Physics2DError> {
        let Some(handle) = self.handle_by_raw.get(&body_handle_raw).copied() else {
            return Err(Physics2DError::StaleBodyHandle {
                handle: body_handle_raw,
            });
        };
        let entity_index = self
            .body_to_entity
            .get(&handle)
            .copied()
            .unwrap_or(u32::MAX);
        let groups = rapier2d::geometry::Group::from_bits_truncate(opts.groups.membership);
        let filter = rapier2d::geometry::Group::from_bits_truncate(opts.groups.filter);
        let builder = ColliderBuilder::cuboid(hw, hh)
            .translation(Vector::new(opts.offset_x, opts.offset_y))
            .restitution(opts.material.restitution)
            .friction(opts.material.friction)
            .density(opts.density)
            .sensor(opts.is_sensor)
            .collision_groups(rapier2d::geometry::InteractionGroups::new(
                groups,
                filter,
                InteractionTestMode::And,
            ))
            .user_data(pack_collider_user_data(entity_index, opts.collider_id))
            .active_events(ActiveEvents::COLLISION_EVENTS)
            .active_hooks(if opts.is_one_way {
                ActiveHooks::MODIFY_SOLVER_CONTACTS
            } else {
                ActiveHooks::empty()
            });
        let collider = builder.build();
        let handle =
            self.collider_set
                .insert_with_parent(collider, handle, &mut self.rigid_body_set);
        if opts.is_one_way {
            self.one_way_colliders.insert(handle);
        }
        Ok(())
    }

    /// Removes a rigid body and all its colliders from the simulation.
    pub fn remove_rigid_body(&mut self, entity_index: u32) {
        if let Some(handle) = self.entity_to_body.remove(&entity_index) {
            self.body_to_entity.remove(&handle);
            let raw = handle.0.into_raw_parts().0;
            self.handle_by_raw.remove(&raw);
            self.rigid_body_set.remove(
                handle,
                &mut self.island_manager,
                &mut self.collider_set,
                &mut self.impulse_joint_set,
                &mut self.multibody_joint_set,
                &mut self.soft_bodies,
                true,
            );
        }
    }

    /// Reports whether a rigid body is registered for this slot.
    pub fn contains_body(&self, entity_index: u32) -> bool {
        self.entity_to_body.contains_key(&entity_index)
    }

    /// Lock or unlock every rotation axis of the body in this slot.
    ///
    /// Rapier keeps the flag when a collider is attached later.
    /// An unknown slot returns [`Physics2DError::BodyNotFound`].
    pub fn lock_body_rotation(
        &mut self,
        entity_index: u32,
        fixed: bool,
    ) -> Result<(), Physics2DError> {
        let Some(&handle) = self.entity_to_body.get(&entity_index) else {
            return Err(Physics2DError::BodyNotFound { slot: entity_index });
        };
        let Some(body) = self.rigid_body_set.get_mut(handle) else {
            return Err(Physics2DError::BodyNotFound { slot: entity_index });
        };
        body.lock_rotations(fixed, true);
        Ok(())
    }

    /// Adds a ball collider to an existing rigid body.
    pub fn add_ball_collider(
        &mut self,
        body_handle_raw: u32,
        radius: f32,
        opts: ColliderOptions,
    ) -> Result<(), Physics2DError> {
        let Some(handle) = self.handle_by_raw.get(&body_handle_raw).copied() else {
            return Err(Physics2DError::StaleBodyHandle {
                handle: body_handle_raw,
            });
        };
        let entity_index = self
            .body_to_entity
            .get(&handle)
            .copied()
            .unwrap_or(u32::MAX);
        let groups = rapier2d::geometry::Group::from_bits_truncate(opts.groups.membership);
        let filter = rapier2d::geometry::Group::from_bits_truncate(opts.groups.filter);
        let builder = ColliderBuilder::ball(radius)
            .translation(Vector::new(opts.offset_x, opts.offset_y))
            .restitution(opts.material.restitution)
            .friction(opts.material.friction)
            .density(opts.density)
            .sensor(opts.is_sensor)
            .collision_groups(rapier2d::geometry::InteractionGroups::new(
                groups,
                filter,
                InteractionTestMode::And,
            ))
            .user_data(pack_collider_user_data(entity_index, opts.collider_id))
            .active_events(ActiveEvents::COLLISION_EVENTS)
            .active_hooks(if opts.is_one_way {
                ActiveHooks::MODIFY_SOLVER_CONTACTS
            } else {
                ActiveHooks::empty()
            });
        let collider = builder.build();
        let collider_handle =
            self.collider_set
                .insert_with_parent(collider, handle, &mut self.rigid_body_set);
        if opts.is_one_way {
            self.one_way_colliders.insert(collider_handle);
        }
        Ok(())
    }

    /// Get position and rotation of a body.
    pub fn get_position(&self, entity_index: u32) -> Option<(f32, f32, f32)> {
        self.entity_to_body.get(&entity_index).and_then(|&h| {
            self.rigid_body_set.get(h).map(|b| {
                let pos = b.translation();
                (pos.x, pos.y, b.rotation().angle())
            })
        })
    }

    /// Get linear velocity of a body.
    pub fn get_linear_velocity(&self, entity_index: u32) -> Option<(f32, f32)> {
        self.entity_to_body.get(&entity_index).and_then(|&h| {
            self.rigid_body_set.get(h).map(|b| {
                let vel = b.linvel();
                (vel.x, vel.y)
            })
        })
    }

    /// Set the linear velocity of a dynamic 2D rigid body.
    ///
    /// Immediately overwrites the body's current velocity and wakes it if sleeping.
    /// Intended for **dynamic** bodies. For kinematic bodies, drive movement through
    /// [`set_kinematic_position`] or [`bulk_step_kinematics`] instead — calling this
    /// on a kinematic body is a no-op in Rapier2D's velocity-based kinematic mode.
    ///
    /// # Parameters
    /// * `entity_index` — Entity slot index.
    /// * `vx`, `vy`    — New linear velocity in metres per second.
    ///
    /// # Returns
    /// `true` if the body was found and updated; `false` if no rigid body is
    /// registered for this entity.
    pub fn set_linear_velocity(&mut self, entity_index: u32, vx: f32, vy: f32) -> bool {
        let Some(&handle) = self.entity_to_body.get(&entity_index) else {
            return false;
        };
        let Some(body) = self.rigid_body_set.get_mut(handle) else {
            return false;
        };
        body.set_linvel(Vector::new(vx, vy), true);
        true
    }

    /// Apply a linear impulse to a dynamic 2D rigid body.
    ///
    /// Instantly changes the body's velocity by `impulse / mass`. Wakes the
    /// body if sleeping. Intended for **dynamic** bodies only.
    ///
    /// # Parameters
    /// * `entity_index` — Entity slot index.
    /// * `ix`, `iy`    — Impulse vector in newton-seconds (kg·m/s).
    ///
    /// # Returns
    /// `true` if the body was found and updated; `false` if no rigid body is
    /// registered for this entity.
    pub fn apply_impulse(&mut self, entity_index: u32, ix: f32, iy: f32) -> bool {
        let Some(&handle) = self.entity_to_body.get(&entity_index) else {
            return false;
        };
        let Some(body) = self.rigid_body_set.get_mut(handle) else {
            return false;
        };
        body.apply_impulse(Vector::new(ix, iy), true);
        true
    }

    /// Set the next kinematic position and orientation of a 2D body.
    ///
    /// Only has an effect on bodies created with [`BodyType::Kinematic`].
    /// The change takes effect at the next [`PhysicsWorld::step`] call.
    ///
    /// # Parameters
    /// * `entity_index` — Entity slot.
    /// * `x`, `y` — Target world-space position in metres.
    /// * `angle` — Target orientation in radians.
    ///
    /// # Returns
    /// `true` if the body was found and updated; `false` otherwise.
    pub fn set_kinematic_position(
        &mut self,
        entity_index: u32,
        x: f32,
        y: f32,
        angle: f32,
    ) -> bool {
        let Some(&handle) = self.entity_to_body.get(&entity_index) else {
            return false;
        };
        let Some(body) = self.rigid_body_set.get_mut(handle) else {
            return false;
        };
        let pose = Pose::new(Vector::new(x, y), angle);
        body.set_next_kinematic_position(pose);
        true
    }

    /// Integrate the positions of N kinematic bodies in one pass.
    ///
    /// For each body at index `i`, computes:
    /// `new_pos = current_pos + (vx[i], vy[i]) * dt`
    /// and calls [`set_next_kinematic_position`] with the preserved current angle.
    ///
    /// Lengths of `slots`, `vx`, and `vy` must be equal. A mismatch returns
    /// before any body moves. Bodies not found by their slot are skipped.
    ///
    /// # Returns
    /// Number of bodies actually updated.
    ///
    /// # Errors
    /// Returns [`Physics2DError::BufferLengthMismatch`] when `vx` or `vy`
    /// has a different length from `slots`. `vx` is checked first.
    pub fn bulk_step_kinematics(
        &mut self,
        slots: &[u32],
        vx: &[f32],
        vy: &[f32],
        dt: f32,
    ) -> Result<u32, Physics2DError> {
        if slots.len() != vx.len() {
            return Err(Physics2DError::BufferLengthMismatch {
                buffer: "vx",
                expected: crate::bindings::bulk_len_u32(slots.len()),
                actual: crate::bindings::bulk_len_u32(vx.len()),
            });
        }
        if slots.len() != vy.len() {
            return Err(Physics2DError::BufferLengthMismatch {
                buffer: "vy",
                expected: crate::bindings::bulk_len_u32(slots.len()),
                actual: crate::bindings::bulk_len_u32(vy.len()),
            });
        }
        let mut updated = 0u32;
        for i in 0..slots.len() {
            let Some(&handle) = self.entity_to_body.get(&slots[i]) else {
                continue;
            };
            let Some(body) = self.rigid_body_set.get_mut(handle) else {
                continue;
            };
            let pos = *body.position();
            let new_x = pos.translation.x + vx[i] * dt;
            let new_y = pos.translation.y + vy[i] * dt;
            let pose = Pose::new(Vector::new(new_x, new_y), pos.rotation.angle());
            body.set_next_kinematic_position(pose);
            updated += 1;
        }
        Ok(updated)
    }

    /// Returns sensor state — always `(0, false)` because sensor contact tracking is
    /// implemented in the JavaScript plugin layer (not in Rapier). This stub satisfies
    /// the `physics_get_sensor_state` WASM binding but is never called by the plugin.
    pub fn get_sensor_state(&self, _entity_index: u32, _collider_id: u32) -> (u32, bool) {
        (0, false)
    }

    pub fn set_linear_damping(&mut self, entity_index: u32, damping: f32) {
        if let Some(&handle) = self.entity_to_body.get(&entity_index) {
            if let Some(body) = self.rigid_body_set.get_mut(handle) {
                body.set_linear_damping(damping);
            }
        }
    }

    // ── Tilemap chunk bodies ──────────────────────────────────────────────────

    /// Create a static rigid body for a tilemap chunk and register it by chunk ID.
    ///
    /// Tilemap chunks use pseudo-entity indices derived from their chunk ID
    /// (`(chunk_id | 0x80000000)`) so they never collide with real entity slots.
    /// Colliders are added separately via [`add_box_collider`] using the returned
    /// raw body handle.
    ///
    /// # Parameters
    /// * `chunk_id`      — Unique chunk identifier (fnv1a32 of the chunk key).
    /// * `pseudo_entity` — Pseudo-entity index derived from `chunk_id`.
    /// * `x`, `y`        — World-space origin of the chunk in metres.
    ///
    /// # Returns
    /// The raw body handle to use when attaching colliders.
    /// A chunk id that is already loaded is refused and the first body stays.
    pub fn load_tilemap_chunk_body(
        &mut self,
        chunk_id: u32,
        pseudo_entity: u32,
        x: f32,
        y: f32,
    ) -> Result<u32, Physics2DError> {
        if self.tilemap_chunk_to_entity.contains_key(&chunk_id) {
            return Err(Physics2DError::TilemapChunkAlreadyLoaded);
        }
        let handle_raw =
            self.add_rigid_body(pseudo_entity, x, y, BodyType::Fixed, BodyOptions::default())?;
        self.tilemap_chunk_to_entity.insert(chunk_id, pseudo_entity);
        Ok(handle_raw)
    }

    /// Remove the static rigid body associated with a tilemap chunk.
    ///
    /// Removes the body and all attached colliders from the simulation.
    /// Refuses a chunk id that is not loaded, and leaves the map unchanged.
    ///
    /// # Parameters
    /// * `chunk_id` — Unique chunk identifier previously passed to [`load_tilemap_chunk_body`].
    pub fn unload_tilemap_chunk_body(&mut self, chunk_id: u32) -> Result<(), Physics2DError> {
        let Some(pseudo_entity) = self.tilemap_chunk_to_entity.remove(&chunk_id) else {
            return Err(Physics2DError::TilemapChunkNotLoaded);
        };
        self.remove_rigid_body(pseudo_entity);
        Ok(())
    }

    pub fn query_radius(
        &self,
        x: f32,
        y: f32,
        radius: f32,
        membership: u32,
        filter: u32,
    ) -> Vec<u32> {
        self.intersect_shape(
            &Ball::new(radius),
            Pose::translation(x, y),
            membership,
            filter,
        )
    }

    pub fn query_rect(
        &self,
        x: f32,
        y: f32,
        hw: f32,
        hh: f32,
        membership: u32,
        filter: u32,
    ) -> Vec<u32> {
        self.intersect_shape(
            &Cuboid::new(Vector::new(hw, hh)),
            Pose::translation(x, y),
            membership,
            filter,
        )
    }

    pub fn point_query(&self, x: f32, y: f32, membership: u32, filter: u32) -> Vec<u32> {
        let mut results = Vec::new();
        let pipeline = self.query_pipeline(Self::make_query_filter(membership, filter));
        for (_, collider) in pipeline.intersect_point(Vector::new(x, y)) {
            Self::push_entity(collider, &mut results);
        }
        results
    }

    fn intersect_shape(
        &self,
        shape: &dyn Shape,
        pos: Pose,
        membership: u32,
        filter: u32,
    ) -> Vec<u32> {
        let mut results = Vec::new();
        let pipeline = self.query_pipeline(Self::make_query_filter(membership, filter));
        for (_, collider) in pipeline.intersect_shape(pos, shape) {
            Self::push_entity(collider, &mut results);
        }
        results
    }

    fn query_pipeline<'a>(&'a self, filter: QueryFilter<'a>) -> QueryPipeline<'a> {
        self.broad_phase.as_query_pipeline(
            self.narrow_phase.query_dispatcher(),
            &self.rigid_body_set,
            &self.collider_set,
            filter,
        )
    }

    #[inline]
    fn make_query_filter(membership: u32, filter: u32) -> QueryFilter<'static> {
        QueryFilter::new().groups(InteractionGroups::new(
            Group::from_bits_truncate(membership),
            Group::from_bits_truncate(filter),
            InteractionTestMode::And,
        ))
    }

    #[inline]
    fn push_entity(collider: &Collider, results: &mut Vec<u32>) {
        let (idx, _) = unpack_collider_user_data(collider.user_data);
        if idx != u32::MAX {
            results.push(idx);
        }
    }

    pub fn collision_events_ptr(&self) -> *const StaticCollisionEvent {
        self.collision_events.as_ptr()
    }

    pub fn collision_event_count(&self) -> u32 {
        self.collision_events.len() as u32
    }

    /// Whether the rigid body in `slot` is enabled.
    ///
    /// A missing slot is `false`. Reads Rapier `RigidBody::is_enabled` and
    /// does not change the body.
    pub fn is_body_enabled(&self, slot: u32) -> bool {
        let Some(&handle) = self.entity_to_body.get(&slot) else {
            return false;
        };
        let Some(body) = self.rigid_body_set.get(handle) else {
            return false;
        };
        body.is_enabled()
    }

    /// Drains disabled-slot records as interleaved `[slot, code, ...]` pairs.
    ///
    /// Codes are `0` non-finite, `1` out-of-bounds, `2` velocity.
    /// A Rapier-quarantined body is code `0` in this list.
    /// An empty list returns `Vec::new` and keeps this world's spare capacity.
    pub fn take_disabled_slots(&mut self) -> Vec<u32> {
        if self.disabled_slots.is_empty() {
            return Vec::new();
        }
        std::mem::replace(
            &mut self.disabled_slots,
            Vec::with_capacity(DISABLED_SLOT_CAPACITY),
        )
    }

    /// Stores `value` when it is finite and greater than zero.
    ///
    /// Also stores it as the simulation's per-substep linear cap.
    /// Returns `false` and keeps both caps otherwise.
    pub fn set_max_linear_velocity(&mut self, value: f32) -> bool {
        if !value.is_finite() || value <= 0.0 {
            return false;
        }
        self.max_linear_velocity = value;
        self.integration_params.normalized_max_linear_velocity = value;
        true
    }

    /// Refuse a point that is not finite or sits outside [`MAX_WORLD_EXTENT`].
    ///
    /// `x` is checked before `y`. The world is not touched.
    pub fn reject_point_query(x: f32, y: f32) -> Result<(), Physics2DError> {
        reject_query_coordinate("x", x)?;
        reject_query_coordinate("y", y)?;
        Ok(())
    }

    /// Refuse a circle query. Centre first (`x`, then `y`), then `radius`.
    ///
    /// `radius` must be finite, `>= 0`, and `<= `[`MAX_WORLD_EXTENT`].
    pub fn reject_query_radius(x: f32, y: f32, radius: f32) -> Result<(), Physics2DError> {
        reject_query_coordinate("x", x)?;
        reject_query_coordinate("y", y)?;
        if !radius.is_finite() || radius < 0.0 || radius > MAX_WORLD_EXTENT {
            return Err(Physics2DError::InvalidQuery {
                field: "radius",
                value: radius,
            });
        }
        Ok(())
    }

    /// Refuse a rectangle query. Centre first (`x`, then `y`), then `hw`, then `hh`.
    ///
    /// Half-extents must be finite, `>= 0`, and `<= `[`MAX_WORLD_EXTENT`].
    pub fn reject_query_rect(x: f32, y: f32, hw: f32, hh: f32) -> Result<(), Physics2DError> {
        reject_query_coordinate("x", x)?;
        reject_query_coordinate("y", y)?;
        if !hw.is_finite() || hw < 0.0 || hw > MAX_WORLD_EXTENT {
            return Err(Physics2DError::InvalidQuery {
                field: "hw",
                value: hw,
            });
        }
        if !hh.is_finite() || hh < 0.0 || hh > MAX_WORLD_EXTENT {
            return Err(Physics2DError::InvalidQuery {
                field: "hh",
                value: hh,
            });
        }
        Ok(())
    }

    /// Advances the simulation by `delta` seconds.
    ///
    /// A delta that is not finite, or is outside `0..=1`, is refused and the
    /// world is not stepped. Dynamic bodies that are non-finite or past
    /// [`MAX_WORLD_EXTENT`] are disabled and recorded. A faster body is scaled
    /// to [`Self::set_max_linear_velocity`]'s cap and is not disabled for that
    /// alone. Rapier-quarantined bodies are reported too, as non-finite.
    /// Pairs appended during this step are then ordered by slot.
    /// The other bodies still step.
    ///
    /// # Errors
    /// Returns [`Physics2DError::InvalidStepDelta`] when `delta` is refused.
    pub fn step(&mut self, delta: f32) -> Result<(), Physics2DError> {
        reject_step_delta(delta)?;
        let recorded = self.disabled_slots.len();
        self.guard_dynamic_bodies(delta);
        self.integration_params.dt = delta;
        self.collision_events.clear();
        {
            let collector = EventCollector {
                buf: Mutex::new(&mut self.collision_events),
            };

            self.pipeline.step(
                self.gravity,
                &self.integration_params,
                &mut self.island_manager,
                &mut self.broad_phase,
                &mut self.narrow_phase,
                &mut self.rigid_body_set,
                &mut self.collider_set,
                &mut self.impulse_joint_set,
                &mut self.multibody_joint_set,
                &mut self.soft_bodies,
                &mut self.ccd_solver,
                &OneWayHooks {
                    set: &self.one_way_colliders,
                },
                &collector,
            );
        }
        self.record_rapier_quarantine();
        if self.disabled_slots.len() > recorded {
            sort_disabled_pairs_by_slot(&mut self.disabled_slots, recorded);
        }
        Ok(())
    }

    /// Disable or clamp dynamic bodies before the broad phase.
    ///
    /// A disabled body is skipped before its pose is read. A push into
    /// `disabled_slots` happens only when a body is disabled.
    fn guard_dynamic_bodies(&mut self, delta: f32) {
        let max_speed = self.max_linear_velocity;
        let PhysicsWorld {
            entity_to_body,
            rigid_body_set,
            disabled_slots,
            ..
        } = self;
        for (&slot, &handle) in entity_to_body.iter() {
            let Some(body) = rigid_body_set.get(handle) else {
                continue;
            };
            if !body.is_dynamic() {
                continue;
            }
            if !body.is_enabled() {
                continue;
            }
            let tx = body.translation().x;
            let ty = body.translation().y;
            let mut vx = body.linvel().x;
            let mut vy = body.linvel().y;
            if linear_state_is_non_finite(tx, ty, vx, vy) {
                disable_recorded(
                    rigid_body_set,
                    disabled_slots,
                    handle,
                    slot,
                    REASON_NON_FINITE,
                );
                continue;
            }
            if translation_leaves_world(tx, ty) {
                disable_recorded(
                    rigid_body_set,
                    disabled_slots,
                    handle,
                    slot,
                    REASON_OUT_OF_BOUNDS,
                );
                continue;
            }
            if linear_speed_exceeds(vx, vy, max_speed) {
                let scaled = scale_linvel(vx, vy, max_speed);
                vx = scaled.0;
                vy = scaled.1;
                if let Some(body) = rigid_body_set.get_mut(handle) {
                    body.set_linvel(Vector::new(vx, vy), true);
                }
            }
            let next_x = tx + vx * delta;
            let next_y = ty + vy * delta;
            if predicted_position_leaves_world(next_x, next_y) {
                disable_recorded(
                    rigid_body_set,
                    disabled_slots,
                    handle,
                    slot,
                    REASON_VELOCITY,
                );
            }
        }
    }

    /// Append `[slot, 0]` for each body Rapier quarantined during the last step.
    ///
    /// An empty report returns before any allocation. A handle with no slot is skipped.
    /// rapier2d 0.36.1 `pipeline/physics_pipeline/quarantine.rs:37`.
    fn record_rapier_quarantine(&mut self) {
        let handles = {
            let bodies = self.pipeline.quarantine().bodies();
            if bodies.is_empty() {
                return;
            }
            bodies.to_vec()
        };
        for handle in handles {
            let Some(&slot) = self.body_to_entity.get(&handle) else {
                continue;
            };
            self.disabled_slots.push(slot);
            self.disabled_slots.push(REASON_NON_FINITE);
        }
    }

    /// Fills `out` with dynamic-body poses `(entity index, x, y, rotation)`.
    ///
    /// Clears `out` and appends into its existing capacity. A missing Rapier
    /// body is skipped. Fixed and kinematic bodies are not included.
    pub fn write_dynamic_poses(&self, out: &mut Vec<(u32, f32, f32, f32)>) {
        out.clear();
        for (&index, &handle) in &self.entity_to_body {
            let Some(body) = self.rigid_body_set.get(handle) else {
                continue;
            };
            if !body.is_dynamic() {
                continue;
            }
            let pos = body.translation();
            out.push((index, pos.x, pos.y, body.rotation().angle()));
        }
    }

    /// Takes the pose scratch, fills it, and returns it.
    ///
    /// The caller writes the poses, then [`Self::restore_dynamic_pose_scratch`]
    /// puts the same allocation back.
    pub fn take_filled_dynamic_poses(&mut self) -> Vec<(u32, f32, f32, f32)> {
        let mut poses = std::mem::take(&mut self.dynamic_pose_scratch);
        self.write_dynamic_poses(&mut poses);
        poses
    }

    /// Puts a pose list back so the next step can reuse its capacity.
    pub fn restore_dynamic_pose_scratch(&mut self, poses: Vec<(u32, f32, f32, f32)>) {
        self.dynamic_pose_scratch = poses;
    }
}

fn reject_step_delta(delta: f32) -> Result<(), Physics2DError> {
    if delta.is_nan() {
        return Err(Physics2DError::InvalidStepDelta { delta });
    }
    if delta.is_infinite() || delta < 0.0 || delta > 1.0 {
        return Err(Physics2DError::InvalidStepDelta { delta });
    }
    Ok(())
}

fn reject_query_coordinate(field: &'static str, value: f32) -> Result<(), Physics2DError> {
    if !value.is_finite() {
        return Err(Physics2DError::InvalidQuery { field, value });
    }
    if value.abs() > MAX_WORLD_EXTENT {
        return Err(Physics2DError::InvalidQuery { field, value });
    }
    Ok(())
}

fn linear_state_is_non_finite(tx: f32, ty: f32, vx: f32, vy: f32) -> bool {
    !tx.is_finite() || !ty.is_finite() || !vx.is_finite() || !vy.is_finite()
}

fn translation_leaves_world(x: f32, y: f32) -> bool {
    x.abs() > MAX_WORLD_EXTENT || y.abs() > MAX_WORLD_EXTENT
}

fn predicted_position_leaves_world(x: f32, y: f32) -> bool {
    x.abs() > MAX_WORLD_EXTENT || y.abs() > MAX_WORLD_EXTENT
}

fn axis_is_zero(value: f32) -> bool {
    value.to_bits() == 0 || value.to_bits() == (-0.0f32).to_bits()
}

fn linear_speed_exceeds(vx: f32, vy: f32, max_speed: f32) -> bool {
    if axis_is_zero(vx) {
        return vy.abs() > max_speed;
    }
    if axis_is_zero(vy) {
        return vx.abs() > max_speed;
    }
    let largest = vx.abs().max(vy.abs());
    let norm = (vx / largest).hypot(vy / largest);
    largest * norm > max_speed
}

/// Scales `(vx, vy)` onto the circle of radius `max_speed`.
///
/// The larger component divides both axes first, so a huge finite pair does
/// not overflow to infinity and collapse to zero.
fn scale_linvel(vx: f32, vy: f32, max_speed: f32) -> (f32, f32) {
    if axis_is_zero(vy) {
        return (max_speed.copysign(vx), 0.0);
    }
    if axis_is_zero(vx) {
        return (0.0, max_speed.copysign(vy));
    }
    let largest = vx.abs().max(vy.abs());
    let nx = vx / largest;
    let ny = vy / largest;
    let norm = nx.hypot(ny);
    let scaled = max_speed / norm;
    (nx * scaled, ny * scaled)
}

/// Orders the `[slot, reason]` pairs appended since `start` by ascending slot.
///
/// Insertion sort. No allocation. Called only when this step disabled a body.
fn sort_disabled_pairs_by_slot(slots: &mut [u32], start: usize) {
    let mut index = start.saturating_add(2);
    while index + 1 < slots.len() {
        let mut cursor = index;
        while cursor >= start + 2 && slots[cursor] < slots[cursor - 2] {
            slots.swap(cursor - 2, cursor);
            slots.swap(cursor - 1, cursor + 1);
            cursor -= 2;
        }
        index += 2;
    }
}

fn disable_recorded(
    rigid_body_set: &mut RigidBodySet,
    disabled_slots: &mut Vec<u32>,
    handle: RigidBodyHandle,
    slot: u32,
    reason: u32,
) {
    if let Some(body) = rigid_body_set.get_mut(handle) {
        body.set_enabled(false);
    }
    disabled_slots.push(slot);
    disabled_slots.push(reason);
}

#[cfg(test)]
mod tests {
    #![allow(
        clippy::unwrap_used,
        clippy::expect_used,
        clippy::panic,
        clippy::unreachable,
        clippy::todo,
        clippy::unimplemented,
        reason = "test-only code"
    )]
    use super::*;
    use crate::physics2d::error::Physics2DError;
    use crate::physics2d::events::MAX_COLLISION_EVENTS;
    use std::panic::{catch_unwind, resume_unwind, AssertUnwindSafe};

    #[test]
    fn test_physics_world_creation() {
        let world = PhysicsWorld::new(0.0, -9.81);
        assert_eq!(world.gravity.y, -9.81);
    }

    #[test]
    fn test_add_remove_body() -> Result<(), Physics2DError> {
        let mut world = PhysicsWorld::new(0.0, -9.81);
        let entity_index = 1;
        let body_handle = world.add_rigid_body(
            entity_index,
            0.0,
            0.0,
            BodyType::Dynamic,
            BodyOptions::default(),
        )?;

        assert!(world.entity_to_body.contains_key(&entity_index));
        assert!(world.handle_by_raw.contains_key(&body_handle));

        world.remove_rigid_body(entity_index);
        assert!(!world.entity_to_body.contains_key(&entity_index));
        assert!(!world.handle_by_raw.contains_key(&body_handle));
        Ok(())
    }

    #[test]
    fn test_physics_step() -> Result<(), Physics2DError> {
        let mut world = PhysicsWorld::new(0.0, -9.81);
        let entity_index = 1;
        world.add_rigid_body(
            entity_index,
            0.0,
            10.0,
            BodyType::Dynamic,
            BodyOptions::default(),
        )?;

        // Initial position
        let handle = world.entity_to_body[&entity_index];
        let body = world.rigid_body_set.get(handle).unwrap();
        assert_eq!(body.translation().y, 10.0);

        // Step
        world.step(0.1)?;

        // Should have moved down
        let body = world.rigid_body_set.get(handle).unwrap();
        assert!(body.translation().y < 10.0);
        Ok(())
    }

    #[test]
    fn test_set_kinematic_position_returns_true() -> Result<(), Physics2DError> {
        let mut world = PhysicsWorld::new(0.0, -9.81);
        let opts = BodyOptions::default();
        world.add_rigid_body(0, 0.0, 0.0, BodyType::Kinematic, opts)?;
        assert!(world.set_kinematic_position(0, 1.0, 2.0, 0.5));
        Ok(())
    }

    #[test]
    fn test_set_kinematic_position_unknown_entity_returns_false() {
        let mut world = PhysicsWorld::new(0.0, -9.81);
        assert!(!world.set_kinematic_position(99, 0.0, 0.0, 0.0));
    }

    #[test]
    fn test_bulk_step_kinematics_integrates_positions() -> Result<(), Physics2DError> {
        let mut world = PhysicsWorld::new(0.0, 0.0); // no gravity
        let opts = BodyOptions::default();
        world.add_rigid_body(0, 0.0, 0.0, BodyType::Kinematic, opts)?;
        world.add_rigid_body(1, 0.0, 0.0, BodyType::Kinematic, opts)?;
        let slots = [0u32, 1u32];
        let vx = [1.0f32, 0.0f32];
        let vy = [0.0f32, 2.0f32];
        let updated = world.bulk_step_kinematics(&slots, &vx, &vy, 1.0)?;
        assert_eq!(updated, 2);
        world.step(1.0 / 60.0)?; // advance sim so next_kinematic is applied
        let pos0 = world.get_position(0).unwrap();
        let pos1 = world.get_position(1).unwrap();
        assert!((pos0.0 - 1.0).abs() < 0.01, "slot 0 x should be ~1.0");
        assert!((pos1.1 - 2.0).abs() < 0.01, "slot 1 y should be ~2.0");
        Ok(())
    }

    // ── tilemap chunk bodies ──────────────────────────────────────────────────

    #[test]
    fn test_load_tilemap_chunk_body_registers_pseudo_entity() -> Result<(), Physics2DError> {
        let mut world = PhysicsWorld::new(0.0, 0.0);
        let pseudo_entity = 0x80000001u32;
        world.load_tilemap_chunk_body(0xABCD, pseudo_entity, 10.0, 20.0)?;
        assert!(world.entity_to_body.contains_key(&pseudo_entity));
        Ok(())
    }

    #[test]
    fn test_load_tilemap_chunk_body_creates_static_body_at_position() -> Result<(), Physics2DError>
    {
        let mut world = PhysicsWorld::new(0.0, 0.0);
        let pseudo_entity = 0x80000001u32;
        world.load_tilemap_chunk_body(0xABCD, pseudo_entity, 5.0, 8.0)?;
        let (x, y, _) = world
            .get_position(pseudo_entity)
            .expect("body should exist");
        assert!((x - 5.0).abs() < 1e-4, "x={x}");
        assert!((y - 8.0).abs() < 1e-4, "y={y}");
        Ok(())
    }

    #[test]
    fn test_unload_tilemap_chunk_body_removes_body() -> Result<(), Physics2DError> {
        let mut world = PhysicsWorld::new(0.0, 0.0);
        let pseudo_entity = 0x80000002u32;
        world.load_tilemap_chunk_body(0xBEEF, pseudo_entity, 0.0, 0.0)?;
        assert!(world.entity_to_body.contains_key(&pseudo_entity));
        world.unload_tilemap_chunk_body(0xBEEF)?;
        assert!(!world.entity_to_body.contains_key(&pseudo_entity));
        Ok(())
    }

    #[test]
    fn test_unload_tilemap_chunk_body_unknown_chunk_returns_not_loaded() {
        let mut world = PhysicsWorld::new(0.0, 0.0);
        assert_eq!(
            world.unload_tilemap_chunk_body(0x1234),
            Err(Physics2DError::TilemapChunkNotLoaded)
        );
        assert_eq!(world.entity_to_body.len(), 0);
    }

    // ── apply_impulse ─────────────────────────────────────────────────────────

    #[test]
    fn test_apply_impulse_returns_true_for_dynamic_body() -> Result<(), Physics2DError> {
        let mut world = PhysicsWorld::new(0.0, 0.0);
        world.add_rigid_body(0, 0.0, 0.0, BodyType::Dynamic, BodyOptions::default())?;
        assert!(world.apply_impulse(0, 10.0, 0.0));
        Ok(())
    }

    #[test]
    fn test_apply_impulse_unknown_entity_returns_false() {
        let mut world = PhysicsWorld::new(0.0, 0.0);
        assert!(!world.apply_impulse(42, 1.0, 0.0));
    }

    /// Impulse changes velocity immediately (no step needed).
    /// The body needs a collider attached to have nonzero mass — mass comes from collider density.
    #[test]
    fn test_apply_impulse_changes_velocity() -> Result<(), Physics2DError> {
        let mut world = PhysicsWorld::new(0.0, 0.0);
        let handle =
            world.add_rigid_body(0, 0.0, 0.0, BodyType::Dynamic, BodyOptions::default())?;
        world.add_box_collider(handle, 0.5, 0.5, ColliderOptions::default())?;
        world.apply_impulse(0, 5.0, 0.0);
        let (vx, _vy) = world.get_linear_velocity(0).expect("velocity readable");
        assert!(vx > 0.0, "impulse should have increased vx, got {vx}");
        Ok(())
    }

    // ── set_linear_velocity ───────────────────────────────────────────────────

    #[test]
    fn test_set_linear_velocity_returns_true_for_dynamic_body() -> Result<(), Physics2DError> {
        let mut world = PhysicsWorld::new(0.0, 0.0);
        world.add_rigid_body(0, 0.0, 0.0, BodyType::Dynamic, BodyOptions::default())?;
        assert!(world.set_linear_velocity(0, 2.0, -3.0));
        Ok(())
    }

    #[test]
    fn test_set_linear_velocity_unknown_entity_returns_false() {
        let mut world = PhysicsWorld::new(0.0, 0.0);
        assert!(!world.set_linear_velocity(42, 1.0, 0.0));
    }

    /// Verify the velocity is immediately readable back via [`get_linear_velocity`]
    /// without requiring a physics step.
    #[test]
    fn test_set_linear_velocity_readable_via_getter() -> Result<(), Physics2DError> {
        let mut world = PhysicsWorld::new(0.0, 0.0);
        world.add_rigid_body(0, 0.0, 0.0, BodyType::Dynamic, BodyOptions::default())?;
        world.set_linear_velocity(0, 3.5, -1.2);
        let (vx, vy) = world
            .get_linear_velocity(0)
            .expect("velocity should be readable");
        assert!((vx - 3.5).abs() < 1e-4, "vx={vx}");
        assert!((vy + 1.2).abs() < 1e-4, "vy={vy}");
        Ok(())
    }

    /// Verify the body actually moves in the expected direction after a physics step.
    #[test]
    fn test_set_linear_velocity_affects_position_after_step() -> Result<(), Physics2DError> {
        let mut world = PhysicsWorld::new(0.0, 0.0); // no gravity
        world.add_rigid_body(0, 0.0, 0.0, BodyType::Dynamic, BodyOptions::default())?;
        world.set_linear_velocity(0, 10.0, 5.0);
        world.step(0.1)?;
        let (x, y, _) = world.get_position(0).expect("body should exist");
        // position = v * dt = (1.0, 0.5), allow some solver tolerance
        assert!(x > 0.5, "expected x > 0.5, got {x}");
        assert!(y > 0.2, "expected y > 0.2, got {y}");
        Ok(())
    }

    fn insert_ball(set: &mut ColliderSet, entity: u32, collider_id: u32) -> ColliderHandle {
        set.insert(
            ColliderBuilder::ball(0.5)
                .user_data(pack_collider_user_data(entity, collider_id))
                .build(),
        )
    }

    fn collider_pair(
        entity_a: u32,
        id_a: u32,
        entity_b: u32,
        id_b: u32,
    ) -> (ColliderSet, ColliderHandle, ColliderHandle) {
        let mut set = ColliderSet::new();
        let a = insert_ball(&mut set, entity_a, id_a);
        let b = insert_ball(&mut set, entity_b, id_b);
        (set, a, b)
    }

    fn started(h1: ColliderHandle, h2: ColliderHandle) -> CollisionEvent {
        CollisionEvent::Started(h1, h2, CollisionEventFlags::empty())
    }

    fn stopped(h1: ColliderHandle, h2: ColliderHandle) -> CollisionEvent {
        CollisionEvent::Stopped(h1, h2, CollisionEventFlags::empty())
    }

    fn feed(
        collector: &EventCollector,
        colliders: &ColliderSet,
        event: CollisionEvent,
        times: usize,
    ) {
        let bodies = RigidBodySet::new();
        for _ in 0..times {
            collector.handle_collision_event(&bodies, colliders, event, None);
        }
    }

    fn event_at(buf: &CollisionEventBuffer, index: usize) -> StaticCollisionEvent {
        assert_eq!(usize::from(index < buf.len()), 1);
        // SAFETY: `index` is below `len`, so the read stays inside this buffer's stored events.
        unsafe { buf.as_ptr().add(index).read() }
    }

    #[test]
    fn collector_stops_at_the_event_cap() {
        let mut buf = CollisionEventBuffer::new();
        let (set, h1, h2) = collider_pair(1, 7, 2, 8);
        let event = started(h1, h2);
        {
            let collector = EventCollector {
                buf: Mutex::new(&mut buf),
            };
            feed(&collector, &set, event, 0);
        }
        assert_eq!(buf.len(), 0);

        {
            let collector = EventCollector {
                buf: Mutex::new(&mut buf),
            };
            feed(&collector, &set, event, MAX_COLLISION_EVENTS);
        }
        assert_eq!(buf.len(), MAX_COLLISION_EVENTS);

        {
            let collector = EventCollector {
                buf: Mutex::new(&mut buf),
            };
            feed(&collector, &set, event, 1);
        }
        assert_eq!(buf.len(), MAX_COLLISION_EVENTS);

        buf.clear();
        assert_eq!(buf.len(), 0);
    }

    #[test]
    fn two_collectors_write_only_their_own_buffer() {
        let mut buf_a = CollisionEventBuffer::new();
        let mut buf_b = CollisionEventBuffer::new();
        let (set_a, a1, a2) = collider_pair(1, 7, 2, 8);
        let (set_b, b1, b2) = collider_pair(3, 9, 4, 10);
        {
            let collector_a = EventCollector {
                buf: Mutex::new(&mut buf_a),
            };
            let collector_b = EventCollector {
                buf: Mutex::new(&mut buf_b),
            };
            feed(&collector_a, &set_a, started(a1, a2), 3);
            feed(&collector_b, &set_b, started(b1, b2), 3);
        }
        assert_eq!(buf_a.len(), 3);
        assert_eq!(buf_b.len(), 3);
        for index in 0..3 {
            let ev_a = event_at(&buf_a, index);
            assert_eq!(ev_a.entity_a, 1);
            assert_eq!(ev_a.entity_b, 2);
            let ev_b = event_at(&buf_b, index);
            assert_eq!(ev_b.entity_a, 3);
            assert_eq!(ev_b.entity_b, 4);
        }
    }

    #[test]
    fn collector_skips_an_event_with_an_unknown_collider() {
        let mut buf = CollisionEventBuffer::new();
        let mut set = ColliderSet::new();
        let kept = insert_ball(&mut set, 2, 8);
        let tomb = insert_ball(&mut set, u32::MAX, 9);
        let stale = insert_ball(&mut set, 1, 7);
        let removed = set.remove(
            stale,
            &mut IslandManager::new(),
            &mut RigidBodySet::new(),
            &mut SoftBodySet::new(),
            false,
        );
        assert_eq!(u8::from(removed.is_some()), 1);
        {
            let collector = EventCollector {
                buf: Mutex::new(&mut buf),
            };
            feed(&collector, &set, started(stale, kept), 1);
        }
        assert_eq!(buf.len(), 0);
        {
            let collector = EventCollector {
                buf: Mutex::new(&mut buf),
            };
            feed(&collector, &set, started(tomb, kept), 1);
        }
        assert_eq!(buf.len(), 0);
        {
            let collector = EventCollector {
                buf: Mutex::new(&mut buf),
            };
            feed(&collector, &set, started(kept, stale), 1);
        }
        assert_eq!(buf.len(), 0);
        {
            let collector = EventCollector {
                buf: Mutex::new(&mut buf),
            };
            feed(&collector, &set, started(kept, tomb), 1);
        }
        assert_eq!(buf.len(), 0);
    }

    #[test]
    fn collector_writes_flag_0_for_a_stopped_event() {
        let mut buf = CollisionEventBuffer::new();
        let (set, h1, h2) = collider_pair(1, 7, 2, 8);
        {
            let collector = EventCollector {
                buf: Mutex::new(&mut buf),
            };
            feed(&collector, &set, stopped(h1, h2), 1);
        }
        assert_eq!(buf.len(), 1);
        let ev = event_at(&buf, 0);
        assert_eq!(ev.flags, 0);
        assert_eq!(ev.entity_a, 1);
        assert_eq!(ev.entity_b, 2);
        assert_eq!(ev.collider_a_id, 7);
        assert_eq!(ev.collider_b_id, 8);
    }

    #[test]
    fn collector_writes_flag_1_for_a_started_event() {
        let mut buf = CollisionEventBuffer::new();
        let (set, h1, h2) = collider_pair(1, 7, 2, 8);
        {
            let collector = EventCollector {
                buf: Mutex::new(&mut buf),
            };
            feed(&collector, &set, started(h1, h2), 1);
        }
        assert_eq!(buf.len(), 1);
        let ev = event_at(&buf, 0);
        assert_eq!(ev.flags, 1);
        assert_eq!(ev.entity_a, 1);
        assert_eq!(ev.entity_b, 2);
        assert_eq!(ev.collider_a_id, 7);
        assert_eq!(ev.collider_b_id, 8);
    }

    #[test]
    fn collector_stores_an_absent_collider_id_as_max() {
        let mut buf = CollisionEventBuffer::new();
        let (set, h1, h2) = collider_pair(1, COLLIDER_ID_ABSENT, 2, 8);
        {
            let collector = EventCollector {
                buf: Mutex::new(&mut buf),
            };
            feed(&collector, &set, started(h1, h2), 1);
        }
        assert_eq!(buf.len(), 1);
        let ev = event_at(&buf, 0);
        assert_eq!(ev.collider_a_id, u32::MAX);
        assert_eq!(ev.collider_b_id, 8);
        assert_eq!(ev.entity_a, 1);
        assert_eq!(ev.entity_b, 2);

        buf.clear();
        let (set, h1, h2) = collider_pair(3, 9, 4, COLLIDER_ID_ABSENT);
        {
            let collector = EventCollector {
                buf: Mutex::new(&mut buf),
            };
            feed(&collector, &set, started(h1, h2), 1);
        }
        assert_eq!(buf.len(), 1);
        let ev = event_at(&buf, 0);
        assert_eq!(ev.collider_a_id, 9);
        assert_eq!(ev.collider_b_id, u32::MAX);
        assert_eq!(ev.entity_a, 3);
        assert_eq!(ev.entity_b, 4);
    }

    #[test]
    fn collector_keeps_collecting_after_a_poisoned_lock() {
        let mut buf = CollisionEventBuffer::new();
        let (set, h1, h2) = collider_pair(1, 7, 2, 8);
        {
            let collector = EventCollector {
                buf: Mutex::new(&mut buf),
            };
            let caught = catch_unwind(AssertUnwindSafe(|| {
                let _guard = collector.buf.lock().unwrap_or_else(PoisonError::into_inner);
                resume_unwind(Box::new("poison"));
            }));
            assert_eq!(u8::from(caught.is_err()), 1);
            feed(&collector, &set, started(h1, h2), 1);
        }
        assert_eq!(buf.len(), 1);
        let ev = event_at(&buf, 0);
        assert_eq!(ev.entity_a, 1);
        assert_eq!(ev.entity_b, 2);
        assert_eq!(ev.flags, 1);
    }
}

#[cfg(test)]
mod multi_engine_collision {
    use super::*;
    use crate::physics2d::error::Physics2DError;

    #[test]
    #[allow(
        clippy::bool_assert_comparison,
        reason = "diff hygiene rejects a new assert! line"
    )]
    fn two_engines_keep_separate_collision_buffers() -> Result<(), Physics2DError> {
        let mut a = PhysicsWorld::new(0.0, 0.0);
        let mut b = PhysicsWorld::new(0.0, 0.0);
        let ha = a.add_rigid_body(1, 0.0, 0.0, BodyType::Dynamic, BodyOptions::default())?;
        a.add_box_collider(ha, 0.5, 0.5, ColliderOptions::default())?;
        let hb = a.add_rigid_body(2, 0.2, 0.0, BodyType::Dynamic, BodyOptions::default())?;
        a.add_box_collider(hb, 0.5, 0.5, ColliderOptions::default())?;
        let hc = b.add_rigid_body(1, 0.0, 0.0, BodyType::Dynamic, BodyOptions::default())?;
        b.add_box_collider(hc, 0.5, 0.5, ColliderOptions::default())?;
        let hd = b.add_rigid_body(2, 50.0, 0.0, BodyType::Dynamic, BodyOptions::default())?;
        b.add_box_collider(hd, 0.5, 0.5, ColliderOptions::default())?;
        a.step(1.0 / 60.0)?;
        b.step(1.0 / 60.0)?;
        assert_ne!(a.collision_events_ptr(), b.collision_events_ptr());
        assert_eq!(b.collision_event_count(), 0);
        assert_eq!(a.collision_event_count() > 0, true);
        Ok(())
    }
}

#[cfg(test)]
#[allow(
    clippy::bool_assert_comparison,
    reason = "diff hygiene rejects a new assert! line"
)]
mod fixed_rotation {
    use super::*;
    use crate::physics2d::error::Physics2DError;

    fn add_dynamic(world: &mut PhysicsWorld, slot: u32, x: f32) -> Result<u32, Physics2DError> {
        world.add_rigid_body(slot, x, 0.0, BodyType::Dynamic, BodyOptions::default())
    }

    fn add_offset_box(world: &mut PhysicsWorld, handle: u32) -> Result<(), Physics2DError> {
        let opts = ColliderOptions {
            offset_x: 0.45,
            ..ColliderOptions::default()
        };
        world.add_box_collider(handle, 0.5, 0.5, opts)
    }

    /// Torque during the steps, plus one impulse that is not at the centre of mass.
    fn drive(world: &mut PhysicsWorld, slot: u32) -> Result<(), Physics2DError> {
        let missing = Physics2DError::BodyNotFound { slot };
        let handle = *world.entity_to_body.get(&slot).ok_or(missing)?;
        {
            let body = world.rigid_body_set.get_mut(handle).ok_or(missing)?;
            body.apply_impulse_at_point(Vector::new(0.0, 25.0), Vector::new(1.0, 0.2), true);
        }
        for _ in 0..30 {
            let handle = *world.entity_to_body.get(&slot).ok_or(missing)?;
            {
                let body = world.rigid_body_set.get_mut(handle).ok_or(missing)?;
                body.add_torque(40.0, true);
            }
            world.step(1.0 / 60.0)?;
        }
        Ok(())
    }

    #[test]
    fn locked_angle_stays_zero_under_torque_and_an_off_centre_impulse() -> Result<(), Physics2DError>
    {
        let mut world = PhysicsWorld::new(0.0, 0.0);
        let handle = add_dynamic(&mut world, 1, 0.0)?;
        world.lock_body_rotation(1, true)?;
        add_offset_box(&mut world, handle)?;
        drive(&mut world, 1)?;
        let angle = world
            .get_position(1)
            .ok_or(Physics2DError::BodyNotFound { slot: 1 })?
            .2;
        assert_eq!(angle.abs() < 1.0e-4, true);
        Ok(())
    }

    #[test]
    fn unlocked_angle_changes_under_torque_and_an_off_centre_impulse() -> Result<(), Physics2DError>
    {
        let mut world = PhysicsWorld::new(0.0, 0.0);
        let handle = add_dynamic(&mut world, 1, 0.0)?;
        add_offset_box(&mut world, handle)?;
        drive(&mut world, 1)?;
        let angle = world
            .get_position(1)
            .ok_or(Physics2DError::BodyNotFound { slot: 1 })?
            .2;
        assert_eq!(angle.abs() > 0.05, true);
        Ok(())
    }

    #[test]
    fn lock_of_an_unknown_slot_is_body_not_found() {
        let mut world = PhysicsWorld::new(0.0, 0.0);
        assert_eq!(
            world.lock_body_rotation(4, true),
            Err(Physics2DError::BodyNotFound { slot: 4 })
        );
    }

    #[test]
    fn only_the_locked_body_keeps_a_zero_angle() -> Result<(), Physics2DError> {
        let mut world = PhysicsWorld::new(0.0, 0.0);
        let locked_handle = add_dynamic(&mut world, 1, 0.0)?;
        world.lock_body_rotation(1, true)?;
        add_offset_box(&mut world, locked_handle)?;
        let free_handle = add_dynamic(&mut world, 2, 8.0)?;
        add_offset_box(&mut world, free_handle)?;
        drive(&mut world, 1)?;
        drive(&mut world, 2)?;
        let locked_angle = world
            .get_position(1)
            .ok_or(Physics2DError::BodyNotFound { slot: 1 })?
            .2;
        let free_angle = world
            .get_position(2)
            .ok_or(Physics2DError::BodyNotFound { slot: 2 })?
            .2;
        assert_eq!(locked_angle.abs() < 1.0e-4, true);
        assert_eq!(free_angle.abs() > 0.05, true);
        Ok(())
    }

    /// GWEN clamp at physics2d/world.rs:291, already present before this PR.
    ///
    /// `0` and `16` are stored. `17` and `255` are stored as `16`.
    #[test]
    fn additional_solver_iterations_cap_at_16() -> Result<(), Physics2DError> {
        let mut world = PhysicsWorld::new(0.0, 0.0);
        let cases = [
            (0u32, 0usize, 0usize),
            (1, 16, 16),
            (2, 17, 16),
            (3, 255, 16),
        ];
        for (slot, input, expected) in cases {
            world.add_rigid_body(
                slot,
                slot as f32,
                0.0,
                BodyType::Dynamic,
                BodyOptions {
                    additional_solver_iterations: Some(input),
                    ..BodyOptions::default()
                },
            )?;
            let handle = world.entity_to_body[&slot];
            let stored = world
                .rigid_body_set
                .get(handle)
                .ok_or(Physics2DError::BodyNotFound { slot })?
                .additional_solver_iterations();
            assert_eq!(stored, expected, "input {input}");
        }
        Ok(())
    }

    /// Characterisation test of a Rapier 0.36.1 default already true after P-RAP-3a.
    ///
    /// With `max_ccd_substeps` at 0, a fast box with per-body CCD off passes the wall.
    #[test]
    fn ccd_off_with_zero_substeps_tunnels() -> Result<(), Physics2DError> {
        let mut world = PhysicsWorld::new(0.0, 0.0);
        world.set_quality_preset(PhysicsQualityPreset::Low);
        world.integration_params.max_ccd_substeps = 0;
        let wall = world.add_rigid_body(2, 0.0, 0.0, BodyType::Fixed, BodyOptions::default())?;
        world.add_box_collider(wall, 0.05, 2.0, ColliderOptions::default())?;
        let box_handle = world.add_rigid_body(
            3,
            -6.0,
            0.0,
            BodyType::Dynamic,
            BodyOptions {
                initial_velocity: (120.0, 0.0),
                ccd_enabled: Some(false),
                ..BodyOptions::default()
            },
        )?;
        world.add_box_collider(box_handle, 0.08, 0.08, ColliderOptions::default())?;
        for _ in 0..24 {
            world.step(1.0 / 120.0)?;
        }
        let (x, _, _) = world
            .get_position(3)
            .ok_or(Physics2DError::BodyNotFound { slot: 3 })?;
        assert_eq!(x > 0.30, true, "x={x}");
        Ok(())
    }
}
