//! Physics component descriptors for 3D rigid bodies and colliders.

/// How a 3D rigid body interacts with the simulation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum BodyType3D {
    /// Immovable: never affected by forces or gravity.
    Fixed = 0,
    /// Fully simulated: affected by gravity, forces, and collisions.
    Dynamic = 1,
    /// Manually driven: position set by user code.
    Kinematic = 2,
}

impl BodyType3D {
    /// Converts from a raw `u8` passed across the WASM boundary. Falls back to `Fixed`.
    pub fn from_u8(v: u8) -> Self {
        match v {
            1 => BodyType3D::Dynamic,
            2 => BodyType3D::Kinematic,
            _ => BodyType3D::Fixed,
        }
    }
}

/// Surface material properties for a 3D collider.
#[derive(Debug, Clone, Copy)]
pub struct PhysicsMaterial3D {
    /// Bounciness in \[0, 1\]. 0 = no bounce, 1 = perfectly elastic.
    pub restitution: f32,
    /// Friction coefficient ≥ 0. 0 = frictionless.
    pub friction: f32,
}

impl Default for PhysicsMaterial3D {
    fn default() -> Self {
        PhysicsMaterial3D { restitution: 0.0, friction: 0.5 }
    }
}

/// Collision layer/mask filtering for a 3D collider.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CollisionGroups3D {
    /// Bitmask of layers this collider belongs to.
    pub membership: u32,
    /// Bitmask of layers this collider can collide with.
    pub filter: u32,
}

impl Default for CollisionGroups3D {
    fn default() -> Self { CollisionGroups3D::ALL }
}

impl CollisionGroups3D {
    /// Collides with everything (default).
    pub const ALL: Self = CollisionGroups3D { membership: u32::MAX, filter: u32::MAX };
}

/// Quality preset controlling solver iteration counts and CCD substeps.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum PhysicsQualityPreset3D {
    /// 2 solver iterations, 1 stabilization iteration, 1 CCD substep.
    Low = 0,
    /// 4 solver iterations, 2 stabilization iterations, 1 CCD substep. (default)
    Medium = 1,
    /// 8 solver iterations, 3 stabilization iterations, 2 CCD substeps.
    High = 2,
    /// 10 solver iterations, 4 stabilization iterations, 4 CCD substeps.
    Esport = 3,
}

impl PhysicsQualityPreset3D {
    /// Converts from a raw `u8`. Falls back to `Medium`.
    pub fn from_u8(v: u8) -> Self {
        match v {
            0 => PhysicsQualityPreset3D::Low,
            2 => PhysicsQualityPreset3D::High,
            3 => PhysicsQualityPreset3D::Esport,
            _ => PhysicsQualityPreset3D::Medium,
        }
    }
}

pub(crate) struct QualitySolverConfig3D {
    pub num_solver_iterations: usize,
    pub num_internal_stabilization_iterations: usize,
    pub max_ccd_substeps: usize,
}

pub(crate) fn quality_solver_config_3d(preset: PhysicsQualityPreset3D) -> QualitySolverConfig3D {
    match preset {
        PhysicsQualityPreset3D::Low => QualitySolverConfig3D { num_solver_iterations: 2, num_internal_stabilization_iterations: 1, max_ccd_substeps: 1 },
        PhysicsQualityPreset3D::Medium => QualitySolverConfig3D { num_solver_iterations: 4, num_internal_stabilization_iterations: 2, max_ccd_substeps: 1 },
        PhysicsQualityPreset3D::High => QualitySolverConfig3D { num_solver_iterations: 8, num_internal_stabilization_iterations: 3, max_ccd_substeps: 2 },
        PhysicsQualityPreset3D::Esport => QualitySolverConfig3D { num_solver_iterations: 10, num_internal_stabilization_iterations: 4, max_ccd_substeps: 4 },
    }
}

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
    pub material: PhysicsMaterial3D,
    /// If true, the collider is a sensor: generates events but no physical response.
    pub is_sensor: bool,
    /// Density in kg/m³. Used only when body mass is 0.0. Default: 1.0.
    pub density: f32,
    /// Collision layer/mask filtering.
    pub groups: CollisionGroups3D,
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
            material: PhysicsMaterial3D::default(),
            is_sensor: false,
            density: 1.0,
            groups: CollisionGroups3D::ALL,
            collider_id: u16::MAX,
            offset_x: 0.0,
            offset_y: 0.0,
            offset_z: 0.0,
        }
    }
}
