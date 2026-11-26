#![cfg(feature = "physics3d")]
//! A physics3d body on a live entity with no 3D node gets a root node at its pose.
//!
//! Native only. `verify-red` runs this target without `--features physics3d`,
//! so the file is empty in that run. World pose is read from the 48-byte history.

use std::cmp::Ordering;

use gwen_core::bindings::Engine;
use gwen_core::physics3d::Physics3DError;
use gwen_core::{FLAG_HAS_TRANSFORM, FLAG_TELEPORT};

const SLOT_BYTES: usize = 48;
const FIXED: u8 = 0;
const DYNAMIC: u8 = 1;
const KINEMATIC: u8 = 2;

fn engine_with_world() -> Result<Engine, Physics3DError> {
    let mut engine = Engine::new(8).map_err(Physics3DError::Core)?;
    engine.physics3d_init(0.0, -9.81, 0.0, 8);
    Ok(engine)
}

fn add_body(
    engine: &mut Engine,
    slot: u32,
    x: f32,
    y: f32,
    z: f32,
    kind: u8,
) -> Result<bool, Physics3DError> {
    engine.physics3d_add_body(slot, x, y, z, kind, 1.0, 0.0, 0.0)
}

fn commit(engine: &mut Engine) -> Result<u32, Physics3DError> {
    engine.update_transforms();
    engine
        .transform3d_history_commit()
        .map_err(Physics3DError::Core)
}

fn f32_of(engine: &Engine, buffer: u32, index: u32, offset: usize) -> f32 {
    let base = engine.transform3d_history_ptr(buffer);
    assert_ne!(base, 0, "3D buffer {buffer} is allocated");
    let address = base + index as usize * SLOT_BYTES + offset;
    let mut bytes = [0u8; 4];
    // SAFETY: `base` is the 3D history allocation of this engine, checked non-zero
    // above, and the 4 bytes at `offset` (at most 40) stay inside the 48-byte slot.
    unsafe {
        std::ptr::copy_nonoverlapping(address as *const u8, bytes.as_mut_ptr(), 4);
    }
    f32::from_le_bytes(bytes)
}

fn flags_of(engine: &Engine, buffer: u32, index: u32) -> u32 {
    let base = engine.transform3d_history_ptr(buffer);
    assert_ne!(base, 0, "3D buffer {buffer} is allocated");
    let offset = base + index as usize * SLOT_BYTES + 40;
    let mut bytes = [0u8; 4];
    // SAFETY: `base` is the 3D history allocation of this engine, checked non-zero
    // above, and the flag word at byte 40 stays inside the 48-byte slot of `index`.
    unsafe {
        std::ptr::copy_nonoverlapping(offset as *const u8, bytes.as_mut_ptr(), 4);
    }
    u32::from_le_bytes(bytes)
}

fn zero_slot(engine: &Engine, buffer: u32, index: u32) -> bool {
    let mut same = 0u32;
    for offset in (0..SLOT_BYTES).step_by(4) {
        let word = f32_of(engine, buffer, index, offset).to_bits();
        same += u32::from(word == 0);
    }
    same == (SLOT_BYTES / 4) as u32
}

#[test]
fn a_body_added_without_a_3d_transform_gets_a_root_node_at_its_pose() -> Result<(), Physics3DError>
{
    let mut engine = engine_with_world()?;
    let id = engine.create_entity().map_err(Physics3DError::Core)?;
    add_body(&mut engine, id.index(), 3.0, 4.0, 5.0, DYNAMIC)?;

    let parity = commit(&mut engine)?;
    assert_eq!(f32_of(&engine, parity, id.index(), 0), 3.0);
    assert_eq!(f32_of(&engine, parity, id.index(), 4), 4.0);
    assert_eq!(f32_of(&engine, parity, id.index(), 8), 5.0);
    assert_eq!(f32_of(&engine, parity, id.index(), 12), 0.0);
    assert_eq!(f32_of(&engine, parity, id.index(), 16), 0.0);
    assert_eq!(f32_of(&engine, parity, id.index(), 20), 0.0);
    assert_eq!(f32_of(&engine, parity, id.index(), 24), 1.0);
    assert_eq!(f32_of(&engine, parity, id.index(), 28), 1.0);
    assert_eq!(f32_of(&engine, parity, id.index(), 32), 1.0);
    assert_eq!(f32_of(&engine, parity, id.index(), 36), 1.0);
    Ok(())
}

#[test]
fn fixed_and_kinematic_bodies_get_a_3d_node_too() -> Result<(), Physics3DError> {
    let mut engine = engine_with_world()?;
    let fixed = engine.create_entity().map_err(Physics3DError::Core)?;
    let kinematic = engine.create_entity().map_err(Physics3DError::Core)?;
    add_body(&mut engine, fixed.index(), 5.0, 6.0, 7.0, FIXED)?;
    add_body(&mut engine, kinematic.index(), 8.0, 9.0, 10.0, KINEMATIC)?;

    let parity = commit(&mut engine)?;
    assert_eq!(f32_of(&engine, parity, fixed.index(), 0), 5.0);
    assert_eq!(f32_of(&engine, parity, kinematic.index(), 4), 9.0);
    Ok(())
}

#[test]
fn a_dynamic_body_node_follows_rapier_after_a_step() -> Result<(), Physics3DError> {
    let mut engine = engine_with_world()?;
    let id = engine.create_entity().map_err(Physics3DError::Core)?;
    let index = id.index();
    add_body(&mut engine, index, 0.0, 10.0, 0.0, DYNAMIC)?;
    engine.physics3d_step(0.1)?;

    let state = engine.physics3d_get_body_state(index)?;
    assert_eq!(state.len(), 13);
    let parity = commit(&mut engine)?;
    let y = f32_of(&engine, parity, index, 4);
    assert_eq!(y.partial_cmp(&10.0), Some(Ordering::Less));
    assert_eq!(f32_of(&engine, parity, index, 0), state[0]);
    assert_eq!(y, state[1]);
    assert_eq!(f32_of(&engine, parity, index, 8), state[2]);
    Ok(())
}

#[test]
fn a_spinning_dynamic_body_writes_its_quaternion() -> Result<(), Physics3DError> {
    let mut engine = engine_with_world()?;
    let id = engine.create_entity().map_err(Physics3DError::Core)?;
    let index = id.index();
    add_body(&mut engine, index, 0.0, 0.0, 0.0, DYNAMIC)?;
    engine.physics3d_set_angular_velocity(index, 0.0, 0.0, 3.0)?;
    engine.physics3d_step(0.1)?;

    let state = engine.physics3d_get_body_state(index)?;
    assert_eq!(state.len(), 13);
    let parity = commit(&mut engine)?;
    let qz = f32_of(&engine, parity, index, 20);
    let qw = f32_of(&engine, parity, index, 24);
    assert_eq!(
        (qz * 10_000.0).round() as i32,
        (state[5] * 10_000.0).round() as i32
    );
    assert_eq!(
        (qw * 10_000.0).round() as i32,
        (state[6] * 10_000.0).round() as i32
    );
    assert_eq!(qz.partial_cmp(&0.0), Some(Ordering::Greater));
    assert_eq!(qz.partial_cmp(&1.0), Some(Ordering::Less));
    Ok(())
}

#[test]
fn a_dynamic_body_stepped_twice_snaps_once_and_then_interpolates() -> Result<(), Physics3DError> {
    let mut engine = engine_with_world()?;
    let id = engine.create_entity().map_err(Physics3DError::Core)?;
    let index = id.index();
    add_body(&mut engine, index, 0.0, 10.0, 0.0, DYNAMIC)?;

    let first = commit(&mut engine)?;
    assert_eq!(
        flags_of(&engine, first, index),
        FLAG_HAS_TRANSFORM | FLAG_TELEPORT
    );
    assert_eq!(FLAG_HAS_TRANSFORM | FLAG_TELEPORT, 0b101);
    let y0 = f32_of(&engine, first, index, 4);

    engine.physics3d_step(0.1)?;
    let second = commit(&mut engine)?;
    assert_eq!(flags_of(&engine, second, index), FLAG_HAS_TRANSFORM);
    assert_eq!(FLAG_HAS_TRANSFORM, 0b001);
    let y1 = f32_of(&engine, second, index, 4);
    assert_eq!(y1.partial_cmp(&y0), Some(Ordering::Less));
    Ok(())
}

#[test]
fn an_existing_3d_node_is_left_unchanged_by_a_body() -> Result<(), Physics3DError> {
    let mut engine = engine_with_world()?;
    let id = engine.create_entity().map_err(Physics3DError::Core)?;
    let index = id.index();
    engine.transform3d_add(index, 7.0, 7.0, 7.0, 0.0, 0.0, 0.0, 1.0, 2.0, 2.0, 2.0);
    add_body(&mut engine, index, 1.0, 2.0, 3.0, DYNAMIC)?;

    let parity = commit(&mut engine)?;
    assert_eq!(f32_of(&engine, parity, index, 0), 7.0);
    assert_eq!(f32_of(&engine, parity, index, 4), 7.0);
    assert_eq!(f32_of(&engine, parity, index, 8), 7.0);
    assert_eq!(f32_of(&engine, parity, index, 28), 2.0);
    Ok(())
}

#[test]
fn a_body_child_keeps_its_parent_and_only_its_local_pose_moves() -> Result<(), Physics3DError> {
    let mut engine = engine_with_world()?;
    let parent = engine.create_entity().map_err(Physics3DError::Core)?;
    let child = engine.create_entity().map_err(Physics3DError::Core)?;
    engine.transform3d_add(
        parent.index(),
        0.0,
        100.0,
        0.0,
        0.0,
        0.0,
        0.0,
        1.0,
        1.0,
        1.0,
        1.0,
    );
    add_body(&mut engine, child.index(), 0.0, 10.0, 0.0, DYNAMIC)?;
    engine
        .transform3d_set_parent(child.index(), parent.index())
        .map_err(Physics3DError::Core)?;
    engine.physics3d_step(0.1)?;

    let state = engine.physics3d_get_body_state(child.index())?;
    assert_eq!(state.len(), 13);
    let parity = commit(&mut engine)?;
    assert_eq!(f32_of(&engine, parity, child.index(), 4), 100.0 + state[1]);
    Ok(())
}

#[test]
fn a_refused_body_creates_no_node() -> Result<(), Physics3DError> {
    let mut engine = engine_with_world()?;
    let id = engine.create_entity().map_err(Physics3DError::Core)?;
    let index = id.index();
    assert_eq!(
        add_body(&mut engine, index, 5.0, 5.0, 5.0, 9),
        Err(Physics3DError::InvalidBodyKind { kind: 9 })
    );
    let refused = commit(&mut engine)?;
    assert_eq!(u32::from(zero_slot(&engine, refused, index)), 1);

    add_body(&mut engine, index, 3.0, 4.0, 5.0, DYNAMIC)?;
    assert_eq!(
        add_body(&mut engine, index, 9.0, 9.0, 9.0, DYNAMIC),
        Err(Physics3DError::BodyAlreadyExists { slot: index })
    );
    let kept = commit(&mut engine)?;
    assert_eq!(f32_of(&engine, kept, index, 0), 3.0);
    assert_eq!(f32_of(&engine, kept, index, 4), 4.0);
    assert_eq!(f32_of(&engine, kept, index, 8), 5.0);
    Ok(())
}

#[test]
fn a_body_without_a_world_creates_no_node() -> Result<(), Physics3DError> {
    let mut engine = Engine::new(8).map_err(Physics3DError::Core)?;
    let id = engine.create_entity().map_err(Physics3DError::Core)?;
    assert_eq!(
        add_body(&mut engine, id.index(), 3.0, 4.0, 5.0, DYNAMIC),
        Err(Physics3DError::WorldNotInitialized)
    );
    let parity = commit(&mut engine)?;
    assert_eq!(u32::from(zero_slot(&engine, parity, id.index())), 1);
    Ok(())
}

#[test]
fn a_slot_without_a_live_entity_gets_no_node() -> Result<(), Physics3DError> {
    let mut engine = engine_with_world()?;
    // Slot 5 was never created. The commit packs generation `u32::MAX`, so a
    // node created despite the liveness guard would show up in that slot.
    add_body(&mut engine, 5, 3.0, 4.0, 5.0, FIXED)?;
    let dead = engine.create_entity().map_err(Physics3DError::Core)?;
    let deleted = engine
        .delete_entity(dead.index(), dead.generation())
        .map_err(Physics3DError::Core)?;
    assert_eq!(u32::from(deleted), 1);
    add_body(&mut engine, dead.index(), 6.0, 7.0, 8.0, FIXED)?;
    // A deleted record is skipped by the commit even when a node exists, so a
    // zero slot here does not prove the guard. The read does: no node was stored.
    let ptr = engine.alloc_shared_buffer(40);
    assert_ne!(ptr, 0, "40-byte shared buffer is allocated");
    let found = engine
        .transform3d_read_world(dead.index(), ptr)
        .map_err(Physics3DError::Core)?;
    assert_eq!(u32::from(found), 0);

    let again = engine.create_entity().map_err(Physics3DError::Core)?;
    assert_eq!(again.index(), dead.index());
    assert_ne!(again.generation(), dead.generation());
    let inherited = engine
        .transform3d_read_world(again.index(), ptr)
        .map_err(Physics3DError::Core)?;
    assert_eq!(u32::from(inherited), 0);

    let parity = commit(&mut engine)?;
    assert_eq!(u32::from(zero_slot(&engine, parity, 5)), 1);
    assert_eq!(u32::from(zero_slot(&engine, parity, dead.index())), 1);
    assert_eq!(u32::from(zero_slot(&engine, parity, again.index())), 1);
    Ok(())
}

#[test]
fn two_engines_keep_their_own_body_nodes() -> Result<(), Physics3DError> {
    let mut a = engine_with_world()?;
    let mut b = engine_with_world()?;
    let ia = a.create_entity().map_err(Physics3DError::Core)?.index();
    let ib = b.create_entity().map_err(Physics3DError::Core)?.index();
    assert_eq!(ia, ib);
    add_body(&mut a, ia, 1.0, 2.0, 3.0, DYNAMIC)?;
    add_body(&mut b, ib, 8.0, 9.0, 10.0, DYNAMIC)?;

    let pa = commit(&mut a)?;
    let pb = commit(&mut b)?;
    assert_eq!(f32_of(&a, pa, ia, 0), 1.0);
    assert_eq!(f32_of(&b, pb, ib, 0), 8.0);
    assert_ne!(a.transform3d_history_ptr(0), b.transform3d_history_ptr(0));
    Ok(())
}

#[test]
fn a_root_body_step_moves_its_clean_child() -> Result<(), Physics3DError> {
    let mut engine = engine_with_world()?;
    let parent = engine.create_entity().map_err(Physics3DError::Core)?;
    let child = engine.create_entity().map_err(Physics3DError::Core)?;
    add_body(&mut engine, parent.index(), 0.0, 10.0, 0.0, DYNAMIC)?;
    engine.transform3d_add(
        child.index(),
        0.0,
        1.0,
        0.0,
        0.0,
        0.0,
        0.0,
        1.0,
        1.0,
        1.0,
        1.0,
    );
    engine
        .transform3d_set_parent(child.index(), parent.index())
        .map_err(Physics3DError::Core)?;

    let before = commit(&mut engine)?;
    assert_eq!(f32_of(&engine, before, child.index(), 4), 11.0);

    engine.physics3d_step(0.1)?;
    let state = engine.physics3d_get_body_state(parent.index())?;
    assert_eq!(state.len(), 13);
    assert_eq!(state[1].partial_cmp(&10.0), Some(Ordering::Less));
    let after = commit(&mut engine)?;
    assert_eq!(f32_of(&engine, after, child.index(), 4), state[1] + 1.0);
    Ok(())
}

#[test]
fn a_root_body_slot_matches_the_body_without_update_transforms() -> Result<(), Physics3DError> {
    let mut engine = engine_with_world()?;
    let id = engine.create_entity().map_err(Physics3DError::Core)?;
    let index = id.index();
    add_body(&mut engine, index, 0.0, 10.0, 0.0, DYNAMIC)?;
    engine.physics3d_step(0.1)?;

    let state = engine.physics3d_get_body_state(index)?;
    assert_eq!(state.len(), 13);
    assert_eq!(state[1].partial_cmp(&10.0), Some(Ordering::Less));
    let parity = engine
        .transform3d_history_commit()
        .map_err(Physics3DError::Core)?;
    assert_eq!(f32_of(&engine, parity, index, 0), state[0]);
    assert_eq!(f32_of(&engine, parity, index, 4), state[1]);
    assert_eq!(f32_of(&engine, parity, index, 8), state[2]);
    Ok(())
}

#[test]
fn kinematic_and_fixed_bodies_do_not_write_the_3d_node() -> Result<(), Physics3DError> {
    let mut engine = engine_with_world()?;
    let kinematic = engine.create_entity().map_err(Physics3DError::Core)?;
    let fixed = engine.create_entity().map_err(Physics3DError::Core)?;
    let k = kinematic.index();
    let f = fixed.index();
    add_body(&mut engine, k, 1.0, 2.0, 3.0, KINEMATIC)?;
    add_body(&mut engine, f, 4.0, 5.0, 6.0, FIXED)?;

    let stayed = commit(&mut engine)?;
    assert_eq!(f32_of(&engine, stayed, f, 0), 4.0);
    assert_eq!(f32_of(&engine, stayed, f, 4), 5.0);
    assert_eq!(f32_of(&engine, stayed, f, 8), 6.0);
    engine.physics3d_step(0.1)?;
    let fixed_state = engine.physics3d_get_body_state(f)?;
    assert_eq!(fixed_state.len(), 13);
    assert_eq!(fixed_state[0], 4.0);
    assert_eq!(fixed_state[1], 5.0);
    assert_eq!(fixed_state[2], 6.0);

    let aimed = engine.physics3d_set_kinematic_position(k, 9.0, 8.0, 7.0, 0.0, 0.0, 0.0, 1.0)?;
    assert_eq!(u32::from(aimed), 1);
    engine.physics3d_step(0.1)?;
    let moved = engine.physics3d_get_body_state(k)?;
    assert_eq!(moved.len(), 13);
    assert_eq!(moved[0], 9.0);
    assert_eq!(moved[1], 8.0);
    assert_eq!(moved[2], 7.0);

    let written = engine.physics3d_set_body_state(
        f, 20.0, 21.0, 22.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
    )?;
    assert_eq!(u32::from(written), 1);
    engine.physics3d_step(0.1)?;
    let teleported = engine.physics3d_get_body_state(f)?;
    assert_eq!(teleported.len(), 13);
    assert_eq!(teleported[0], 20.0);
    assert_eq!(teleported[1], 21.0);
    assert_eq!(teleported[2], 22.0);

    let parity = commit(&mut engine)?;
    assert_eq!(f32_of(&engine, parity, k, 0), 1.0);
    assert_eq!(f32_of(&engine, parity, k, 4), 2.0);
    assert_eq!(f32_of(&engine, parity, k, 8), 3.0);
    assert_eq!(f32_of(&engine, parity, f, 0), 4.0);
    assert_eq!(f32_of(&engine, parity, f, 4), 5.0);
    assert_eq!(f32_of(&engine, parity, f, 8), 6.0);
    Ok(())
}
