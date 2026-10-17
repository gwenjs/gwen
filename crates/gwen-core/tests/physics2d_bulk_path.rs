//! Bulk length and path bounds through the public physics2d exports.
//!
//! Native only. `verify-red` runs this target without `--features physics2d`,
//! so the file is empty in that run.

#![cfg(feature = "physics2d")]

use std::sync::{Mutex, MutexGuard};

use gwen_core::bindings::Engine;
use gwen_core::physics2d::{
    find_path_2d, pathfinding::get_path_buffer_ptr, PathRequestReject, Physics2DError,
    MAX_PATH_NODES,
};
use gwen_core::CoreError;

fn engine() -> Result<Engine, Physics2DError> {
    Engine::new(8).map_err(Physics2DError::Core)
}

fn init(engine: &mut Engine) {
    engine.physics_init(0.0, 0.0, 8);
}

fn add(engine: &mut Engine, slot: u32, x: f32, y: f32, kind: u8) -> Result<u32, Physics2DError> {
    engine.physics_add_rigid_body(slot, x, y, kind, 1.0, 1.0, 0.0, 0.0, 0.0, 0.0, None, None)
}

fn path_lock() -> MutexGuard<'static, ()> {
    static LOCK: Mutex<()> = Mutex::new(());
    LOCK.lock().unwrap_or_else(|err| err.into_inner())
}

fn node_at(index: usize) -> (f32, f32) {
    // SAFETY: the caller holds `path_lock` and `index` is below MAX_PATH_NODES.
    let node = unsafe { *get_path_buffer_ptr().add(index) };
    (node.x, node.y)
}

fn prime_path() -> [(f32, f32); 2] {
    let count = find_path_2d(0.0, 0.0, 1.0, 0.0);
    assert_eq!(count, Ok(2));
    [node_at(0), node_at(1)]
}

fn refuse(start_x: f32, start_y: f32, end_x: f32, end_y: f32, reason: PathRequestReject) {
    let kept = prime_path();
    assert_eq!(
        find_path_2d(start_x, start_y, end_x, end_y),
        Err(Physics2DError::InvalidPathRequest { reason })
    );
    assert_eq!([node_at(0), node_at(1)], kept);
}

#[test]
fn mismatched_bulk_step_leaves_both_kinematic_positions() -> Result<(), Physics2DError> {
    let mut first = engine()?;
    init(&mut first);
    add(&mut first, 0, 0.0, 0.0, 2)?;
    add(&mut first, 1, 4.0, 6.0, 2)?;
    assert_eq!(
        first.physics_bulk_step_kinematics(&[0, 1], &[10.0, 0.0], &[0.0], 1.0),
        Err(Physics2DError::BufferLengthMismatch {
            buffer: "vy",
            expected: 2,
            actual: 1,
        })
    );
    assert_eq!(
        first.physics_bulk_step_kinematics(&[0, 1], &[10.0], &[0.0, 0.0], 1.0),
        Err(Physics2DError::BufferLengthMismatch {
            buffer: "vx",
            expected: 2,
            actual: 1,
        })
    );
    first.physics_step(1.0 / 60.0)?;
    assert_eq!(first.physics_get_position(0)?, vec![0.0, 0.0, 0.0]);
    assert_eq!(first.physics_get_position(1)?, vec![4.0, 6.0, 0.0]);

    let mut second = engine()?;
    init(&mut second);
    add(&mut second, 0, 3.0, 5.0, 2)?;
    add(&mut second, 1, 8.0, 1.0, 2)?;
    assert_eq!(
        second.physics_bulk_step_kinematics(&[0, 1], &[10.0, 0.0], &[0.0], 1.0),
        Err(Physics2DError::BufferLengthMismatch {
            buffer: "vy",
            expected: 2,
            actual: 1,
        })
    );
    second.physics_step(1.0 / 60.0)?;
    assert_eq!(second.physics_get_position(0)?, vec![3.0, 5.0, 0.0]);
    assert_eq!(second.physics_get_position(1)?, vec![8.0, 1.0, 0.0]);
    Ok(())
}

#[test]
fn bulk_step_without_a_world_is_not_a_zero_success() -> Result<(), Physics2DError> {
    let mut engine = engine()?;
    assert_eq!(
        engine.physics_bulk_step_kinematics(&[0], &[1.0], &[1.0], 1.0),
        Err(Physics2DError::WorldNotInitialized)
    );
    assert_eq!(
        engine.physics_bulk_step_kinematics(&[0, 1], &[1.0], &[1.0], 1.0),
        Err(Physics2DError::WorldNotInitialized)
    );
    Ok(())
}

#[test]
fn sync_from_rapier_mismatch_is_not_an_empty_read() -> Result<(), CoreError> {
    let mut engine = Engine::new(8)?;
    let type_id = engine.register_component(&[0])?;
    let id = engine.create_entity()?;
    assert_eq!(
        engine.add_component(id.index(), id.generation(), type_id, &[1, 2, 3, 4]),
        Ok(true)
    );
    let before = engine.get_component_raw(id.index(), id.generation(), type_id);
    let mut slots = [7u32];
    let mut gens = [7u32, 9];
    let mut buf = [9u8; 8];
    assert_eq!(
        engine.physics2d_bulk_sync_from_rapier(type_id, &mut slots, &mut gens, &mut buf),
        Err(CoreError::BufferLengthMismatch {
            buffer: "gens",
            expected: 1,
            actual: 2,
        })
    );
    assert_eq!(slots, [7]);
    assert_eq!(gens, [7, 9]);
    assert_eq!(buf, [9; 8]);
    assert_eq!(
        engine.get_component_raw(id.index(), id.generation(), type_id),
        before
    );

    let mut read_slots = [7u32];
    let mut read_gens = [7u32];
    let mut read_buf = [9u8; 8];
    assert_eq!(
        engine.physics2d_bulk_sync_from_rapier(
            type_id,
            &mut read_slots,
            &mut read_gens,
            &mut read_buf
        ),
        Ok(vec![1, 4])
    );
    assert_eq!(&read_buf[..4], &[1, 2, 3, 4]);

    let mut other = Engine::new(8)?;
    let other_type = other.register_component(&[0])?;
    let other_id = other.create_entity()?;
    assert_eq!(
        other.add_component(
            other_id.index(),
            other_id.generation(),
            other_type,
            &[5, 6, 7, 8]
        ),
        Ok(true)
    );
    let mut other_slots = [3u32];
    let mut other_gens = [3u32, 4];
    let mut other_buf = [1u8; 8];
    assert_eq!(
        other.physics2d_bulk_sync_from_rapier(
            other_type,
            &mut other_slots,
            &mut other_gens,
            &mut other_buf,
        ),
        Err(CoreError::BufferLengthMismatch {
            buffer: "gens",
            expected: 1,
            actual: 2,
        })
    );
    assert_eq!(
        other.get_component_raw(other_id.index(), other_id.generation(), other_type),
        Ok(vec![5, 6, 7, 8])
    );
    Ok(())
}

#[test]
fn sync_to_rapier_mismatch_leaves_the_component() -> Result<(), CoreError> {
    let mut engine = Engine::new(8)?;
    let type_id = engine.register_component(&[0])?;
    let id = engine.create_entity()?;
    assert_eq!(
        engine.add_component(id.index(), id.generation(), type_id, &[1, 2, 3, 4]),
        Ok(true)
    );
    let before = engine.get_component_raw(id.index(), id.generation(), type_id);
    assert_eq!(
        engine.physics2d_bulk_sync_to_rapier(
            &[id.index()],
            &[id.generation(), 9],
            type_id,
            &[9, 9, 9, 9],
        ),
        Err(CoreError::BufferLengthMismatch {
            buffer: "gens",
            expected: 1,
            actual: 2,
        })
    );
    assert_eq!(
        engine.physics2d_bulk_sync_to_rapier(&[id.index()], &[id.generation()], type_id, &[9]),
        Err(CoreError::BufferLengthMismatch {
            buffer: "data",
            expected: 4,
            actual: 1,
        })
    );
    assert_eq!(
        engine.get_component_raw(id.index(), id.generation(), type_id),
        before
    );

    let mut other = Engine::new(8)?;
    let other_type = other.register_component(&[0])?;
    let other_id = other.create_entity()?;
    assert_eq!(
        other.add_component(
            other_id.index(),
            other_id.generation(),
            other_type,
            &[5, 6, 7, 8]
        ),
        Ok(true)
    );
    assert_eq!(
        other.physics2d_bulk_sync_to_rapier(
            &[other_id.index()],
            &[other_id.generation(), 3],
            other_type,
            &[1, 1, 1, 1],
        ),
        Err(CoreError::BufferLengthMismatch {
            buffer: "gens",
            expected: 1,
            actual: 2,
        })
    );
    assert_eq!(
        other.get_component_raw(other_id.index(), other_id.generation(), other_type),
        Ok(vec![5, 6, 7, 8])
    );
    Ok(())
}

#[test]
fn apply_impulse_mismatch_leaves_the_component() -> Result<(), CoreError> {
    let mut engine = Engine::new(8)?;
    let type_id = engine.register_component(&[0])?;
    let id = engine.create_entity()?;
    assert_eq!(
        engine.add_component(id.index(), id.generation(), type_id, &[1, 2, 3, 4]),
        Ok(true)
    );
    let before = engine.get_component_raw(id.index(), id.generation(), type_id);
    assert_eq!(
        engine.physics2d_bulk_apply_impulse(
            &[id.index()],
            &[id.generation(), 9],
            type_id,
            &[9, 9, 9, 9],
        ),
        Err(CoreError::BufferLengthMismatch {
            buffer: "gens",
            expected: 1,
            actual: 2,
        })
    );
    assert_eq!(
        engine.get_component_raw(id.index(), id.generation(), type_id),
        before
    );

    let mut other = Engine::new(8)?;
    let other_type = other.register_component(&[0])?;
    let other_id = other.create_entity()?;
    assert_eq!(
        other.add_component(
            other_id.index(),
            other_id.generation(),
            other_type,
            &[5, 6, 7, 8]
        ),
        Ok(true)
    );
    assert_eq!(
        other.physics2d_bulk_apply_impulse(
            &[other_id.index()],
            &[other_id.generation(), 3],
            other_type,
            &[1, 1, 1, 1],
        ),
        Err(CoreError::BufferLengthMismatch {
            buffer: "gens",
            expected: 1,
            actual: 2,
        })
    );
    assert_eq!(
        other.get_component_raw(other_id.index(), other_id.generation(), other_type),
        Ok(vec![5, 6, 7, 8])
    );
    Ok(())
}

#[test]
fn nan_path_is_refused() {
    let _guard = path_lock();
    refuse(f32::NAN, 0.0, 1.0, 0.0, PathRequestReject::NonFinite);
    refuse(0.0, f32::NAN, 1.0, 0.0, PathRequestReject::NonFinite);
    refuse(0.0, 0.0, f32::NAN, 0.0, PathRequestReject::NonFinite);
    refuse(0.0, 0.0, 1.0, f32::NAN, PathRequestReject::NonFinite);
}

#[test]
fn infinite_path_is_refused() {
    let _guard = path_lock();
    refuse(f32::INFINITY, 0.0, 0.0, 0.0, PathRequestReject::NonFinite);
    refuse(
        f32::NEG_INFINITY,
        0.0,
        0.0,
        0.0,
        PathRequestReject::NonFinite,
    );
    refuse(0.0, 0.0, f32::INFINITY, 0.0, PathRequestReject::NonFinite);
    refuse(
        0.0,
        0.0,
        f32::NEG_INFINITY,
        0.0,
        PathRequestReject::NonFinite,
    );
}

#[test]
fn coord_past_the_bound_is_refused() {
    let _guard = path_lock();
    refuse(
        16_777_216.0,
        0.0,
        16_777_216.0,
        0.0,
        PathRequestReject::CoordOutOfRange,
    );
    refuse(
        -16_777_216.0,
        0.0,
        0.0,
        0.0,
        PathRequestReject::CoordOutOfRange,
    );
}

#[test]
fn coord_at_the_bound_is_accepted() {
    let _guard = path_lock();
    assert_eq!(find_path_2d(16_777_215.0, 0.0, 16_777_215.0, 0.0), Ok(1));
    assert_eq!(node_at(0), (16_777_215.0, 0.0));
    assert_eq!(find_path_2d(-16_777_215.0, 0.0, -16_777_215.0, 0.0), Ok(1));
    assert_eq!(node_at(0), (-16_777_215.0, 0.0));
}

#[test]
fn distance_past_the_bound_is_refused() {
    let _guard = path_lock();
    refuse(0.0, 0.0, 256.0, 0.0, PathRequestReject::DistanceOutOfRange);
}

#[test]
fn distance_at_the_bound_is_accepted() {
    let _guard = path_lock();
    assert_eq!(find_path_2d(0.0, 0.0, 255.0, 0.0), Ok(MAX_PATH_NODES));
    assert_eq!(node_at(0), (0.0, 0.0));
    assert_eq!(node_at(MAX_PATH_NODES - 1), (255.0, 0.0));
}

#[test]
fn i32_scale_coordinate_is_refused() {
    let _guard = path_lock();
    refuse(
        2_147_483_648.0,
        0.0,
        2_147_483_648.0,
        0.0,
        PathRequestReject::CoordOutOfRange,
    );
    refuse(
        -2_147_483_648.0,
        0.0,
        0.0,
        0.0,
        PathRequestReject::CoordOutOfRange,
    );
}

#[test]
fn path_find_2d_refuses_the_same_nan() -> Result<(), Physics2DError> {
    let _guard = path_lock();
    let mut first = engine()?;
    let mut second = engine()?;
    let count = find_path_2d(0.0, 0.0, 1.0, 0.0)?;
    assert_eq!(count, 2);
    let kept = [node_at(0), node_at(1)];
    assert_eq!(
        first.path_find_2d(f32::NAN, 0.0, 1.0, 0.0),
        Err(Physics2DError::InvalidPathRequest {
            reason: PathRequestReject::NonFinite,
        })
    );
    assert_eq!(
        second.path_find_2d(0.0, 0.0, 16_777_216.0, 0.0),
        Err(Physics2DError::InvalidPathRequest {
            reason: PathRequestReject::CoordOutOfRange,
        })
    );
    assert_eq!(
        first.path_find_2d(0.0, 0.0, 256.0, 0.0),
        Err(Physics2DError::InvalidPathRequest {
            reason: PathRequestReject::DistanceOutOfRange,
        })
    );
    assert_eq!([node_at(0), node_at(1)], kept);
    assert_eq!(first.path_find_2d(0.0, 0.0, 1.0, 0.0)?, 2);
    Ok(())
}
