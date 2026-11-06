//! Collision layer masks shared by both physics variants.

/// Collision filtering for a collider.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CollisionGroups {
    /// Bitmask of layers this collider belongs to.
    pub membership: u32,
    /// Bitmask of layers this collider can collide with.
    pub filter: u32,
}

impl CollisionGroups {
    /// Collides with everything.
    pub const ALL: Self = CollisionGroups {
        membership: u32::MAX,
        filter: u32::MAX,
    };
}

impl Default for CollisionGroups {
    fn default() -> Self {
        CollisionGroups::ALL
    }
}
