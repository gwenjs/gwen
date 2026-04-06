//! PhysicsWorld — Rapier2D pipeline + ECS mapping.
//!
//! Encapsulates the full Rapier2D simulation state and maintains a
//! bidirectional mapping between GWEN entity indices (u32) and Rapier
//! `RigidBodyHandle`s.

use crate::ecs::storage::ArchetypeStorage;
use crate::physics2d::components::{BodyOptions, BodyType, ColliderOptions};
use crate::physics2d::events::{clear_collision_events, push_collision_event, PhysicsCollisionEvent as StaticCollisionEvent};
use rapier2d::prelude::*;
use std::collections::HashMap;
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

struct EventCollector;

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

        push_collision_event(StaticCollisionEvent {
            entity_a: ea,
            entity_b: eb,
            collider_a_id: ca.unwrap_or(u32::MAX),
            collider_b_id: cb.unwrap_or(u32::MAX),
            flags: if event.started() { 1 } else { 0 },
        });
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
    quality_preset: PhysicsQualityPreset,
    global_ccd_enabled: bool,
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
            quality_preset: PhysicsQualityPreset::Medium,
            global_ccd_enabled: false,
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
                .active_events(ActiveEvents::COLLISION_EVENTS);
            let collider = builder.build();
            self.collider_set.insert_with_parent(collider, handle, &mut self.rigid_body_set);
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
                .active_events(ActiveEvents::COLLISION_EVENTS);
            let collider = builder.build();
            self.collider_set.insert_with_parent(collider, handle, &mut self.rigid_body_set);
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

    /// Get sensor state (contact count and isActive).
    pub fn get_sensor_state(&self, _entity_index: u32, _collider_id: u32) -> (u32, bool) {
        // This requires tracking contact counts per collider.
        // For now, let's return a placeholder or implement tracking if critical.
        (0, false)
    }

    /// Advances the simulation by `delta` seconds.
    pub fn step(&mut self, delta: f32) {
        self.integration_params.dt = delta;
        clear_collision_events();

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
            &(),
            &EventCollector,
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
}
