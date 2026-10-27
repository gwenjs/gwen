//! Physics 3D module — Rapier3D integration.
//!
//! **Enabled by:** `physics3d` feature flag.
//! **Mutually exclusive with:** `physics2d`.
//!
//! This module is only compiled when `--features physics3d` is passed to
//! `wasm-pack build`. It is **not** available in the light variant or the
//! physics2d variant.
//!
//! The optional `build-tools` feature (also requires `physics3d`) adds
//! BVH mesh pre-baking utilities used exclusively by the Vite CLI plugin —
//! never included in a runtime WASM binary.

/// Must equal the `(major, minor)` of the `rapier3d` dependency and is bumped with it.
pub const RAPIER_VERSION: (u16, u16) = (0, 36);

pub mod components;
pub mod error;
pub mod events;
pub mod pathfinding;
pub mod world;

pub use components::{
    BodyOptions3D, BodyType3D, ColliderOptions3D, CollisionGroups3D, PhysicsMaterial3D,
    PhysicsQualityPreset3D,
};
pub use error::{
    BvhLoadReason, InvalidColliderReason, InvalidCompoundReason, InvalidJointReason,
    InvalidShapeReason, PathRequestReject, Physics3DError,
};
pub use events::{
    get_collision_event_count_3d, get_collision_events_ptr_3d, PhysicsCollisionEvent3D,
};
pub use pathfinding::{
    find_path_3d, get_path_buffer_ptr_3d, MAX_NAVGRID_CELLS, MAX_PATH_COORD, MAX_PATH_NODES_3D,
};
pub use world::PhysicsWorld3D;
