//! Physics component descriptors for 3D rigid bodies and colliders.

pub use crate::physics_common::body::BodyType;
pub use crate::physics_common::groups::CollisionGroups;
pub use crate::physics_common::material::PhysicsMaterial;
pub use crate::physics_common::quality::QualityPreset;

/// Extended options for 3D rigid body creation.
#[derive(Debug, Clone, Copy)]
pub struct BodyOptions3D {
    /// Body mass in kg. Default: 1.0.
    pub mass: f32,
    /// Gravity scale multiplier. 0.0 = no gravity, 1.0 = normal. Default: 1.0.
    pub gravity_scale: f32,
    /// Linear velocity damping ≥ 0. Default: 0.0.
    pub linear_damping: f32,
    /// Angular velocity damping ≥ 0. Default: 0.0.
    pub angular_damping: f32,
    /// Initial linear velocity (vx, vy, vz) in m/s. Default: (0, 0, 0).
    pub initial_velocity: (f32, f32, f32),
    /// Per-body CCD override. `None` uses the global world setting.
    pub ccd_enabled: Option<bool>,
}

impl Default for BodyOptions3D {
    fn default() -> Self {
        BodyOptions3D {
            mass: 1.0,
            gravity_scale: 1.0,
            linear_damping: 0.0,
            angular_damping: 0.0,
            initial_velocity: (0.0, 0.0, 0.0),
            ccd_enabled: None,
        }
    }
}

/// Extended options for 3D collider creation.
#[derive(Debug, Clone, Copy)]
pub struct ColliderOptions3D {
    /// Surface material (friction, restitution).
    pub material: PhysicsMaterial,
    /// If true, the collider is a sensor: generates events but no physical response.
    pub is_sensor: bool,
    /// Density in kg/m³. Used only when body mass is 0.0. Default: 1.0.
    pub density: f32,
    /// Collision layer/mask filtering.
    pub groups: CollisionGroups,
    /// Stable collider ID propagated in collision events. `u16::MAX` = absent.
    pub collider_id: u16,
    /// Local collider offset in metres (x axis).
    pub offset_x: f32,
    /// Local collider offset in metres (y axis).
    pub offset_y: f32,
    /// Local collider offset in metres (z axis).
    pub offset_z: f32,
}

impl Default for ColliderOptions3D {
    fn default() -> Self {
        ColliderOptions3D {
            material: PhysicsMaterial::default(),
            is_sensor: false,
            density: 1.0,
            groups: CollisionGroups::ALL,
            collider_id: u16::MAX,
            offset_x: 0.0,
            offset_y: 0.0,
            offset_z: 0.0,
        }
    }
}
