//! Physics component descriptors.
//!
//! Lightweight structs used to configure rigid bodies and colliders.

/// How a rigid body interacts with the simulation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum BodyType {
    /// Immovable: never affected by forces or gravity (walls, floors).
    Fixed = 0,
    /// Fully simulated: affected by gravity, forces, and collisions.
    Dynamic = 1,
    /// Manually driven: velocity is set by user code, ignores forces.
    Kinematic = 2,
}

impl BodyType {
    /// Convert from the raw u8 passed through the WASM boundary.
    /// Falls back to `Fixed` for unknown values.
    pub fn from_u8(v: u8) -> Self {
        match v {
            1 => BodyType::Dynamic,
            2 => BodyType::Kinematic,
            _ => BodyType::Fixed,
        }
    }
}

/// Supported collider shapes.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ColliderShape {
    /// Axis-aligned bounding box.  `hw` = half-width, `hh` = half-height.
    Box { hw: f32, hh: f32 },
    /// Circle / sphere.  `radius` = radius.
    Ball { radius: f32 },
}

/// Surface material for a collider.
#[derive(Debug, Clone, Copy)]
pub struct PhysicsMaterial {
    /// Bounciness in [0, 1].  0 = no bounce, 1 = perfect elastic.
    pub restitution: f32,
    /// Friction coefficient ≥ 0.  0 = frictionless.
    pub friction: f32,
}

impl PhysicsMaterial {
    pub const DEFAULT: Self = PhysicsMaterial {
        restitution: 0.0,
        friction: 0.5,
    };
}

impl Default for PhysicsMaterial {
    fn default() -> Self {
        PhysicsMaterial::DEFAULT
    }
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
        }
    }
}

/// Collision filtering for a collider.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CollisionGroups {
    /// Bitmask of layers this collider *belongs to* (which groups it is in).
    pub membership: u32,
    /// Bitmask of layers this collider *can collide with* (which groups it sees).
    pub filter: u32,
}

impl Default for CollisionGroups {
    fn default() -> Self {
        CollisionGroups {
            membership: u32::MAX,
            filter: u32::MAX,
        }
    }
}

impl CollisionGroups {
    /// `CollisionGroups` that collide with everything (default).
    pub const ALL: Self = CollisionGroups {
        membership: u32::MAX,
        filter: u32::MAX,
    };
}
