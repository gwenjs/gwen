//! Surface material shared by both physics variants.

/// Surface material for a collider.
#[derive(Debug, Clone, Copy)]
pub struct PhysicsMaterial {
    /// Bounciness in [0, 1]. 0 = no bounce, 1 = perfect elastic.
    pub restitution: f32,
    /// Friction coefficient ≥ 0. 0 = frictionless.
    pub friction: f32,
}

impl PhysicsMaterial {
    /// Restitution 0, friction 0.5.
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
