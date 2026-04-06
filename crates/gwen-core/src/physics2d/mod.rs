//! Physics 2D module — Rapier2D integration.
//!
//! **Enabled by:** `physics2d` feature flag.
//! **Mutually exclusive with:** `physics3d`.
//!
//! This module is only compiled when `--features physics2d` is passed to
//! `wasm-pack build`. It is **not** available in the light variant or the
//! physics3d variant.
//!
//! This module is only active when the `physics2d` feature is enabled.

pub mod components;
pub mod events;
pub mod pathfinding;
pub mod world;

pub use components::*;
pub use events::*;
pub use pathfinding::*;
pub use world::*;
