//! Per-engine 3D transform store and its 48-byte history.
//!
//! Not feature-gated: the store ships in every engine variant.
//! Each slot is 48 bytes: position xyz, quaternion xyzw, scale xyz, flags, 4 zero bytes.
//! Bit 0 means the slot has a live node. Bit 2 means the next sample snaps.

use gwen_core::bindings::Engine;
use gwen_core::{CoreError, FLAG_HAS_TRANSFORM, FLAG_TELEPORT};

const SLOT_BYTES: usize = 48;
const POSE_BYTES: usize = 40;

fn add_node(engine: &mut Engine, index: u32, x: f32, y: f32, z: f32) {
    add_at(engine, index, x, y, z, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0);
}

#[allow(
    clippy::too_many_arguments,
    reason = "wraps the 11-argument transform3d_add export"
)]
fn add_at(
    engine: &mut Engine,
    index: u32,
    x: f32,
    y: f32,
    z: f32,
    qx: f32,
    qy: f32,
    qz: f32,
    qw: f32,
    sx: f32,
    sy: f32,
    sz: f32,
) {
    engine.transform3d_add(index, x, y, z, qx, qy, qz, qw, sx, sy, sz);
}

fn scaled(value: f32) -> i32 {
    (value * 10_000.0).round() as i32
}

fn f32_at(bytes: &[u8], offset: usize) -> f32 {
    let mut buf = [0u8; 4];
    buf.copy_from_slice(&bytes[offset..offset + 4]);
    f32::from_le_bytes(buf)
}

fn flags_at(bytes: &[u8]) -> u32 {
    let mut buf = [0u8; 4];
    buf.copy_from_slice(&bytes[40..44]);
    u32::from_le_bytes(buf)
}

fn slot(engine: &Engine, buffer: u32, index: u32) -> [u8; SLOT_BYTES] {
    let base = engine.transform3d_history_ptr(buffer);
    assert_ne!(base, 0, "3D buffer {buffer} is allocated");
    let offset = base + index as usize * SLOT_BYTES;
    let mut out = [0u8; SLOT_BYTES];
    // SAFETY: `base` is the 3D history allocation of this engine, checked non-zero
    // above, and `offset` starts one 48-byte slot inside that allocation.
    unsafe {
        std::ptr::copy_nonoverlapping(offset as *const u8, out.as_mut_ptr(), SLOT_BYTES);
    }
    out
}

fn pose_of(bytes: &[u8]) -> [i32; 10] {
    let mut pose = [0i32; 10];
    for (i, cell) in pose.iter_mut().enumerate() {
        *cell = scaled(f32_at(bytes, i * 4));
    }
    pose
}

/// World pose through `transform3d_read_world`, or `None` when the slot has no node.
fn world_scaled(engine: &mut Engine, index: u32) -> Result<Option<[i32; 10]>, CoreError> {
    let ptr = engine.alloc_shared_buffer(POSE_BYTES);
    assert_ne!(ptr, 0, "40-byte shared buffer is allocated");
    let found = engine.transform3d_read_world(index, ptr)?;
    if !found {
        return Ok(None);
    }
    let mut bytes = [0u8; POSE_BYTES];
    // SAFETY: `ptr` is the live 40-byte buffer just returned by this engine.
    // The call above wrote the pose only because it returned true.
    unsafe {
        std::ptr::copy_nonoverlapping(ptr as *const u8, bytes.as_mut_ptr(), POSE_BYTES);
    }
    Ok(Some(pose_of(&bytes)))
}

fn quarter_z() -> f32 {
    0.5f32.sqrt()
}

#[test]
fn a_new_3d_node_is_packed_with_its_world_pose_and_the_snap_flag() -> Result<(), CoreError> {
    let mut engine = Engine::new(4)?;
    let id = engine.create_entity()?;
    add_at(
        &mut engine,
        id.index(),
        1.0,
        2.0,
        3.0,
        0.0,
        0.0,
        0.0,
        1.0,
        2.0,
        3.0,
        4.0,
    );
    engine.update_transforms();

    let parity = engine.transform3d_history_commit()?;
    assert_eq!(parity, 0);
    let packed = slot(&engine, parity, id.index());
    assert_eq!(f32_at(&packed, 0), 1.0);
    assert_eq!(f32_at(&packed, 4), 2.0);
    assert_eq!(f32_at(&packed, 8), 3.0);
    assert_eq!(f32_at(&packed, 12), 0.0);
    assert_eq!(f32_at(&packed, 16), 0.0);
    assert_eq!(f32_at(&packed, 20), 0.0);
    assert_eq!(f32_at(&packed, 24), 1.0);
    assert_eq!(f32_at(&packed, 28), 2.0);
    assert_eq!(f32_at(&packed, 32), 3.0);
    assert_eq!(f32_at(&packed, 36), 4.0);
    assert_eq!(flags_at(&packed), FLAG_HAS_TRANSFORM | FLAG_TELEPORT);
    assert_eq!(FLAG_HAS_TRANSFORM | FLAG_TELEPORT, 0b101);
    assert_eq!(f32_at(&packed, 44), 0.0);
    Ok(())
}

#[test]
fn the_second_commit_uses_the_other_buffer_and_clears_the_snap_flag() -> Result<(), CoreError> {
    let mut engine = Engine::new(4)?;
    let id = engine.create_entity()?;
    add_node(&mut engine, id.index(), 1.0, 0.0, 0.0);
    engine.update_transforms();
    let first = engine.transform3d_history_commit()?;
    assert_eq!(first, 0);
    assert_eq!(f32_at(&slot(&engine, first, id.index()), 0), 1.0);

    engine.transform3d_set_position(id.index(), 5.0, 0.0, 0.0);
    engine.update_transforms();
    let second = engine.transform3d_history_commit()?;
    assert_eq!(second, 1);
    assert_eq!(f32_at(&slot(&engine, second, id.index()), 0), 5.0);
    assert_eq!(f32_at(&slot(&engine, first, id.index()), 0), 1.0);
    assert_eq!(
        flags_at(&slot(&engine, second, id.index())),
        FLAG_HAS_TRANSFORM
    );
    assert_eq!(FLAG_HAS_TRANSFORM, 0b001);

    let third = engine.transform3d_history_commit()?;
    assert_eq!(third, 0);
    Ok(())
}

#[test]
fn a_child_world_pose_composes_position_rotation_and_scale() -> Result<(), CoreError> {
    let mut engine = Engine::new(4)?;
    let parent = engine.create_entity()?;
    let child = engine.create_entity()?;
    let half = quarter_z();
    // Parent scale (2, 3, 1) times local position (1, 0, 0) is (2, 0, 0).
    // The quarter turn about z maps that to (0, 2, 0). World position is (10, 2, 0).
    // Rotate-then-scale would map (1, 0, 0) to (0, 1, 0), then to (0, 3, 0): (10, 3, 0).
    // World scale is per axis: (2 * 1, 3 * 3, 1 * 1) = (2, 9, 1).
    add_at(
        &mut engine,
        parent.index(),
        10.0,
        0.0,
        0.0,
        0.0,
        0.0,
        half,
        half,
        2.0,
        3.0,
        1.0,
    );
    add_at(
        &mut engine,
        child.index(),
        1.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        1.0,
        1.0,
        3.0,
        1.0,
    );
    engine.transform3d_set_parent(child.index(), parent.index())?;

    let pose = world_scaled(&mut engine, child.index())?;
    assert_eq!(
        pose,
        Some([100_000, 20_000, 0, 0, 0, 7_071, 7_071, 20_000, 90_000, 10_000])
    );
    Ok(())
}

#[test]
fn the_setters_move_a_node_and_the_read_follows() -> Result<(), CoreError> {
    let mut engine = Engine::new(4)?;
    let id = engine.create_entity()?;
    add_node(&mut engine, id.index(), 1.0, 0.0, 0.0);
    let half = quarter_z();
    engine.transform3d_set_position(id.index(), 4.0, 5.0, 6.0);
    engine.transform3d_set_rotation(id.index(), 0.0, half, 0.0, half);
    engine.transform3d_set_scale(id.index(), 7.0, 8.0, 9.0);

    let pose = world_scaled(&mut engine, id.index())?;
    assert_eq!(
        pose,
        Some([40_000, 50_000, 60_000, 0, 7_071, 0, 7_071, 70_000, 80_000, 90_000])
    );
    Ok(())
}

#[test]
fn a_zero_or_non_finite_quaternion_is_stored_as_the_identity() -> Result<(), CoreError> {
    let mut engine = Engine::new(8)?;
    let zero = engine.create_entity()?;
    let nan = engine.create_entity()?;
    let long = engine.create_entity()?;
    let overflow = engine.create_entity()?;
    let underflow = engine.create_entity()?;
    add_at(
        &mut engine,
        zero.index(),
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        1.0,
        1.0,
        1.0,
    );
    add_at(
        &mut engine,
        nan.index(),
        0.0,
        0.0,
        0.0,
        f32::NAN,
        0.0,
        0.0,
        1.0,
        1.0,
        1.0,
        1.0,
    );
    add_at(
        &mut engine,
        long.index(),
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        3.0,
        4.0,
        1.0,
        1.0,
        1.0,
    );
    // 1e20 squared overflows f32. 1e-23 squared underflows to zero.
    add_at(
        &mut engine,
        overflow.index(),
        0.0,
        0.0,
        0.0,
        1.0e20,
        0.0,
        0.0,
        0.0,
        1.0,
        1.0,
        1.0,
    );
    add_node(&mut engine, underflow.index(), 0.0, 0.0, 0.0);
    engine.transform3d_set_rotation(underflow.index(), 0.0, 0.0, 0.0, 1.0e-23);

    let zero_pose = world_scaled(&mut engine, zero.index())?;
    let nan_pose = world_scaled(&mut engine, nan.index())?;
    let long_pose = world_scaled(&mut engine, long.index())?;
    let overflow_pose = world_scaled(&mut engine, overflow.index())?;
    let underflow_pose = world_scaled(&mut engine, underflow.index())?;
    assert_eq!(quat_of(zero_pose), Some([0, 0, 0, 10_000]));
    assert_eq!(quat_of(nan_pose), Some([0, 0, 0, 10_000]));
    assert_eq!(quat_of(long_pose), Some([0, 0, 6_000, 8_000]));
    assert_eq!(quat_of(overflow_pose), Some([0, 0, 0, 10_000]));
    assert_eq!(quat_of(underflow_pose), Some([0, 0, 0, 10_000]));
    Ok(())
}

fn quat_of(pose: Option<[i32; 10]>) -> Option<[i32; 4]> {
    pose.map(|pose| [pose[3], pose[4], pose[5], pose[6]])
}

#[test]
fn adding_a_3d_node_to_an_entity_that_has_one_keeps_the_first() -> Result<(), CoreError> {
    let mut engine = Engine::new(4)?;
    let id = engine.create_entity()?;
    add_node(&mut engine, id.index(), 1.0, 2.0, 3.0);
    add_node(&mut engine, id.index(), 9.0, 9.0, 9.0);

    let pose = world_scaled(&mut engine, id.index())?;
    assert_eq!(
        pose,
        Some([10_000, 20_000, 30_000, 0, 0, 0, 10_000, 10_000, 10_000, 10_000])
    );
    Ok(())
}

#[test]
fn an_entity_with_no_3d_node_reads_false_and_packs_48_zero_bytes() -> Result<(), CoreError> {
    let mut engine = Engine::new(4)?;
    let id = engine.create_entity()?;
    assert_eq!(world_scaled(&mut engine, id.index())?, None);

    engine.update_transforms();
    let parity = engine.transform3d_history_commit()?;
    assert_eq!(slot(&engine, parity, id.index()), [0u8; SLOT_BYTES]);
    Ok(())
}

#[test]
fn transform3d_read_world_refuses_a_pointer_that_is_not_a_live_buffer() -> Result<(), CoreError> {
    let mut engine = Engine::new(4)?;
    let id = engine.create_entity()?;
    add_node(&mut engine, id.index(), 1.0, 0.0, 0.0);
    assert_eq!(
        engine.transform3d_read_world(id.index(), 64),
        Err(CoreError::InvalidSharedBuffer { ptr: 64, len: 0 })
    );

    let short = engine.alloc_shared_buffer(39);
    assert_ne!(short, 0, "39-byte shared buffer is allocated");
    assert_eq!(
        engine.transform3d_read_world(id.index(), short),
        Err(CoreError::InvalidSharedBuffer {
            ptr: short,
            len: 39
        })
    );

    let empty = engine.create_entity()?;
    assert_eq!(
        engine.transform3d_read_world(empty.index(), 64),
        Err(CoreError::InvalidSharedBuffer { ptr: 64, len: 0 })
    );
    Ok(())
}

#[test]
fn transform3d_mark_teleport_sets_the_snap_flag_on_one_commit_only() -> Result<(), CoreError> {
    let mut engine = Engine::new(4)?;
    let id = engine.create_entity()?;
    add_node(&mut engine, id.index(), 1.0, 0.0, 0.0);
    engine.update_transforms();

    let first = engine.transform3d_history_commit()?;
    assert_eq!(
        flags_at(&slot(&engine, first, id.index())),
        FLAG_HAS_TRANSFORM | FLAG_TELEPORT
    );
    let second = engine.transform3d_history_commit()?;
    assert_eq!(
        flags_at(&slot(&engine, second, id.index())),
        FLAG_HAS_TRANSFORM
    );

    engine.transform3d_mark_teleport(id.index());
    let third = engine.transform3d_history_commit()?;
    assert_eq!(
        flags_at(&slot(&engine, third, id.index())),
        FLAG_HAS_TRANSFORM | FLAG_TELEPORT
    );
    let fourth = engine.transform3d_history_commit()?;
    assert_eq!(
        flags_at(&slot(&engine, fourth, id.index())),
        FLAG_HAS_TRANSFORM
    );
    Ok(())
}

#[test]
fn reparenting_sets_the_snap_flag_on_one_commit_only() -> Result<(), CoreError> {
    let mut engine = Engine::new(4)?;
    let parent = engine.create_entity()?;
    let child = engine.create_entity()?;
    add_node(&mut engine, parent.index(), 0.0, 0.0, 0.0);
    add_node(&mut engine, child.index(), 1.0, 0.0, 0.0);
    engine.update_transforms();
    let _ = engine.transform3d_history_commit()?;
    let cleared = engine.transform3d_history_commit()?;
    assert_eq!(
        flags_at(&slot(&engine, cleared, child.index())),
        FLAG_HAS_TRANSFORM
    );
    assert_eq!(
        flags_at(&slot(&engine, cleared, parent.index())),
        FLAG_HAS_TRANSFORM
    );

    engine.transform3d_set_parent(child.index(), parent.index())?;
    let snapped = engine.transform3d_history_commit()?;
    assert_eq!(
        flags_at(&slot(&engine, snapped, child.index())),
        FLAG_HAS_TRANSFORM | FLAG_TELEPORT
    );
    assert_eq!(
        flags_at(&slot(&engine, snapped, parent.index())),
        FLAG_HAS_TRANSFORM
    );
    Ok(())
}

#[test]
fn a_cycle_is_refused_and_the_hierarchy_is_unchanged() -> Result<(), CoreError> {
    let mut engine = Engine::new(4)?;
    let parent = engine.create_entity()?;
    let child = engine.create_entity()?;
    assert_eq!(parent.index(), 0);
    assert_eq!(child.index(), 1);
    add_node(&mut engine, parent.index(), 2.0, 0.0, 0.0);
    add_node(&mut engine, child.index(), -1.0, 0.0, 0.0);
    engine.transform3d_set_parent(child.index(), parent.index())?;

    let parent_world = world_scaled(&mut engine, parent.index())?;
    let child_world = world_scaled(&mut engine, child.index())?;
    assert_eq!(parent_world.map(|pose| pose[0]), Some(20_000));
    assert_eq!(child_world.map(|pose| pose[0]), Some(10_000));

    let cycle = engine.transform3d_set_parent(parent.index(), child.index());
    assert_eq!(
        cycle,
        Err(CoreError::InvalidParent {
            child: 0,
            parent: 1
        })
    );
    let self_parent = engine.transform3d_set_parent(parent.index(), parent.index());
    assert_eq!(
        self_parent,
        Err(CoreError::InvalidParent {
            child: 0,
            parent: 0
        })
    );
    assert_eq!(
        world_scaled(&mut engine, parent.index())?.map(|pose| pose[0]),
        Some(20_000)
    );
    assert_eq!(
        world_scaled(&mut engine, child.index())?.map(|pose| pose[0]),
        Some(10_000)
    );
    Ok(())
}

#[test]
fn deleting_the_parent_keeps_the_child_world_position_and_rotation() -> Result<(), CoreError> {
    let mut engine = Engine::new(4)?;
    let parent = engine.create_entity()?;
    let child = engine.create_entity()?;
    let half = quarter_z();
    // Quarter turn about z maps the child's local (0, 1, 0) to (-1, 0, 0).
    // World position is (10, 0, 0) + (-1, 0, 0) = (9, 0, 0).
    // World rotation is parent * (0, 0, 0.6, 0.8) = (0, 0, 0.7 * sqrt(2), 0.1 * sqrt(2)).
    add_at(
        &mut engine,
        parent.index(),
        10.0,
        0.0,
        0.0,
        0.0,
        0.0,
        half,
        half,
        1.0,
        1.0,
        1.0,
    );
    add_at(
        &mut engine,
        child.index(),
        0.0,
        1.0,
        0.0,
        0.0,
        0.0,
        0.6,
        0.8,
        1.0,
        1.0,
        1.0,
    );
    engine.transform3d_set_parent(child.index(), parent.index())?;

    let before = world_scaled(&mut engine, child.index())?;
    assert_eq!(
        before,
        Some([90_000, 0, 0, 0, 0, 9_899, 1_414, 10_000, 10_000, 10_000])
    );
    let deleted = engine.delete_entity(parent.index(), parent.generation())?;
    assert_eq!(u32::from(deleted), 1);
    assert_eq!(world_scaled(&mut engine, child.index())?, before);
    assert_eq!(world_scaled(&mut engine, parent.index())?, None);

    engine.transform3d_set_position(child.index(), 1.0, 2.0, 3.0);
    assert_eq!(
        world_scaled(&mut engine, child.index())?,
        Some([10_000, 20_000, 30_000, 0, 0, 9_899, 1_414, 10_000, 10_000, 10_000])
    );
    Ok(())
}

#[test]
fn deleting_an_entity_zeroes_its_3d_slot_on_the_next_commit() -> Result<(), CoreError> {
    let mut engine = Engine::new(4)?;
    let id = engine.create_entity()?;
    add_node(&mut engine, id.index(), 3.0, 4.0, 5.0);
    engine.update_transforms();
    let written = engine.transform3d_history_commit()?;
    assert_eq!(f32_at(&slot(&engine, written, id.index()), 0), 3.0);

    let deleted = engine.delete_entity(id.index(), id.generation())?;
    assert_eq!(u32::from(deleted), 1);
    let cleared = engine.transform3d_history_commit()?;
    assert_eq!(slot(&engine, cleared, id.index()), [0u8; SLOT_BYTES]);
    assert_eq!(f32_at(&slot(&engine, written, id.index()), 0), 3.0);
    Ok(())
}

#[test]
fn two_engines_keep_separate_3d_stores_and_histories() -> Result<(), CoreError> {
    let mut a = Engine::new(4)?;
    let mut b = Engine::new(4)?;
    let ia = a.create_entity()?.index();
    let ib = b.create_entity()?.index();
    assert_eq!(ia, ib);
    add_node(&mut a, ia, 1.0, 0.0, 0.0);
    add_node(&mut b, ib, 8.0, 0.0, 0.0);
    a.update_transforms();
    b.update_transforms();
    assert_eq!(b.transform3d_history_ptr(0), 0);

    let pa = a.transform3d_history_commit()?;
    let pb = b.transform3d_history_commit()?;
    assert_eq!(f32_at(&slot(&a, pa, ia), 0), 1.0);
    assert_eq!(f32_at(&slot(&b, pb, ib), 0), 8.0);
    assert_ne!(a.transform3d_history_ptr(0), b.transform3d_history_ptr(0));
    Ok(())
}

#[test]
fn no_3d_history_buffer_exists_until_the_first_3d_commit() -> Result<(), CoreError> {
    let mut engine = Engine::new(4)?;
    let id = engine.create_entity()?;
    add_node(&mut engine, id.index(), 1.0, 0.0, 0.0);
    engine.add_entity_transform(id.index(), 2.0, 0.0, 0.0, 1.0, 1.0);
    engine.update_transforms();
    assert_eq!(engine.transform3d_history_ptr(0), 0);
    assert_eq!(engine.transform3d_history_ptr(1), 0);

    let two_d = engine.transform_history_commit()?;
    assert_eq!(two_d, 0);
    assert_eq!(engine.transform3d_history_ptr(0), 0);
    assert_ne!(engine.transform_history_ptr(0), 0);

    let three_d = engine.transform3d_history_commit()?;
    assert_eq!(three_d, 0);
    assert_ne!(engine.transform3d_history_ptr(0), 0);
    assert_eq!(engine.transform3d_history_ptr(2), 0);
    Ok(())
}

#[test]
fn the_last_slot_max_entities_minus_one_is_packed() -> Result<(), CoreError> {
    let mut engine = Engine::new(2)?;
    let _first = engine.create_entity()?;
    let last = engine.create_entity()?;
    assert_eq!(last.index(), 1);
    add_node(&mut engine, last.index(), 6.0, 0.0, 0.0);
    engine.update_transforms();
    let parity = engine.transform3d_history_commit()?;
    let packed = slot(&engine, parity, 1);
    assert_eq!(f32_at(&packed, 0), 6.0);
    assert_eq!(flags_at(&packed), FLAG_HAS_TRANSFORM | FLAG_TELEPORT);
    Ok(())
}

#[test]
fn the_2d_store_and_the_3d_store_are_independent() -> Result<(), CoreError> {
    let mut engine = Engine::new(4)?;
    let flat = engine.create_entity()?;
    engine.add_entity_transform(flat.index(), 3.0, 4.0, 0.0, 1.0, 1.0);
    engine.update_transforms();
    assert_eq!(engine.get_entity_world_x(flat.index()), 3.0);
    assert_eq!(world_scaled(&mut engine, flat.index())?, None);

    let solid = engine.create_entity()?;
    add_node(&mut engine, solid.index(), 4.0, 0.0, 0.0);
    assert_eq!(engine.get_entity_world_x(solid.index()), 0.0);
    assert_eq!(
        world_scaled(&mut engine, solid.index())?,
        Some([40_000, 0, 0, 0, 0, 0, 10_000, 10_000, 10_000, 10_000])
    );
    Ok(())
}

#[test]
fn a_clean_child_and_grandchild_follow_a_moved_parent() -> Result<(), CoreError> {
    let mut engine = Engine::new(4)?;
    let parent = engine.create_entity()?;
    let child = engine.create_entity()?;
    let grandchild = engine.create_entity()?;
    add_node(&mut engine, parent.index(), 0.0, 0.0, 0.0);
    add_node(&mut engine, child.index(), 1.0, 0.0, 0.0);
    add_node(&mut engine, grandchild.index(), 1.0, 0.0, 0.0);
    engine.transform3d_set_parent(child.index(), parent.index())?;
    engine.transform3d_set_parent(grandchild.index(), child.index())?;

    assert_eq!(
        world_scaled(&mut engine, child.index())?,
        Some([10_000, 0, 0, 0, 0, 0, 10_000, 10_000, 10_000, 10_000])
    );
    assert_eq!(
        world_scaled(&mut engine, grandchild.index())?,
        Some([20_000, 0, 0, 0, 0, 0, 10_000, 10_000, 10_000, 10_000])
    );

    let half = quarter_z();
    engine.transform3d_set_position(parent.index(), 10.0, 0.0, 0.0);
    engine.transform3d_set_rotation(parent.index(), 0.0, 0.0, half, half);

    // (1, 0, 0) rotated a quarter turn about z is (0, 1, 0).
    // Child world is (10, 1, 0). Grandchild world is (10, 2, 0).
    let child_pose = Some([
        100_000, 10_000, 0, 0, 0, 7_071, 7_071, 10_000, 10_000, 10_000,
    ]);
    let grandchild_pose = Some([
        100_000, 20_000, 0, 0, 0, 7_071, 7_071, 10_000, 10_000, 10_000,
    ]);
    assert_eq!(world_scaled(&mut engine, child.index())?, child_pose);
    assert_eq!(
        world_scaled(&mut engine, grandchild.index())?,
        grandchild_pose
    );

    engine.update_transforms();
    let parity = engine.transform3d_history_commit()?;
    assert_eq!(
        pose_of(&slot(&engine, parity, child.index())),
        [100_000, 10_000, 0, 0, 0, 7_071, 7_071, 10_000, 10_000, 10_000]
    );
    assert_eq!(
        pose_of(&slot(&engine, parity, grandchild.index())),
        [100_000, 20_000, 0, 0, 0, 7_071, 7_071, 10_000, 10_000, 10_000]
    );
    Ok(())
}

#[test]
fn detaching_with_u32_max_keeps_the_local_pose_and_snaps_once() -> Result<(), CoreError> {
    let mut engine = Engine::new(4)?;
    let parent = engine.create_entity()?;
    let child = engine.create_entity()?;
    add_node(&mut engine, parent.index(), 10.0, 0.0, 0.0);
    add_node(&mut engine, child.index(), 1.0, 0.0, 0.0);
    engine.transform3d_set_parent(child.index(), parent.index())?;
    engine.update_transforms();
    let _ = engine.transform3d_history_commit()?;
    let cleared = engine.transform3d_history_commit()?;
    assert_eq!(
        flags_at(&slot(&engine, cleared, child.index())),
        FLAG_HAS_TRANSFORM
    );

    assert_eq!(
        engine.transform3d_set_parent(child.index(), u32::MAX),
        Ok(())
    );
    assert_eq!(
        world_scaled(&mut engine, child.index())?,
        Some([10_000, 0, 0, 0, 0, 0, 10_000, 10_000, 10_000, 10_000])
    );

    let snapped = engine.transform3d_history_commit()?;
    assert_eq!(
        flags_at(&slot(&engine, snapped, child.index())),
        FLAG_HAS_TRANSFORM | FLAG_TELEPORT
    );
    let quiet = engine.transform3d_history_commit()?;
    assert_eq!(
        flags_at(&slot(&engine, quiet, child.index())),
        FLAG_HAS_TRANSFORM
    );

    engine.transform3d_set_position(child.index(), 4.0, 5.0, 6.0);
    assert_eq!(
        world_scaled(&mut engine, child.index())?,
        Some([40_000, 50_000, 60_000, 0, 0, 0, 10_000, 10_000, 10_000, 10_000])
    );
    Ok(())
}

#[test]
fn set_parent_with_a_missing_node_changes_nothing() -> Result<(), CoreError> {
    let mut engine = Engine::new(4)?;
    let child = engine.create_entity()?;
    let bare = engine.create_entity()?;
    add_node(&mut engine, child.index(), 3.0, 0.0, 0.0);
    engine.update_transforms();
    let _ = engine.transform3d_history_commit()?;
    let cleared = engine.transform3d_history_commit()?;
    assert_eq!(
        flags_at(&slot(&engine, cleared, child.index())),
        FLAG_HAS_TRANSFORM
    );

    let kept = Some([30_000, 0, 0, 0, 0, 0, 10_000, 10_000, 10_000, 10_000]);
    assert_eq!(
        engine.transform3d_set_parent(child.index(), bare.index()),
        Ok(())
    );
    assert_eq!(world_scaled(&mut engine, child.index())?, kept);
    let after_missing_parent = engine.transform3d_history_commit()?;
    assert_eq!(
        flags_at(&slot(&engine, after_missing_parent, child.index())),
        FLAG_HAS_TRANSFORM
    );
    assert_eq!(FLAG_HAS_TRANSFORM, 0b001);

    assert_eq!(
        engine.transform3d_set_parent(bare.index(), child.index()),
        Ok(())
    );
    assert_eq!(world_scaled(&mut engine, child.index())?, kept);
    assert_eq!(world_scaled(&mut engine, bare.index())?, None);
    let after_missing_child = engine.transform3d_history_commit()?;
    assert_eq!(
        flags_at(&slot(&engine, after_missing_child, child.index())),
        FLAG_HAS_TRANSFORM
    );
    assert_eq!(
        slot(&engine, after_missing_child, bare.index()),
        [0u8; SLOT_BYTES]
    );
    Ok(())
}

#[test]
fn a_three_level_cycle_is_refused_and_the_hierarchy_is_unchanged() -> Result<(), CoreError> {
    let mut engine = Engine::new(4)?;
    let top = engine.create_entity()?;
    let middle = engine.create_entity()?;
    let bottom = engine.create_entity()?;
    assert_eq!(top.index(), 0);
    assert_eq!(middle.index(), 1);
    assert_eq!(bottom.index(), 2);
    add_node(&mut engine, top.index(), 1.0, 0.0, 0.0);
    add_node(&mut engine, middle.index(), 10.0, 0.0, 0.0);
    add_node(&mut engine, bottom.index(), 100.0, 0.0, 0.0);
    engine.transform3d_set_parent(middle.index(), top.index())?;
    engine.transform3d_set_parent(bottom.index(), middle.index())?;

    let cycle = engine.transform3d_set_parent(top.index(), bottom.index());
    assert_eq!(
        cycle,
        Err(CoreError::InvalidParent {
            child: 0,
            parent: 2
        })
    );
    assert_eq!(
        world_scaled(&mut engine, top.index())?.map(|pose| pose[0]),
        Some(10_000)
    );
    assert_eq!(
        world_scaled(&mut engine, middle.index())?.map(|pose| pose[0]),
        Some(110_000)
    );
    assert_eq!(
        world_scaled(&mut engine, bottom.index())?.map(|pose| pose[0]),
        Some(1_110_000)
    );

    engine.transform3d_set_position(top.index(), 5.0, 0.0, 0.0);
    assert_eq!(
        world_scaled(&mut engine, middle.index())?.map(|pose| pose[0]),
        Some(150_000)
    );
    assert_eq!(
        world_scaled(&mut engine, bottom.index())?.map(|pose| pose[0]),
        Some(1_150_000)
    );
    Ok(())
}

#[test]
fn a_never_created_slot_packs_the_snap_flag() -> Result<(), CoreError> {
    let mut engine = Engine::new(4)?;
    let _live = engine.create_entity()?;
    add_node(&mut engine, 3, 2.0, 0.0, 0.0);
    engine.update_transforms();
    let parity = engine.transform3d_history_commit()?;
    let packed = slot(&engine, parity, 3);
    assert_eq!(f32_at(&packed, 0), 2.0);
    assert_eq!(flags_at(&packed), FLAG_HAS_TRANSFORM | FLAG_TELEPORT);
    assert_eq!(FLAG_HAS_TRANSFORM | FLAG_TELEPORT, 0b101);
    assert_eq!(slot(&engine, parity, 1), [0u8; SLOT_BYTES]);
    Ok(())
}

#[test]
fn a_node_added_after_delete_leaves_a_zero_slot() -> Result<(), CoreError> {
    let mut engine = Engine::new(4)?;
    let id = engine.create_entity()?;
    let deleted = engine.delete_entity(id.index(), id.generation())?;
    assert_eq!(u32::from(deleted), 1);
    add_node(&mut engine, id.index(), 3.0, 4.0, 5.0);
    engine.update_transforms();
    let parity = engine.transform3d_history_commit()?;
    assert_eq!(slot(&engine, parity, id.index()), [0u8; SLOT_BYTES]);
    Ok(())
}

#[test]
fn an_index_at_max_entities_or_u32_max_does_not_panic_or_fill_a_slot() -> Result<(), CoreError> {
    let mut engine = Engine::new(2)?;
    // Index 2 is `max_entities`. `get_entity_generation` returns `u32::MAX`
    // when the slot has no record, and both add and read use that generation.
    add_node(&mut engine, 2, 4.0, 5.0, 6.0);
    assert_eq!(
        world_scaled(&mut engine, 2)?,
        Some([40_000, 50_000, 60_000, 0, 0, 0, 10_000, 10_000, 10_000, 10_000])
    );
    add_node(&mut engine, u32::MAX, 8.0, 0.0, 0.0);
    assert_eq!(
        world_scaled(&mut engine, u32::MAX)?,
        Some([80_000, 0, 0, 0, 0, 0, 10_000, 10_000, 10_000, 10_000])
    );

    let parity = engine.transform3d_history_commit()?;
    assert_eq!(parity, 0);
    assert_eq!(slot(&engine, parity, 0), [0u8; SLOT_BYTES]);
    assert_eq!(slot(&engine, parity, 1), [0u8; SLOT_BYTES]);
    Ok(())
}
