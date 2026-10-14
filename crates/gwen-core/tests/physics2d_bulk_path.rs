//! Bulk length and path bounds through the public physics2d exports.
//!
//! Native only. `verify-red` runs this target without `--features physics2d`,
//! so the file is empty in that run.

#![cfg(feature = "physics2d")]

use std::sync::{Mutex, MutexGuard};

use gwen_core::bindings::Engine;
use gwen_core::physics2d::{find_path_2d, pathfinding::get_path_buffer_ptr, Physics2DError};

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

#[test]
fn mismatched_bulk_step_leaves_both_kinematic_positions() -> Result<(), Physics2DError> {
    let mut engine = engine()?;
    init(&mut engine);
    add(&mut engine, 0, 0.0, 0.0, 2)?;
    add(&mut engine, 1, 4.0, 6.0, 2)?;
    let _updated = engine.physics_bulk_step_kinematics(&[0, 1], &[10.0, 0.0], &[0.0], 1.0);
    engine.physics_step(1.0 / 60.0)?;
    assert_eq!(engine.physics_get_position(0)?, vec![0.0, 0.0, 0.0]);
    assert_eq!(engine.physics_get_position(1)?, vec![4.0, 6.0, 0.0]);
    Ok(())
}

#[test]
fn bulk_step_without_a_world_is_not_a_zero_success() -> Result<(), Physics2DError> {
    let mut engine = engine()?;
    let updated = engine.physics_bulk_step_kinematics(&[0], &[1.0], &[1.0], 1.0);
    assert_ne!(updated, 0);
    Ok(())
}

#[test]
fn sync_from_rapier_mismatch_is_not_an_empty_read() -> Result<(), Physics2DError> {
    let mut engine = engine()?;
    let type_id = engine.register_component_type();
    let id = engine.create_entity().map_err(Physics2DError::Core)?;
    assert_eq!(
        engine
            .add_component(id.index(), id.generation(), type_id, &[1, 2, 3, 4])
            .map_err(Physics2DError::Core)?,
        true
    );
    let mut slots = [7u32];
    let mut gens = [7u32, 9];
    let mut buf = [9u8; 8];
    let got = engine.physics2d_bulk_sync_from_rapier(type_id, &mut slots, &mut gens, &mut buf);
    assert_ne!(got, vec![0, 0]);
    Ok(())
}

#[test]
fn nan_path_is_refused() {
    let _guard = path_lock();
    assert_eq!(find_path_2d(f32::NAN, 0.0, 1.0, 0.0), 0);
    assert_eq!(find_path_2d(0.0, f32::NAN, 1.0, 0.0), 0);
    assert_eq!(find_path_2d(0.0, 0.0, f32::NAN, 0.0), 0);
    assert_eq!(find_path_2d(0.0, 0.0, 1.0, f32::NAN), 0);
}

#[test]
fn infinite_path_is_refused() {
    let _guard = path_lock();
    assert_eq!(find_path_2d(f32::INFINITY, 0.0, 0.0, 0.0), 0);
    assert_eq!(find_path_2d(f32::NEG_INFINITY, 0.0, 0.0, 0.0), 0);
    assert_eq!(find_path_2d(0.0, 0.0, f32::INFINITY, 0.0), 0);
    assert_eq!(find_path_2d(0.0, 0.0, f32::NEG_INFINITY, 0.0), 0);
}

#[test]
fn coord_past_the_bound_is_refused() {
    let _guard = path_lock();
    assert_eq!(find_path_2d(16_777_216.0, 0.0, 16_777_216.0, 0.0), 0);
    assert_eq!(find_path_2d(-16_777_216.0, 0.0, 0.0, 0.0), 0);
}

#[test]
fn distance_past_the_bound_is_refused() {
    let _guard = path_lock();
    assert_eq!(find_path_2d(0.0, 0.0, 256.0, 0.0), 0);
}

#[test]
fn i32_scale_coordinate_is_refused() {
    let _guard = path_lock();
    assert_eq!(find_path_2d(2_147_483_648.0, 0.0, 2_147_483_648.0, 0.0), 0);
    assert_eq!(find_path_2d(-2_147_483_648.0, 0.0, 0.0, 0.0), 0);
}

#[test]
fn path_find_2d_refuses_the_same_nan() -> Result<(), Physics2DError> {
    let _guard = path_lock();
    let mut engine = engine()?;
    assert_eq!(engine.path_find_2d(f32::NAN, 0.0, 1.0, 0.0), 0);
    let _ = get_path_buffer_ptr();
    Ok(())
}
