//! Collision record shared by width.
//!
//! `CollisionEvent<u32>` matches the 2D wire: 20 bytes, collider ids at
//! offsets 8 and 12, `flags: u8` at offset 16. `CollisionEvent<u16>` is 16
//! bytes, with collider ids at offsets 8 and 10 and `flags: u8` at offset 12.
//! That layout is not the 3D wire. 3D keeps `PhysicsCollisionEvent3D`
//! (`crates/gwen-core/src/physics3d/events.rs:22-33`): `flags: u32` at offset 8
//! and `u16` collider ids at offsets 12 and 14.

/// A collision event. `Id` is the collider-id width.
///
/// `Id::MAX` means the collider id is absent. The 2D value is `u32::MAX`
/// (`COLLIDER_ID_ABSENT`, `crates/gwen-core/src/physics2d/world.rs:18`).
#[repr(C)]
#[derive(Debug, Clone, Copy, Default)]
pub struct CollisionEvent<Id> {
    /// First entity involved in the collision.
    pub entity_a: u32,
    /// Second entity involved in the collision.
    pub entity_b: u32,
    /// Stable id of the first collider. `Id::MAX` means absent.
    pub collider_a_id: Id,
    /// Stable id of the second collider. `Id::MAX` means absent.
    pub collider_b_id: Id,
    /// Bit 0 is 1 when the contact started and 0 when it stopped.
    pub flags: u8,
}
