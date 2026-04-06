//! # gwen-core
//!
//! Core runtime crate for the GWEN game engine, compiled to WebAssembly.
//!
//! ## Feature flags
//!
//! | Feature | Description | Mutual exclusion |
//! |---------|-------------|-----------------|
//! | *(none)* | ECS + transforms + 2D/3D math only — lightest bundle | — |
//! | `physics2d` | Adds Rapier2D physics + pathfinding | ⚠ Excludes `physics3d` |
//! | `physics3d` | Adds Rapier3D physics + pathfinding | ⚠ Excludes `physics2d` |
//! | `build-tools` | BVH pre-baking for the Vite CLI plugin | Requires `physics3d` — **never in runtime WASM** |
//!
//! ## WASM build variants
//!
//! | Variant | wasm-pack command | Used by TS package |
//! |---------|-------------------|--------------------|
//! | Light | `wasm-pack build --release` | `@gwenjs/core` (light) |
//! | Physics 2D | `wasm-pack build --release --features physics2d` | `@gwenjs/physics2d` |
//! | Physics 3D | `wasm-pack build --release --features physics3d` | `@gwenjs/physics3d` |
//!
//! ## Architecture
//!
//! - **ECS** (`ecs/`): archetype-based entity-component system with bitset queries.
//! - **Bulk ops** (`bulk_ops*.rs`): tier-1/2/3 batch transfers across the WASM boundary.
//! - **Transforms** (`transform.rs`): 2D/3D hierarchy with dirty tracking.
//! - **Physics 2D** (`physics2d/`): Rapier2D integration (enabled via `physics2d` feature).
//! - **Physics 3D** (`physics3d/`): Rapier3D integration (enabled via `physics3d` feature).
//! - **Bindings** (`bindings.rs`): all `#[wasm_bindgen]` exports — the public WASM API.

pub mod allocator;
pub mod bindings;
pub mod bulk_ops;
pub mod ecs;
pub mod events;
pub mod gameloop;
pub mod transform;
pub mod transform_math;

#[cfg(feature = "physics2d")]
pub mod bulk_ops_physics2d;

#[cfg(feature = "physics3d")]
pub mod bulk_ops_physics3d;

#[cfg(feature = "physics2d")]
pub mod physics2d;

#[cfg(feature = "physics3d")]
pub mod physics3d;

#[cfg(feature = "build-tools")]
pub mod build_tools;

#[cfg(all(feature = "physics2d", feature = "physics3d"))]
compile_error!(
    "`physics2d` and `physics3d` are mutually exclusive features. \
     Enable exactly one per WASM build variant. See Cargo.toml [features] for details."
);

/// Shared memory layout constants re-exported for external crate consumers.
/// These values are defined in `transform` (the canonical source of truth).
pub mod shared_memory {
    pub use crate::transform::{FLAGS3D_OFFSET, FLAGS_OFFSET, TRANSFORM3D_STRIDE, TRANSFORM_STRIDE};
}

pub use ecs::*;
pub use events::*;
pub use gameloop::*;
pub use transform::*;
pub use transform_math::*;
