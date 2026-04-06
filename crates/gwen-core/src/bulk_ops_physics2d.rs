//! Tier 2 bulk physics2D operations.
//!
//! Only compiled when `features = ["physics2d"]`.
//!
//! These functions synchronize Rapier rigid-body state → ECS component storage
//! (and back) in bulk, replacing per-entity sync calls in the game loop.
//!
//! # Phase 0 note
//! The deep Rapier integration (directly iterating rigid bodies and stepping
//! the physics world in a single WASM call) is deferred to Phase 1.
//! For now, these are type-safe aliases over the Tier 1 bulk API that expose
//! physics-specific names and document physics-specific semantics.

use crate::bindings::Engine;

/// Bulk-sync Rapier rigid-body positions/rotations → ECS Transform components.
///
/// After each Rapier step, call this once instead of iterating all bodies
/// individually from JS. Writes packed `[x: f32, y: f32, angle: f32]` for
/// each entity into `out_buf`.
///
/// # Arguments
/// * `engine`            — mutable engine reference (needed for archetype query cache)
/// * `transform_type_id` — ComponentTypeId of the Transform component (3×f32 = 12 bytes)
/// * `out_slots`         — pre-allocated slot buffer  (len ≥ [`BULK_MAX_ENTITIES`])
/// * `out_gens`          — pre-allocated gen buffer   (len ≥ [`BULK_MAX_ENTITIES`])
/// * `out_buf`           — byte buffer for packed transform data (len ≥ count × 12)
///
/// # Returns
/// `(entity_count, bytes_written)`
///
/// # Phase 0 note
/// Delegates to the archetype-cached [`Engine::query_read_bulk`]. Future versions
/// will iterate Rapier bodies directly, skipping ECS components for kinematic entities.
///
/// [`BULK_MAX_ENTITIES`]: crate::bulk_ops::BULK_MAX_ENTITIES
pub fn physics2d_bulk_sync_from_rapier(
    engine: &mut Engine,
    transform_type_id: u32,
    out_slots: &mut [u32],
    out_gens: &mut [u32],
    out_buf: &mut [u8],
) -> (u32, u32) {
    let result = engine.query_read_bulk(
        &[transform_type_id],
        transform_type_id,
        out_slots,
        out_gens,
        out_buf,
    );
    (result[0], result[1])
}

/// Bulk-sync ECS Transform components → Rapier rigid-body positions.
///
/// Call after JS has updated transform data in-place. Passes the packed
/// `[x: f32, y: f32, angle: f32]` bytes to ECS storage; the next Rapier
/// step picks up the new positions via the transform sync hook.
///
/// # Arguments
/// * `slots`             — entity slot indices (from the prior `physics2d_bulk_sync_from_rapier`)
/// * `gens`              — per-slot generations (from the prior `physics2d_bulk_sync_from_rapier`)
/// * `transform_type_id` — ComponentTypeId of the Transform component
/// * `data`              — packed transform bytes matching WASM memory layout
pub fn physics2d_bulk_sync_to_rapier(
    engine: &mut Engine,
    slots: &[u32],
    gens: &[u32],
    transform_type_id: u32,
    data: &[u8],
) {
    engine.set_components_bulk(slots, gens, transform_type_id, data);
}

/// Bulk-apply impulses to entities with a RigidBody component.
///
/// `impulse_data` is packed `[impulse_x: f32, impulse_y: f32]` per entity
/// in the same slot order as `slots` (i.e., entity `slots[i]` receives
/// impulse `[impulse_data[i*8..i*8+4], impulse_data[i*8+4..i*8+8]]`).
///
/// Dead entities (stale generation) are silently skipped by `set_components_bulk`.
pub fn physics2d_bulk_apply_impulse(
    engine: &mut Engine,
    slots: &[u32],
    gens: &[u32],
    rigidbody_type_id: u32,
    impulse_data: &[u8],
) {
    engine.set_components_bulk(slots, gens, rigidbody_type_id, impulse_data);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bindings::Engine;

    fn make_engine() -> Engine {
        Engine::new(1000)
    }

    #[test]
    fn test_physics2d_sync_from_rapier_empty_engine() {
        let mut engine = make_engine();
        let mut slots = vec![0u32; 16];
        let mut gens = vec![0u32; 16];
        let mut buf = vec![0u8; 256];
        let (count, bytes) =
            physics2d_bulk_sync_from_rapier(&mut engine, 0, &mut slots, &mut gens, &mut buf);
        assert_eq!(count, 0);
        assert_eq!(bytes, 0);
    }

    #[test]
    fn test_physics2d_apply_impulse_no_panic_empty() {
        let mut engine = make_engine();
        physics2d_bulk_apply_impulse(&mut engine, &[], &[], 0, &[]);
    }

    #[test]
    fn test_physics2d_sync_roundtrip() {
        let mut engine = make_engine();
        let transform_type_id = engine.register_component_type();

        let e = engine.create_entity();
        // Pack transform [x=1.0, y=2.0, angle=0.5] as little-endian f32 bytes
        let transform_bytes = {
            let mut b = [0u8; 12];
            b[0..4].copy_from_slice(&1.0f32.to_le_bytes());
            b[4..8].copy_from_slice(&2.0f32.to_le_bytes());
            b[8..12].copy_from_slice(&0.5f32.to_le_bytes());
            b
        };
        engine.add_component(e.index(), e.generation(), transform_type_id, &transform_bytes);

        let mut out_slots = vec![0u32; 16];
        let mut out_gens = vec![0u32; 16];
        let mut out_buf = vec![0u8; 12];

        let (count, bytes) = physics2d_bulk_sync_from_rapier(
            &mut engine,
            transform_type_id,
            &mut out_slots,
            &mut out_gens,
            &mut out_buf,
        );

        assert_eq!(count, 1, "one entity with transform");
        assert_eq!(bytes, 12, "12 bytes for 3×f32");
        // Verify x=1.0 was read
        let x = f32::from_le_bytes(out_buf[0..4].try_into().unwrap());
        assert!((x - 1.0).abs() < f32::EPSILON);
    }
}
