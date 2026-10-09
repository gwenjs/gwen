//! PhysicsWorld — Rapier2D pipeline + ECS mapping.
//!
//! Encapsulates the full Rapier2D simulation state and maintains a
//! bidirectional mapping between GWEN entity indices (u32) and Rapier
//! `RigidBodyHandle`s.

use crate::ecs::storage::ArchetypeStorage;
use crate::physics2d::components::{BodyOptions, BodyType, ColliderOptions};
use crate::physics2d::events::{CollisionEventBuffer, PhysicsCollisionEvent as StaticCollisionEvent};
use rapier2d::prelude::*;
use std::collections::{HashMap, HashSet};
use std::num::NonZeroUsize;

const COLLIDER_ID_ABSENT: u32 = u32::MAX;
const MAX_BODY_ADDITIONAL_SOLVER_ITERATIONS: usize = 16;

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

/// Pointer valid only for the synchronous `step` on this thread.
struct CollisionBufPtr(*mut CollisionEventBuffer);

// SAFETY: Rapier invokes the handler on the thread that called `step`.
// The pointer is dropped before `step` returns and is not shared.
unsafe impl Send for CollisionBufPtr {}
unsafe impl Sync for CollisionBufPtr {}

struct EventCollector {
    buf: CollisionBufPtr,
}

impl EventHandler for EventCollector {
    fn handle_collision_event(
        &self,
        _bodies: &RigidBodySet,
        colliders: &ColliderSet,
        event: CollisionEvent,
        _contact_pair: Option<&ContactPair>,
    ) {
        let (ea, ca) = colliders
            .get(event.collider1())
            .map(|c| unpack_collider_user_data(c.user_data))
            .unwrap_or((u32::MAX, None));
        let (eb, cb) = colliders
            .get(event.collider2())
            .map(|c| unpack_collider_user_data(c.user_data))
            .unwrap_or((u32::MAX, None));

        if ea == u32::MAX || eb == u32::MAX {
            return;
        }

        let collider_a_id = ca.unwrap_or(u32::MAX);
        let collider_b_id = cb.unwrap_or(u32::MAX);
        // SAFETY: `buf` points at this world's buffer and is exclusive for the step.
        unsafe {
            (*self.buf.0).push(StaticCollisionEvent {
                entity_a: ea,
                entity_b: eb,
                collider_a_id,
                collider_b_id,
                flags: if event.started() { 1 } else { 0 },
            });
        }
    }

    fn handle_contact_force_event(
        &self,
        _dt: f32,
        _bodies: &RigidBodySet,
        _colliders: &ColliderSet,
        _contact_pair: &ContactPair,
        _total_force_magnitude: f32,
    ) {}
}

// ─── PhysicsWorld ─────────────────────────────────────────────────────────────

/// Manages the 2D physics simulation and its integration with the ECS.
pub struct PhysicsWorld {
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
    query_pipeline: QueryPipeline,

    pub entity_to_body: HashMap<u32, RigidBodyHandle>,
    pub body_to_entity: HashMap<RigidBodyHandle, u32>,
    handle_by_raw: HashMap<u32, RigidBodyHandle>,
    /// Maps tilemap chunk IDs to their pseudo-entity indices for unload/lookup.
    tilemap_chunk_to_entity: HashMap<u32, u32>,
    quality_preset: PhysicsQualityPreset,
    global_ccd_enabled: bool,
    pub one_way_colliders: HashSet<ColliderHandle>,
    collision_events: CollisionEventBuffer,
}

struct OneWayHooks<'a> {
    set: &'a HashSet<ColliderHandle>,
}

impl PhysicsHooks for OneWayHooks<'_> {
    fn modify_solver_contacts(&self, context: &mut ContactModificationContext) {
        let is_c1 = self.set.contains(&context.collider1);
        let is_c2 = self.set.contains(&context.collider2);
        if !is_c1 && !is_c2 { return; }
        // Platform is c1 → allowed_local_n1 = +Y (normal points up from platform toward character)
        // Platform is c2 → allowed_local_n1 = -Y (local_n1 is from c1/character perspective, points down)
        let allowed = if is_c1 { Vector::y() } else { -Vector::y() };
        context.update_as_oneway_platform(&allowed, std::f32::consts::FRAC_PI_4);
    }
}

impl PhysicsWorld {
    /// Creates a new PhysicsWorld with the given gravity.
    pub fn new(gravity_x: f32, gravity_y: f32) -> Self {
        let mut world = PhysicsWorld {
            pipeline: PhysicsPipeline::new(),
            gravity: vector![gravity_x, gravity_y],
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
            entity_to_body: HashMap::new(),
            body_to_entity: HashMap::new(),
            handle_by_raw: HashMap::new(),
            tilemap_chunk_to_entity: HashMap::new(),
            quality_preset: PhysicsQualityPreset::Medium,
            global_ccd_enabled: false,
            one_way_colliders: HashSet::new(),
            collision_events: CollisionEventBuffer::new(),
        };
        world.set_quality_preset(PhysicsQualityPreset::Medium);
        world
    }

    /// Sets the quality preset for the simulation.
    pub fn set_quality_preset(&mut self, preset: PhysicsQualityPreset) {
        self.quality_preset = preset;
        let cfg = quality_solver_config(preset);
        self.integration_params.num_solver_iterations =
            NonZeroUsize::new(cfg.num_solver_iterations).unwrap_or(NonZeroUsize::MIN);
        self.integration_params.num_internal_stabilization_iterations =
            cfg.num_internal_stabilization_iterations;
        self.integration_params.max_ccd_substeps = cfg.max_ccd_substeps;
    }

    /// Adds a rigid body to the simulation.
    pub fn add_rigid_body(
        &mut self,
        entity_index: u32,
        x: f32,
        y: f32,
        body_type: BodyType,
        opts: BodyOptions,
    ) -> u32 {
        self.remove_rigid_body(entity_index);

        let mut builder = match body_type {
            BodyType::Fixed => RigidBodyBuilder::fixed(),
            BodyType::Dynamic => RigidBodyBuilder::dynamic()
                .additional_mass(opts.mass)
                .sleeping(false),
            BodyType::Kinematic => RigidBodyBuilder::kinematic_position_based(),
        };

        builder = builder
            .translation(vector![x, y])
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
                rb.set_linvel(vector![vx, vy], true);
            }
        }

        let handle = self.rigid_body_set.insert(rb);
        let raw = handle.0.into_raw_parts().0;

        self.entity_to_body.insert(entity_index, handle);
        self.body_to_entity.insert(handle, entity_index);
        self.handle_by_raw.insert(raw, handle);

        raw
    }

    /// Adds a box collider to an existing rigid body.
    pub fn add_box_collider(
        &mut self,
        body_handle_raw: u32,
        hw: f32,
        hh: f32,
        opts: ColliderOptions,
    ) {
        if let Some(handle) = self.handle_by_raw.get(&body_handle_raw).copied() {
            let entity_index = self.body_to_entity.get(&handle).copied().unwrap_or(u32::MAX);
            let groups = rapier2d::geometry::Group::from_bits_truncate(opts.groups.membership).into();
            let filter = rapier2d::geometry::Group::from_bits_truncate(opts.groups.filter).into();
            let builder = ColliderBuilder::cuboid(hw, hh)
                .translation(vector![opts.offset_x, opts.offset_y])
                .restitution(opts.material.restitution)
                .friction(opts.material.friction)
                .density(opts.density)
                .sensor(opts.is_sensor)
                .collision_groups(rapier2d::geometry::InteractionGroups::new(groups, filter))
                .user_data(pack_collider_user_data(entity_index, opts.collider_id))
                .active_events(ActiveEvents::COLLISION_EVENTS)
                .active_hooks(if opts.is_one_way { ActiveHooks::MODIFY_SOLVER_CONTACTS } else { ActiveHooks::empty() });
            let collider = builder.build();
            let handle = self.collider_set.insert_with_parent(collider, handle, &mut self.rigid_body_set);
            if opts.is_one_way {
                self.one_way_colliders.insert(handle);
            }
        }
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
                true,
            );
        }
    }

    /// Adds a ball collider to an existing rigid body.
    pub fn add_ball_collider(
        &mut self,
        body_handle_raw: u32,
        radius: f32,
        opts: ColliderOptions,
    ) {
        if let Some(handle) = self.handle_by_raw.get(&body_handle_raw).copied() {
            let entity_index = self.body_to_entity.get(&handle).copied().unwrap_or(u32::MAX);
            let groups = rapier2d::geometry::Group::from_bits_truncate(opts.groups.membership).into();
            let filter = rapier2d::geometry::Group::from_bits_truncate(opts.groups.filter).into();
            let builder = ColliderBuilder::ball(radius)
                .translation(vector![opts.offset_x, opts.offset_y])
                .restitution(opts.material.restitution)
                .friction(opts.material.friction)
                .density(opts.density)
                .sensor(opts.is_sensor)
                .collision_groups(rapier2d::geometry::InteractionGroups::new(groups, filter))
                .user_data(pack_collider_user_data(entity_index, opts.collider_id))
                .active_events(ActiveEvents::COLLISION_EVENTS)
                .active_hooks(if opts.is_one_way { ActiveHooks::MODIFY_SOLVER_CONTACTS } else { ActiveHooks::empty() });
            let collider = builder.build();
            let collider_handle = self.collider_set.insert_with_parent(collider, handle, &mut self.rigid_body_set);
            if opts.is_one_way {
                self.one_way_colliders.insert(collider_handle);
            }
        }
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
        body.set_linvel(vector![vx, vy], true);
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
        body.apply_impulse(vector![ix, iy], true);
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
        let iso = Isometry::new(vector![x, y], angle);
        body.set_next_kinematic_position(iso);
        true
    }

    /// Integrate the positions of N kinematic bodies in one pass.
    ///
    /// For each body at index `i`, computes:
    /// `new_pos = current_pos + (vx[i], vy[i]) * dt`
    /// and calls [`set_next_kinematic_position`] with the preserved current angle.
    ///
    /// Lengths of `slots`, `vx`, and `vy` must be equal; any trailing mismatch
    /// is silently ignored. Bodies not found by their slot are skipped.
    ///
    /// # Returns
    /// Number of bodies actually updated.
    pub fn bulk_step_kinematics(
        &mut self,
        slots: &[u32],
        vx: &[f32],
        vy: &[f32],
        dt: f32,
    ) -> u32 {
        let count = slots.len().min(vx.len()).min(vy.len());
        let mut updated = 0u32;
        for i in 0..count {
            let Some(&handle) = self.entity_to_body.get(&slots[i]) else {
                continue;
            };
            let Some(body) = self.rigid_body_set.get_mut(handle) else {
                continue;
            };
            let pos = *body.position();
            let new_x = pos.translation.x + vx[i] * dt;
            let new_y = pos.translation.y + vy[i] * dt;
            let iso = Isometry::new(
                vector![new_x, new_y],
                pos.rotation.angle(),
            );
            body.set_next_kinematic_position(iso);
            updated += 1;
        }
        updated
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
    pub fn load_tilemap_chunk_body(
        &mut self,
        chunk_id: u32,
        pseudo_entity: u32,
        x: f32,
        y: f32,
    ) -> u32 {
        let handle_raw = self.add_rigid_body(pseudo_entity, x, y, BodyType::Fixed, BodyOptions::default());
        self.tilemap_chunk_to_entity.insert(chunk_id, pseudo_entity);
        handle_raw
    }

    /// Remove the static rigid body associated with a tilemap chunk.
    ///
    /// Removes the body and all attached colliders from the simulation.
    /// A no-op if the chunk has not been loaded.
    ///
    /// # Parameters
    /// * `chunk_id` — Unique chunk identifier previously passed to [`load_tilemap_chunk_body`].
    pub fn unload_tilemap_chunk_body(&mut self, chunk_id: u32) {
        if let Some(pseudo_entity) = self.tilemap_chunk_to_entity.remove(&chunk_id) {
            self.remove_rigid_body(pseudo_entity);
        }
    }

    pub fn query_radius(&self, x: f32, y: f32, radius: f32, membership: u32, filter: u32) -> Vec<u32> {
        self.intersect_shape(&Ball::new(radius), Isometry::translation(x, y), membership, filter)
    }

    pub fn query_rect(&self, x: f32, y: f32, hw: f32, hh: f32, membership: u32, filter: u32) -> Vec<u32> {
        self.intersect_shape(&Cuboid::new(vector![hw, hh]), Isometry::translation(x, y), membership, filter)
    }

    pub fn point_query(&self, x: f32, y: f32, membership: u32, filter: u32) -> Vec<u32> {
        let qf = Self::make_query_filter(membership, filter);
        let mut results = Vec::new();
        self.query_pipeline.intersections_with_point(
            &self.rigid_body_set, &self.collider_set, &Point::new(x, y), qf,
            |handle| { self.collect_entity(handle, &mut results); true },
        );
        results
    }

    fn intersect_shape(&self, shape: &dyn Shape, pos: Isometry<f32>, membership: u32, filter: u32) -> Vec<u32> {
        let qf = Self::make_query_filter(membership, filter);
        let mut results = Vec::new();
        self.query_pipeline.intersections_with_shape(
            &self.rigid_body_set, &self.collider_set, &pos, shape, qf,
            |handle| { self.collect_entity(handle, &mut results); true },
        );
        results
    }

    #[inline]
    fn make_query_filter(membership: u32, filter: u32) -> QueryFilter<'static> {
        QueryFilter::new().groups(InteractionGroups::new(
            Group::from_bits_truncate(membership),
            Group::from_bits_truncate(filter),
        ))
    }

    #[inline]
    fn collect_entity(&self, handle: ColliderHandle, results: &mut Vec<u32>) {
        if let Some(c) = self.collider_set.get(handle) {
            let (idx, _) = unpack_collider_user_data(c.user_data);
            if idx != u32::MAX { results.push(idx); }
        }
    }

    pub fn collision_events_ptr(&self) -> *const StaticCollisionEvent {
        self.collision_events.as_ptr()
    }

    pub fn collision_event_count(&self) -> u32 {
        self.collision_events.len() as u32
    }

    /// Advances the simulation by `delta` seconds.
    pub fn step(&mut self, delta: f32) {
        self.integration_params.dt = delta;
        self.collision_events.clear();
        let buf = CollisionBufPtr(std::ptr::addr_of_mut!(self.collision_events));

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
            Some(&mut self.query_pipeline),
            &OneWayHooks { set: &self.one_way_colliders },
            &EventCollector { buf },
        );
    }

    /// Syncs dynamic body positions from Rapier to the ArchetypeStorage.
    pub fn sync_to_storage(&self, storage: &mut ArchetypeStorage) {
        for (&entity_index, &handle) in &self.entity_to_body {
            if let Some(body) = self.rigid_body_set.get(handle) {
                if body.is_dynamic() {
                    let pos = body.translation();
                    let rot = body.rotation().angle();

                    // Update transform in storage.
                    // Assuming transform is stored as [f32; 5] (x, y, rot, sx, sy)
                    if let Some(data) = storage.get_component_mut(entity_index, crate::ecs::component::ComponentTypeId::from_raw(u32::MAX - 1)) {
                        if data.len() >= 12 {
                            data[0..4].copy_from_slice(&pos.x.to_le_bytes());
                            data[4..8].copy_from_slice(&pos.y.to_le_bytes());
                            data[8..12].copy_from_slice(&rot.to_le_bytes());
                        }
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_physics_world_creation() {
        let world = PhysicsWorld::new(0.0, -9.81);
        assert_eq!(world.gravity.y, -9.81);
    }

    #[test]
    fn test_add_remove_body() {
        let mut world = PhysicsWorld::new(0.0, -9.81);
        let entity_index = 1;
        let body_handle = world.add_rigid_body(entity_index, 0.0, 0.0, BodyType::Dynamic, BodyOptions::default());

        assert!(world.entity_to_body.contains_key(&entity_index));
        assert!(world.handle_by_raw.contains_key(&body_handle));

        world.remove_rigid_body(entity_index);
        assert!(!world.entity_to_body.contains_key(&entity_index));
        assert!(!world.handle_by_raw.contains_key(&body_handle));
    }

    #[test]
    fn test_physics_step() {
        let mut world = PhysicsWorld::new(0.0, -9.81);
        let entity_index = 1;
        world.add_rigid_body(entity_index, 0.0, 10.0, BodyType::Dynamic, BodyOptions::default());

        // Initial position
        let handle = world.entity_to_body[&entity_index];
        let body = world.rigid_body_set.get(handle).unwrap();
        assert_eq!(body.translation().y, 10.0);

        // Step
        world.step(0.1);

        // Should have moved down
        let body = world.rigid_body_set.get(handle).unwrap();
        assert!(body.translation().y < 10.0);
    }

    #[test]
    fn test_set_kinematic_position_returns_true() {
        let mut world = PhysicsWorld::new(0.0, -9.81);
        let opts = BodyOptions::default();
        world.add_rigid_body(0, 0.0, 0.0, BodyType::Kinematic, opts);
        assert!(world.set_kinematic_position(0, 1.0, 2.0, 0.5));
    }

    #[test]
    fn test_set_kinematic_position_unknown_entity_returns_false() {
        let mut world = PhysicsWorld::new(0.0, -9.81);
        assert!(!world.set_kinematic_position(99, 0.0, 0.0, 0.0));
    }

    #[test]
    fn test_bulk_step_kinematics_integrates_positions() {
        let mut world = PhysicsWorld::new(0.0, 0.0); // no gravity
        let opts = BodyOptions::default();
        world.add_rigid_body(0, 0.0, 0.0, BodyType::Kinematic, opts.clone());
        world.add_rigid_body(1, 0.0, 0.0, BodyType::Kinematic, opts);
        let slots = [0u32, 1u32];
        let vx = [1.0f32, 0.0f32];
        let vy = [0.0f32, 2.0f32];
        let updated = world.bulk_step_kinematics(&slots, &vx, &vy, 1.0);
        assert_eq!(updated, 2);
        world.step(1.0 / 60.0); // advance sim so next_kinematic is applied
        let pos0 = world.get_position(0).unwrap();
        let pos1 = world.get_position(1).unwrap();
        assert!((pos0.0 - 1.0).abs() < 0.01, "slot 0 x should be ~1.0");
        assert!((pos1.1 - 2.0).abs() < 0.01, "slot 1 y should be ~2.0");
    }

    // ── tilemap chunk bodies ──────────────────────────────────────────────────

    #[test]
    fn test_load_tilemap_chunk_body_registers_pseudo_entity() {
        let mut world = PhysicsWorld::new(0.0, 0.0);
        let pseudo_entity = 0x80000001u32;
        world.load_tilemap_chunk_body(0xABCD, pseudo_entity, 10.0, 20.0);
        assert!(world.entity_to_body.contains_key(&pseudo_entity));
    }

    #[test]
    fn test_load_tilemap_chunk_body_creates_static_body_at_position() {
        let mut world = PhysicsWorld::new(0.0, 0.0);
        let pseudo_entity = 0x80000001u32;
        world.load_tilemap_chunk_body(0xABCD, pseudo_entity, 5.0, 8.0);
        let (x, y, _) = world.get_position(pseudo_entity).expect("body should exist");
        assert!((x - 5.0).abs() < 1e-4, "x={x}");
        assert!((y - 8.0).abs() < 1e-4, "y={y}");
    }

    #[test]
    fn test_unload_tilemap_chunk_body_removes_body() {
        let mut world = PhysicsWorld::new(0.0, 0.0);
        let pseudo_entity = 0x80000002u32;
        world.load_tilemap_chunk_body(0xBEEF, pseudo_entity, 0.0, 0.0);
        assert!(world.entity_to_body.contains_key(&pseudo_entity));
        world.unload_tilemap_chunk_body(0xBEEF);
        assert!(!world.entity_to_body.contains_key(&pseudo_entity));
    }

    #[test]
    fn test_unload_tilemap_chunk_body_unknown_chunk_is_noop() {
        let mut world = PhysicsWorld::new(0.0, 0.0);
        world.unload_tilemap_chunk_body(0x1234); // should not panic
    }

    // ── apply_impulse ─────────────────────────────────────────────────────────

    #[test]
    fn test_apply_impulse_returns_true_for_dynamic_body() {
        let mut world = PhysicsWorld::new(0.0, 0.0);
        world.add_rigid_body(0, 0.0, 0.0, BodyType::Dynamic, BodyOptions::default());
        assert!(world.apply_impulse(0, 10.0, 0.0));
    }

    #[test]
    fn test_apply_impulse_unknown_entity_returns_false() {
        let mut world = PhysicsWorld::new(0.0, 0.0);
        assert!(!world.apply_impulse(42, 1.0, 0.0));
    }

    /// Impulse changes velocity immediately (no step needed).
    /// The body needs a collider attached to have nonzero mass — mass comes from collider density.
    #[test]
    fn test_apply_impulse_changes_velocity() {
        let mut world = PhysicsWorld::new(0.0, 0.0);
        let handle = world.add_rigid_body(0, 0.0, 0.0, BodyType::Dynamic, BodyOptions::default());
        world.add_box_collider(handle, 0.5, 0.5, ColliderOptions::default());
        world.apply_impulse(0, 5.0, 0.0);
        let (vx, _vy) = world.get_linear_velocity(0).expect("velocity readable");
        assert!(vx > 0.0, "impulse should have increased vx, got {vx}");
    }

    // ── set_linear_velocity ───────────────────────────────────────────────────

    #[test]
    fn test_set_linear_velocity_returns_true_for_dynamic_body() {
        let mut world = PhysicsWorld::new(0.0, 0.0);
        world.add_rigid_body(0, 0.0, 0.0, BodyType::Dynamic, BodyOptions::default());
        assert!(world.set_linear_velocity(0, 2.0, -3.0));
    }

    #[test]
    fn test_set_linear_velocity_unknown_entity_returns_false() {
        let mut world = PhysicsWorld::new(0.0, 0.0);
        assert!(!world.set_linear_velocity(42, 1.0, 0.0));
    }

    /// Verify the velocity is immediately readable back via [`get_linear_velocity`]
    /// without requiring a physics step.
    #[test]
    fn test_set_linear_velocity_readable_via_getter() {
        let mut world = PhysicsWorld::new(0.0, 0.0);
        world.add_rigid_body(0, 0.0, 0.0, BodyType::Dynamic, BodyOptions::default());
        world.set_linear_velocity(0, 3.5, -1.2);
        let (vx, vy) = world.get_linear_velocity(0).expect("velocity should be readable");
        assert!((vx - 3.5).abs() < 1e-4, "vx={vx}");
        assert!((vy + 1.2).abs() < 1e-4, "vy={vy}");
    }

    /// Verify the body actually moves in the expected direction after a physics step.
    #[test]
    fn test_set_linear_velocity_affects_position_after_step() {
        let mut world = PhysicsWorld::new(0.0, 0.0); // no gravity
        world.add_rigid_body(0, 0.0, 0.0, BodyType::Dynamic, BodyOptions::default());
        world.set_linear_velocity(0, 10.0, 5.0);
        world.step(0.1);
        let (x, y, _) = world.get_position(0).expect("body should exist");
        // position = v * dt = (1.0, 0.5), allow some solver tolerance
        assert!(x > 0.5, "expected x > 0.5, got {x}");
        assert!(y > 0.2, "expected y > 0.2, got {y}");
    }
}

#[cfg(test)]
mod multi_engine_collision {
    use super::*;

    #[test]
    fn two_engines_keep_separate_collision_buffers() {
        let mut a = PhysicsWorld::new(0.0, 0.0);
        let mut b = PhysicsWorld::new(0.0, 0.0);
        let ha = a.add_rigid_body(1, 0.0, 0.0, BodyType::Dynamic, BodyOptions::default());
        a.add_box_collider(ha, 0.5, 0.5, ColliderOptions::default());
        let hb = a.add_rigid_body(2, 0.2, 0.0, BodyType::Dynamic, BodyOptions::default());
        a.add_box_collider(hb, 0.5, 0.5, ColliderOptions::default());
        let hc = b.add_rigid_body(1, 0.0, 0.0, BodyType::Dynamic, BodyOptions::default());
        b.add_box_collider(hc, 0.5, 0.5, ColliderOptions::default());
        let hd = b.add_rigid_body(2, 50.0, 0.0, BodyType::Dynamic, BodyOptions::default());
        b.add_box_collider(hd, 0.5, 0.5, ColliderOptions::default());
        a.step(1.0 / 60.0);
        b.step(1.0 / 60.0);
        assert_eq!(a.collision_events_ptr() == b.collision_events_ptr(), false);
        assert_eq!(b.collision_event_count(), 0);
        assert_eq!(a.collision_event_count() > 0, true);
    }
}
