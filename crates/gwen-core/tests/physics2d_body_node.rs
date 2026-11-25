#![cfg(feature = "physics2d")]
//! `physics_add_rigid_body` gives a body-only entity a root transform node.
//!
//! Native only. `verify-red` runs this target without `--features physics2d`,
//! so the file is empty in that run.

use gwen_core::bindings::Engine;
use gwen_core::physics2d::Physics2DError;

const SLOT_BYTES: usize = 32;
const FLAG_HAS_TRANSFORM: u32 = 0b001;
const FLAG_TELEPORT: u32 = 0b100;

const FIXED: u8 = 0;
const DYNAMIC: u8 = 1;
const KINEMATIC: u8 = 2;

fn engine_with_world() -> Result<Engine, Physics2DError> {
    let mut engine = Engine::new(8).map_err(Physics2DError::Core)?;
    engine.physics_init(0.0, -9.81, 8);
    Ok(engine)
}

fn add_body(
    engine: &mut Engine,
    slot: u32,
    x: f32,
    y: f32,
    kind: u8,
) -> Result<u32, Physics2DError> {
    engine.physics_add_rigid_body(slot, x, y, kind, 1.0, 1.0, 0.0, 0.0, 0.0, 0.0, None, None)
}

/// Flag word of one 32-byte history slot (offset 20).
fn flags_of(engine: &Engine, buffer: u32, index: u32) -> u32 {
    let base = engine.transform_history_ptr(buffer);
    let offset = base + index as usize * SLOT_BYTES + 20;
    let mut bytes = [0u8; 4];
    // SAFETY: `base` is the history allocation of this engine, and the 4 flag
    // bytes at offset 20 stay inside the 32-byte slot of `index`.
    unsafe {
        std::ptr::copy_nonoverlapping(offset as *const u8, bytes.as_mut_ptr(), 4);
    }
    u32::from_le_bytes(bytes)
}

/// One f32 of one 32-byte history slot, at byte `offset` (8 rotation, 12 and 16 scale).
fn f32_of(engine: &Engine, buffer: u32, index: u32, offset: usize) -> f32 {
    let base = engine.transform_history_ptr(buffer);
    let address = base + index as usize * SLOT_BYTES + offset;
    let mut bytes = [0u8; 4];
    // SAFETY: `base` is the history allocation of this engine, and the 4 bytes
    // at `offset` (at most 16) stay inside the 32-byte slot of `index`.
    unsafe {
        std::ptr::copy_nonoverlapping(address as *const u8, bytes.as_mut_ptr(), 4);
    }
    f32::from_le_bytes(bytes)
}

#[test]
fn body_without_a_node_gets_a_root_node_at_the_body_position() -> Result<(), Physics2DError> {
    let mut engine = engine_with_world()?;
    let id = engine.create_entity().map_err(Physics2DError::Core)?;

    add_body(&mut engine, id.index(), 3.0, 4.0, DYNAMIC)?;
    engine.update_transforms();

    assert_eq!(engine.get_entity_world_x(id.index()), 3.0);
    assert_eq!(engine.get_entity_world_y(id.index()), 4.0);
    Ok(())
}

#[test]
fn fixed_and_kinematic_bodies_get_a_node_too() -> Result<(), Physics2DError> {
    let mut engine = engine_with_world()?;
    let fixed = engine.create_entity().map_err(Physics2DError::Core)?;
    let kinematic = engine.create_entity().map_err(Physics2DError::Core)?;

    add_body(&mut engine, fixed.index(), 5.0, 6.0, FIXED)?;
    add_body(&mut engine, kinematic.index(), 7.0, 8.0, KINEMATIC)?;
    engine.update_transforms();

    assert_eq!(engine.get_entity_world_x(fixed.index()), 5.0);
    assert_eq!(engine.get_entity_world_y(kinematic.index()), 8.0);
    Ok(())
}

#[test]
fn dynamic_body_without_a_node_follows_rapier_after_a_step() -> Result<(), Physics2DError> {
    let mut engine = engine_with_world()?;
    let id = engine.create_entity().map_err(Physics2DError::Core)?;
    let index = id.index();
    add_body(&mut engine, index, 0.0, 10.0, DYNAMIC)?;

    engine.physics_step(0.1)?;

    let pose = engine.physics_get_position(index)?;
    assert_eq!(pose.len(), 3);
    assert_eq!(pose[1].partial_cmp(&10.0), Some(std::cmp::Ordering::Less));
    assert_eq!(engine.get_entity_world_y(index), pose[1]);
    assert_eq!(engine.get_entity_world_rotation(index), pose[2]);
    Ok(())
}

#[test]
fn the_first_history_commit_snaps_a_body_only_entity() -> Result<(), Physics2DError> {
    let mut engine = engine_with_world()?;
    let id = engine.create_entity().map_err(Physics2DError::Core)?;
    let index = id.index();
    add_body(&mut engine, index, 3.0, 4.0, DYNAMIC)?;
    engine.update_transforms();

    let first = engine
        .transform_history_commit()
        .map_err(Physics2DError::Core)?;
    assert_eq!(
        flags_of(&engine, first, index),
        FLAG_HAS_TRANSFORM | FLAG_TELEPORT
    );
    // The new root node has rotation 0 and scale 1 (slot offsets 8, 12, 16).
    assert_eq!(f32_of(&engine, first, index, 8), 0.0);
    assert_eq!(f32_of(&engine, first, index, 12), 1.0);
    assert_eq!(f32_of(&engine, first, index, 16), 1.0);

    engine.physics_step(0.1)?;
    engine.update_transforms();
    let second = engine
        .transform_history_commit()
        .map_err(Physics2DError::Core)?;
    assert_eq!(flags_of(&engine, second, index), FLAG_HAS_TRANSFORM);
    Ok(())
}

#[test]
fn two_engines_keep_their_own_body_nodes() -> Result<(), Physics2DError> {
    let mut a = engine_with_world()?;
    let mut b = engine_with_world()?;
    let ia = a.create_entity().map_err(Physics2DError::Core)?.index();
    let ib = b.create_entity().map_err(Physics2DError::Core)?.index();
    assert_eq!(ia, ib);

    add_body(&mut a, ia, 1.0, 2.0, DYNAMIC)?;
    add_body(&mut b, ib, 8.0, 9.0, DYNAMIC)?;
    a.update_transforms();
    b.update_transforms();

    assert_eq!(a.get_entity_world_x(ia), 1.0);
    assert_eq!(b.get_entity_world_x(ib), 8.0);
    Ok(())
}

#[test]
fn a_refused_body_creates_no_node() -> Result<(), Physics2DError> {
    let mut engine = engine_with_world()?;
    let id = engine.create_entity().map_err(Physics2DError::Core)?;
    let index = id.index();

    // An unknown body kind is refused and leaves the hierarchy untouched.
    assert_eq!(
        add_body(&mut engine, index, 5.0, 5.0, 9),
        Err(Physics2DError::InvalidBodyKind { kind: 9 })
    );
    engine.update_transforms();
    assert_eq!(engine.get_entity_world_x(index), 0.0);

    // A second add on the same slot is refused and keeps the first node.
    add_body(&mut engine, index, 3.0, 4.0, DYNAMIC)?;
    assert_eq!(
        add_body(&mut engine, index, 9.0, 9.0, DYNAMIC),
        Err(Physics2DError::BodyAlreadyExists { slot: index })
    );
    engine.update_transforms();
    assert_eq!(engine.get_entity_world_x(index), 3.0);
    Ok(())
}

#[test]
fn removing_the_body_keeps_its_node() -> Result<(), Physics2DError> {
    let mut engine = engine_with_world()?;
    let id = engine.create_entity().map_err(Physics2DError::Core)?;
    let index = id.index();
    add_body(&mut engine, index, 3.0, 4.0, DYNAMIC)?;

    engine.physics_remove_rigid_body(index)?;
    engine.update_transforms();

    assert_eq!(engine.get_entity_world_x(index), 3.0);
    Ok(())
}
