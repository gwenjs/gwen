//! Tier 3 bulk physics3D operations.
//!
//! Only compiled when `features = ["physics3d"]`.
//!
//! Transforms are `[x: f32, y: f32, z: f32, qx: f32, qy: f32, qz: f32, qw: f32]`
//! = 7 × 4 = 28 bytes per entity.
//!
//! # Phase 0 note
//! Deep Rapier3D integration (iterating rigid bodies directly) is deferred to Phase 1.
//! These functions are type-safe aliases over the Tier 1 bulk API with 3D-specific semantics.

use crate::bindings::Engine;

/// Bulk-sync Rapier3D rigid-body state → ECS Transform3D components.
///
/// Writes packed `[x, y, z, qx, qy, qz, qw]` (28 bytes) per entity into `out_buf`.
///
/// # Arguments
/// * `engine`            — mutable engine reference (archetype query cache)
/// * `transform_type_id` — ComponentTypeId of the Transform3D component (7×f32 = 28 bytes)
/// * `out_slots`         — pre-allocated slot buffer (len ≥ BULK_MAX_ENTITIES)
/// * `out_gens`          — pre-allocated gen buffer  (len ≥ BULK_MAX_ENTITIES)
/// * `out_buf`           — byte buffer for packed transform data (len ≥ count × 28)
///
/// # Returns
/// `(entity_count, bytes_written)`
///
/// [`BULK_MAX_ENTITIES`]: crate::bulk_ops::BULK_MAX_ENTITIES
pub fn physics3d_bulk_sync_from_rapier(
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

/// Bulk-sync ECS Transform3D components → Rapier3D rigid bodies.
///
/// Call after JS has updated transform data in-place. The next Rapier3D step
/// picks up the new transforms via the sync hook.
///
/// # Arguments
/// * `engine`            — mutable engine reference
/// * `slots`             — entity slot indices (from prior `physics3d_bulk_sync_from_rapier`)
/// * `gens`              — per-slot generations (from prior `physics3d_bulk_sync_from_rapier`)
/// * `transform_type_id` — ComponentTypeId of the Transform3D component
/// * `data`              — packed transform bytes (7×f32 per entity = 28 bytes/entity)
pub fn physics3d_bulk_sync_to_rapier(
    engine: &mut Engine,
    slots: &[u32],
    gens: &[u32],
    transform_type_id: u32,
    data: &[u8],
) {
    engine.set_components_bulk(slots, gens, transform_type_id, data);
}

/// Bulk-apply 3D impulses `[fx: f32, fy: f32, fz: f32]` (12 bytes per entity).
///
/// Dead entities (stale generation) are silently skipped by `set_components_bulk`.
///
/// # Arguments
/// * `engine`           — mutable engine reference
/// * `slots`            — entity slot indices
/// * `gens`             — per-slot generations
/// * `rigidbody_type_id` — ComponentTypeId of the RigidBody3D component
/// * `impulse_data`     — packed impulse bytes (3×f32 per entity = 12 bytes/entity)
pub fn physics3d_bulk_apply_impulse(
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
    fn test_physics3d_sync_from_rapier_empty_engine() {
        let mut engine = make_engine();
        let mut slots = vec![0u32; 16];
        let mut gens = vec![0u32; 16];
        let mut buf = vec![0u8; 512];
        let (count, bytes) =
            physics3d_bulk_sync_from_rapier(&mut engine, 0, &mut slots, &mut gens, &mut buf);
        assert_eq!(count, 0);
        assert_eq!(bytes, 0);
    }

    #[test]
    fn test_physics3d_apply_impulse_no_panic_empty() {
        let mut engine = make_engine();
        physics3d_bulk_apply_impulse(&mut engine, &[], &[], 0, &[]);
    }

    #[test]
    fn test_physics3d_sync_roundtrip() {
        let mut engine = make_engine();
        let transform_type_id = engine.register_component_type();

        let e = engine.create_entity();
        // Pack transform [x=1.0, y=2.0, z=3.0, qx=0.0, qy=0.0, qz=0.0, qw=1.0] = 28 bytes
        let mut transform_bytes = [0u8; 28];
        transform_bytes[0..4].copy_from_slice(&1.0f32.to_le_bytes());
        transform_bytes[4..8].copy_from_slice(&2.0f32.to_le_bytes());
        transform_bytes[8..12].copy_from_slice(&3.0f32.to_le_bytes());
        transform_bytes[24..28].copy_from_slice(&1.0f32.to_le_bytes()); // qw=1.0
        engine.add_component(e.index(), e.generation(), transform_type_id, &transform_bytes);

        let mut out_slots = vec![0u32; 16];
        let mut out_gens = vec![0u32; 16];
        let mut out_buf = vec![0u8; 28];

        let (count, bytes) = physics3d_bulk_sync_from_rapier(
            &mut engine,
            transform_type_id,
            &mut out_slots,
            &mut out_gens,
            &mut out_buf,
        );

        assert_eq!(count, 1, "one entity with 3D transform");
        assert_eq!(bytes, 28, "28 bytes for 7×f32");
        let x = f32::from_le_bytes(out_buf[0..4].try_into().unwrap());
        assert!((x - 1.0).abs() < f32::EPSILON, "x component must be 1.0");
        let qw = f32::from_le_bytes(out_buf[24..28].try_into().unwrap());
        assert!((qw - 1.0).abs() < f32::EPSILON, "qw component must be 1.0");
    }
}
