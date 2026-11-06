//! Shared physics types and bulk copies.
//!
//! Empty unless `physics2d` or `physics3d` is on. The two features are mutually
//! exclusive, so each run pins one stride.

#![cfg(any(feature = "physics2d", feature = "physics3d"))]

use gwen_core::bindings::Engine;
use gwen_core::physics_common::body::BodyType;
use gwen_core::physics_common::bulk::{
    apply_impulse, rows_bytes, sync_from_rapier, sync_to_rapier,
};
use gwen_core::physics_common::events::CollisionEvent;
use gwen_core::physics_common::groups::CollisionGroups;
use gwen_core::physics_common::material::PhysicsMaterial;
use gwen_core::physics_common::quality::{solver_config, QualityPreset};
use gwen_core::CoreError;
use std::mem::size_of;

#[cfg(feature = "physics2d")]
use gwen_core::physics2d::PhysicsCollisionEvent;
#[cfg(feature = "physics3d")]
use gwen_core::physics3d::PhysicsCollisionEvent3D;

#[cfg(feature = "physics2d")]
const SYNC_STRIDE: usize = 12;
#[cfg(feature = "physics3d")]
const SYNC_STRIDE: usize = 28;
const SYNC_TOTAL: u32 = rows_bytes::<SYNC_STRIDE>(3) as u32;

#[cfg(feature = "physics2d")]
const IMPULSE_STRIDE: usize = 8;
#[cfg(feature = "physics3d")]
const IMPULSE_STRIDE: usize = 12;
const IMPULSE_ONE: u32 = rows_bytes::<IMPULSE_STRIDE>(1) as u32;

fn f32_lanes(bytes: usize) -> Vec<u8> {
    vec![0u8; bytes / 4]
}

fn paint(buf: &mut [u8], add: u8) {
    let mut n = 0u8;
    for byte in buf.iter_mut() {
        *byte = n.wrapping_add(add);
        n = n.wrapping_add(1);
    }
}

fn assert_same_gens(got_slots: &[u32], got_gens: &[u32], want_slots: &[u32], want_gens: &[u32]) {
    for (row, slot) in got_slots.iter().enumerate() {
        let mut matched = 0u32;
        for (source, want) in want_slots.iter().enumerate() {
            if want == slot {
                assert_eq!(got_gens.get(row).copied(), want_gens.get(source).copied());
                matched += 1;
            }
        }
        assert_eq!(matched, 1);
    }
}

fn assert_rows(
    got_slots: &[u32],
    got_buf: &[u8],
    stride: usize,
    want_slots: &[u32],
    want_buf: &[u8],
) {
    for (row, slot) in got_slots.iter().enumerate() {
        let start = row * stride;
        let end = start + stride;
        let mut matched = 0u32;
        for (source, want) in want_slots.iter().enumerate() {
            if want == slot {
                let from = source * stride;
                let to = from + stride;
                assert_eq!(got_buf.get(start..end), want_buf.get(from..to));
                matched += 1;
            }
        }
        assert_eq!(matched, 1);
    }
}

#[test]
fn collision_event_u16_is_16_bytes_and_u32_is_20() -> Result<(), CoreError> {
    assert_eq!(size_of::<CollisionEvent<u16>>(), 16);
    assert_eq!(size_of::<CollisionEvent<u32>>(), 20);
    assert_eq!(std::mem::offset_of!(CollisionEvent<u16>, entity_a), 0);
    assert_eq!(std::mem::offset_of!(CollisionEvent<u16>, entity_b), 4);
    assert_eq!(std::mem::offset_of!(CollisionEvent<u16>, collider_a_id), 8);
    assert_eq!(std::mem::offset_of!(CollisionEvent<u16>, collider_b_id), 10);
    assert_eq!(std::mem::offset_of!(CollisionEvent<u16>, flags), 12);
    assert_eq!(std::mem::offset_of!(CollisionEvent<u32>, entity_a), 0);
    assert_eq!(std::mem::offset_of!(CollisionEvent<u32>, entity_b), 4);
    assert_eq!(std::mem::offset_of!(CollisionEvent<u32>, collider_a_id), 8);
    assert_eq!(std::mem::offset_of!(CollisionEvent<u32>, collider_b_id), 12);
    assert_eq!(std::mem::offset_of!(CollisionEvent<u32>, flags), 16);
    #[cfg(feature = "physics2d")]
    {
        assert_eq!(std::mem::offset_of!(PhysicsCollisionEvent, entity_a), 0);
        assert_eq!(std::mem::offset_of!(PhysicsCollisionEvent, entity_b), 4);
        assert_eq!(
            std::mem::offset_of!(PhysicsCollisionEvent, collider_a_id),
            8
        );
        assert_eq!(
            std::mem::offset_of!(PhysicsCollisionEvent, collider_b_id),
            12
        );
        assert_eq!(std::mem::offset_of!(PhysicsCollisionEvent, flags), 16);
        assert_eq!(size_of::<PhysicsCollisionEvent>(), 20);
    }
    #[cfg(feature = "physics3d")]
    {
        assert_eq!(std::mem::offset_of!(PhysicsCollisionEvent3D, entity_a), 0);
        assert_eq!(std::mem::offset_of!(PhysicsCollisionEvent3D, entity_b), 4);
        assert_eq!(std::mem::offset_of!(PhysicsCollisionEvent3D, flags), 8);
        assert_eq!(
            std::mem::offset_of!(PhysicsCollisionEvent3D, collider_a_id),
            12
        );
        assert_eq!(
            std::mem::offset_of!(PhysicsCollisionEvent3D, collider_b_id),
            14
        );
        assert_eq!(size_of::<PhysicsCollisionEvent3D>(), 16);
    }
    Ok(())
}

#[test]
fn quality_table_is_2_4_8_10() -> Result<(), CoreError> {
    let low = solver_config(QualityPreset::Low);
    assert_eq!(low.num_solver_iterations, 2);
    assert_eq!(low.num_internal_stabilization_iterations, 1);
    assert_eq!(low.max_ccd_substeps, 1);
    let medium = solver_config(QualityPreset::Medium);
    assert_eq!(medium.num_solver_iterations, 4);
    assert_eq!(medium.num_internal_stabilization_iterations, 2);
    assert_eq!(medium.max_ccd_substeps, 1);
    let high = solver_config(QualityPreset::High);
    assert_eq!(high.num_solver_iterations, 8);
    assert_eq!(high.num_internal_stabilization_iterations, 3);
    assert_eq!(high.max_ccd_substeps, 2);
    let esport = solver_config(QualityPreset::Esport);
    assert_eq!(esport.num_solver_iterations, 10);
    assert_eq!(esport.num_internal_stabilization_iterations, 4);
    assert_eq!(esport.max_ccd_substeps, 4);
    Ok(())
}

#[test]
fn body_type_round_trips_through_u8() -> Result<(), CoreError> {
    assert_eq!(BodyType::from_u8(0) as u8, 0);
    assert_eq!(BodyType::from_u8(1) as u8, 1);
    assert_eq!(BodyType::from_u8(2) as u8, 2);
    assert_eq!(BodyType::from_u8(3) as u8, 0);
    assert_eq!(BodyType::from_u8(255) as u8, 0);
    Ok(())
}

#[test]
fn defaults_pin_material_groups_and_medium_fallback() -> Result<(), CoreError> {
    let material = PhysicsMaterial::default();
    assert_eq!(material.friction, 0.5);
    assert_eq!(material.restitution, 0.0);
    assert_eq!(CollisionGroups::default(), CollisionGroups::ALL);
    assert_eq!(CollisionGroups::ALL.membership, u32::MAX);
    assert_eq!(CollisionGroups::ALL.filter, u32::MAX);
    assert_eq!(QualityPreset::from_u8(4), QualityPreset::Medium);
    assert_eq!(QualityPreset::from_u8(255), QualityPreset::Medium);
    Ok(())
}

#[test]
fn bulk_sync_round_trip_keeps_every_body() -> Result<(), CoreError> {
    let mut engine = Engine::new(8)?;
    let type_id = engine.register_component(&f32_lanes(SYNC_STRIDE))?;
    let mut slots = [0u32; 3];
    let mut gens = [0u32; 3];
    let total = rows_bytes::<SYNC_STRIDE>(3);
    let mut initial = vec![0u8; total];
    for index in 0..3 {
        let id = engine.create_entity()?;
        let start = index * SYNC_STRIDE;
        let end = start + SYNC_STRIDE;
        paint(&mut initial[start..end], (index as u8).wrapping_add(1));
        assert_eq!(
            engine.add_component(id.index(), id.generation(), type_id, &initial[start..end]),
            Ok(true)
        );
        slots[index] = id.index();
        gens[index] = id.generation();
    }

    let mut out_slots = [0u32; 3];
    let mut out_gens = [0u32; 3];
    let mut out_buf = vec![0u8; total];
    let (count, bytes) = sync_from_rapier::<SYNC_STRIDE>(
        &mut engine,
        type_id,
        &mut out_slots,
        &mut out_gens,
        &mut out_buf,
    )?;
    assert_eq!(count, 3);
    assert_eq!(bytes, SYNC_TOTAL);
    assert_same_gens(&out_slots, &out_gens, &slots, &gens);
    assert_rows(&out_slots, &out_buf, SYNC_STRIDE, &slots, &initial);

    paint(&mut out_buf, 17);
    sync_to_rapier::<SYNC_STRIDE>(&mut engine, &out_slots, &out_gens, type_id, &out_buf)?;

    let mut again_slots = [0u32; 3];
    let mut again_gens = [0u32; 3];
    let mut again_buf = vec![0u8; total];
    let (again_count, again_bytes) = sync_from_rapier::<SYNC_STRIDE>(
        &mut engine,
        type_id,
        &mut again_slots,
        &mut again_gens,
        &mut again_buf,
    )?;
    assert_eq!(again_count, 3);
    assert_eq!(again_bytes, SYNC_TOTAL);
    assert_rows(&again_slots, &again_buf, SYNC_STRIDE, &out_slots, &out_buf);
    Ok(())
}

#[test]
fn bulk_apply_impulse_writes_the_component() -> Result<(), CoreError> {
    let mut engine = Engine::new(8)?;
    let type_id = engine.register_component(&f32_lanes(IMPULSE_STRIDE))?;
    let mut slots = [0u32; 3];
    let mut gens = [0u32; 3];
    let one = rows_bytes::<IMPULSE_STRIDE>(1);
    for index in 0..3 {
        let id = engine.create_entity()?;
        let mut row = vec![0u8; one];
        paint(&mut row, 9);
        assert_eq!(
            engine.add_component(id.index(), id.generation(), type_id, &row),
            Ok(true)
        );
        slots[index] = id.index();
        gens[index] = id.generation();
    }

    let mut impulse = vec![0u8; rows_bytes::<IMPULSE_STRIDE>(3)];
    paint(&mut impulse, 3);
    apply_impulse::<IMPULSE_STRIDE>(&mut engine, &slots, &gens, type_id, &impulse)?;
    for index in 0..3 {
        let got = engine.get_component_raw(slots[index], gens[index], type_id)?;
        let start = index * IMPULSE_STRIDE;
        let end = start + IMPULSE_STRIDE;
        assert_eq!(Some(got.as_slice()), impulse.get(start..end));
    }

    let before = engine.get_component_raw(slots[0], gens[0], type_id)?;
    assert_eq!(
        apply_impulse::<IMPULSE_STRIDE>(&mut engine, &slots[..1], &gens[..1], type_id, &[9]),
        Err(CoreError::BufferLengthMismatch {
            buffer: "data",
            expected: IMPULSE_ONE,
            actual: 1,
        })
    );
    assert_eq!(
        engine.get_component_raw(slots[0], gens[0], type_id)?,
        before
    );
    Ok(())
}
