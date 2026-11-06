//! Physics component descriptors.
//!
//! Lightweight structs used to configure rigid bodies and colliders.

pub use crate::physics_common::body::BodyType;
pub use crate::physics_common::groups::CollisionGroups;
pub use crate::physics_common::material::PhysicsMaterial;

/// Supported collider shapes.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ColliderShape {
    /// Axis-aligned bounding box.  `hw` = half-width, `hh` = half-height.
    Box { hw: f32, hh: f32 },
    /// Circle / sphere.  `radius` = radius.
    Ball { radius: f32 },
}

/// Extended options for rigid body creation.
#[derive(Debug, Clone, Copy)]
pub struct BodyOptions {
    /// Mass override in kg. 0.0 = use collider density. @default 1.0
    pub mass: f32,
    /// Gravity scale multiplier. 0.0 = no gravity, 1.0 = normal. @default 1.0
    pub gravity_scale: f32,
    /// Linear velocity damping ≥ 0. @default 0.0
    pub linear_damping: f32,
    /// Angular velocity damping ≥ 0. @default 0.0
    pub angular_damping: f32,
    /// Initial linear velocity (vx, vy) in m/s. @default (0, 0)
    pub initial_velocity: (f32, f32),
    /// Optional per-body CCD override. `None` means use global world setting.
    pub ccd_enabled: Option<bool>,
    /// Optional per-body additional solver iterations.
    pub additional_solver_iterations: Option<usize>,
}

impl Default for BodyOptions {
    fn default() -> Self {
        BodyOptions {
            mass: 1.0,
            gravity_scale: 1.0,
            linear_damping: 0.0,
            angular_damping: 0.0,
            initial_velocity: (0.0, 0.0),
            ccd_enabled: None,
            additional_solver_iterations: None,
        }
    }
}

/// Extended options for collider creation.
#[derive(Debug, Clone, Copy)]
pub struct ColliderOptions {
    /// Surface material.
    pub material: PhysicsMaterial,
    /// If true, the collider is a sensor: generates events but no physical response.
    pub is_sensor: bool,
    /// Density in kg/m². Used only when mass is 0.0. @default 1.0
    pub density: f32,
    /// Collision layer/mask filtering. @default `CollisionGroups::ALL`
    pub groups: CollisionGroups,
    /// Stable collider id propagated in collision events.
    pub collider_id: u32,
    /// Local collider offset in metres.
    pub offset_x: f32,
    /// Local collider offset in metres.
    pub offset_y: f32,
    /// if true, the collider detect only one way.
    pub is_one_way: bool,
}

impl Default for ColliderOptions {
    fn default() -> Self {
        ColliderOptions {
            material: PhysicsMaterial::default(),
            is_sensor: false,
            density: 1.0,
            groups: CollisionGroups::ALL,
            collider_id: u32::MAX,
            offset_x: 0.0,
            offset_y: 0.0,
            is_one_way: false,
        }
    }
}
