//! Observable physics3d world, body and force export behaviour through `Engine`.
//!
//! Native only. Run with `--features physics3d`. Every case reaches the exports
//! through the public `Engine` methods that JavaScript calls.

#![cfg(feature = "physics3d")]

use gwen_core::bindings::Engine;
use gwen_core::physics3d::Physics3DError;
use std::cmp::Ordering;

const NOT_INITIALIZED: &str = "PHYSICS3D:NOT_INITIALIZED";
const BODY_NOT_FOUND: &str = "PHYSICS3D:BODY_NOT_FOUND";
const BODY_ALREADY_EXISTS: &str = "PHYSICS3D:BODY_ALREADY_EXISTS";
const INVALID_BODY_KIND: &str = "PHYSICS3D:INVALID_BODY_KIND";

const ALL_BITS: u32 = 0xFFFF_FFFF;

fn engine() -> Result<Engine, Physics3DError> {
    Engine::new(8).map_err(Physics3DError::Core)
}

fn init(engine: &mut Engine) {
    engine.physics3d_init(0.0, 0.0, 0.0, 8);
}

fn code<T>(result: Result<T, Physics3DError>) -> &'static str {
    match result {
        Ok(_) => "OK",
        Err(err) => err.code(),
    }
}

/// Add a body at `(x, 2, 3)` with mass 1 and no damping.
fn add(engine: &mut Engine, slot: u32, x: f32, kind: u8) -> Result<bool, Physics3DError> {
    engine.physics3d_add_body(slot, x, 2.0, 3.0, kind, 1.0, 0.0, 0.0)
}

/// Every export name paired with the code it returned (`"OK"` on success).
type Outcomes = Vec<(&'static str, &'static str)>;

fn all_equal_to(outcomes: &Outcomes, expected: &'static str) -> Outcomes {
    outcomes.iter().map(|(name, _)| (*name, expected)).collect()
}

/// Call every converted slot-addressed export on `slot`, except the Vec getters.
fn call_slot_exports(engine: &mut Engine, slot: u32) -> Outcomes {
    vec![
        ("remove_body", code(engine.physics3d_remove_body(slot))),
        (
            "set_body_state",
            code(engine.physics3d_set_body_state(
                slot, 1.0, 2.0, 3.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
            )),
        ),
        (
            "set_linear_velocity",
            code(engine.physics3d_set_linear_velocity(slot, 1.0, 0.0, 0.0)),
        ),
        (
            "set_angular_velocity",
            code(engine.physics3d_set_angular_velocity(slot, 1.0, 0.0, 0.0)),
        ),
        (
            "apply_impulse",
            code(engine.physics3d_apply_impulse(slot, 1.0, 0.0, 0.0)),
        ),
        (
            "apply_angular_impulse",
            code(engine.physics3d_apply_angular_impulse(slot, 1.0, 0.0, 0.0)),
        ),
        (
            "set_kinematic_position",
            code(engine.physics3d_set_kinematic_position(slot, 1.0, 2.0, 3.0, 0.0, 0.0, 0.0, 1.0)),
        ),
        (
            "add_force",
            code(engine.physics3d_add_force(slot, 1.0, 0.0, 0.0)),
        ),
        (
            "add_torque",
            code(engine.physics3d_add_torque(slot, 1.0, 0.0, 0.0)),
        ),
        (
            "add_force_at_point",
            code(engine.physics3d_add_force_at_point(slot, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0)),
        ),
        (
            "set_gravity_scale",
            code(engine.physics3d_set_gravity_scale(slot, 0.5)),
        ),
        (
            "get_gravity_scale",
            code(engine.physics3d_get_gravity_scale(slot)),
        ),
        (
            "lock_translations",
            code(engine.physics3d_lock_translations(slot, true, false, false)),
        ),
        (
            "lock_rotations",
            code(engine.physics3d_lock_rotations(slot, true, false, false)),
        ),
        (
            "set_body_sleeping",
            code(engine.physics3d_set_body_sleeping(slot, true)),
        ),
        (
            "is_body_sleeping",
            code(engine.physics3d_is_body_sleeping(slot)),
        ),
        (
            "set_body_solver_iterations",
            code(engine.physics3d_set_body_solver_iterations(slot, 4)),
        ),
        (
            "set_body_kind",
            code(engine.physics3d_set_body_kind(slot, 1)),
        ),
        ("get_body_kind", code(engine.physics3d_get_body_kind(slot))),
        (
            "get_sensor_state",
            code(engine.physics3d_get_sensor_state(slot, 1)),
        ),
        (
            "update_sensor_state",
            code(engine.physics3d_update_sensor_state(slot, 1, true, 1)),
        ),
    ]
}

/// Call every converted export that needs only a world, plus the Vec getters.
fn call_world_exports(engine: &mut Engine) -> Outcomes {
    vec![
        ("step", code(engine.physics3d_step(0.016))),
        ("set_quality", code(engine.physics3d_set_quality(2))),
        (
            "set_event_coalescing",
            code(engine.physics3d_set_event_coalescing(true)),
        ),
        ("wake_all", code(engine.physics3d_wake_all())),
        ("consume_events", code(engine.physics3d_consume_events())),
        ("has_body", code(engine.physics3d_has_body(1))),
        (
            "add_body",
            code(engine.physics3d_add_body(1, 0.0, 0.0, 0.0, 1, 1.0, 0.0, 0.0)),
        ),
        ("get_body_state", code(engine.physics3d_get_body_state(1))),
        (
            "get_linear_velocity",
            code(engine.physics3d_get_linear_velocity(1)),
        ),
        (
            "get_angular_velocity",
            code(engine.physics3d_get_angular_velocity(1)),
        ),
        (
            "cast_ray",
            code(engine.physics3d_cast_ray(
                0.0, 5.0, 0.0, 0.0, -1.0, 0.0, 100.0, ALL_BITS, ALL_BITS, true,
            )),
        ),
        (
            "cast_shape",
            code(engine.physics3d_cast_shape(
                0.0, 5.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, -1.0, 0.0, 1, 0.5, 0.0, 0.0, 100.0,
                ALL_BITS, ALL_BITS,
            )),
        ),
        (
            "project_point",
            code(engine.physics3d_project_point(0.0, 5.0, 0.0, ALL_BITS, ALL_BITS, true)),
        ),
    ]
}

#[test]
fn every_converted_export_without_a_world_returns_not_initialized() -> Result<(), Physics3DError> {
    let mut engine = engine()?;
    let mut outcomes = call_world_exports(&mut engine);
    outcomes.extend(call_slot_exports(&mut engine, 1));
    assert_eq!(outcomes.len(), 34);
    let expected = all_equal_to(&outcomes, NOT_INITIALIZED);
    assert_eq!(outcomes, expected);
    init(&mut engine);
    assert_eq!(engine.physics3d_has_body(1), Ok(false));
    Ok(())
}

#[test]
fn every_slot_export_on_a_missing_body_returns_body_not_found() -> Result<(), Physics3DError> {
    let mut engine = engine()?;
    init(&mut engine);
    add(&mut engine, 2, 7.0, 1)?;
    let before = engine.physics3d_get_body_state(2)?;
    let outcomes = call_slot_exports(&mut engine, 1);
    assert_eq!(outcomes.len(), 21);
    let expected = all_equal_to(&outcomes, BODY_NOT_FOUND);
    assert_eq!(outcomes, expected);
    assert_eq!(engine.physics3d_has_body(1), Ok(false));
    assert_eq!(engine.physics3d_get_body_state(2)?, before);
    Ok(())
}

#[test]
fn state_and_velocity_getters_on_a_missing_body_return_an_empty_vec() -> Result<(), Physics3DError>
{
    let mut engine = engine()?;
    init(&mut engine);
    assert_eq!(engine.physics3d_get_body_state(1)?, Vec::<f32>::new());
    assert_eq!(engine.physics3d_get_linear_velocity(1)?, Vec::<f32>::new());
    assert_eq!(engine.physics3d_get_angular_velocity(1)?, Vec::<f32>::new());
    assert_eq!(engine.physics3d_has_body(1), Ok(false));
    Ok(())
}

#[test]
fn second_add_body_returns_already_exists_and_keeps_the_first_body() -> Result<(), Physics3DError> {
    let mut engine = engine()?;
    init(&mut engine);
    assert_eq!(add(&mut engine, 1, 3.0, 0), Ok(true));
    let before = engine.physics3d_get_body_state(1)?;
    let second = engine.physics3d_add_body(1, 9.0, 9.0, 9.0, 1, 5.0, 0.0, 0.0);
    assert_eq!(code(second), BODY_ALREADY_EXISTS);
    assert_eq!(engine.physics3d_get_body_state(1)?, before);
    assert_eq!(engine.physics3d_get_body_kind(1)?, 0);
    Ok(())
}

#[test]
fn add_body_with_an_unknown_kind_returns_invalid_body_kind_and_inserts_nothing(
) -> Result<(), Physics3DError> {
    let mut engine = engine()?;
    init(&mut engine);
    assert_eq!(code(add(&mut engine, 1, 1.0, 3)), INVALID_BODY_KIND);
    assert_eq!(code(add(&mut engine, 1, 1.0, 255)), INVALID_BODY_KIND);
    assert_eq!(engine.physics3d_has_body(1), Ok(false));
    assert_eq!(engine.physics3d_get_body_state(1)?, Vec::<f32>::new());
    Ok(())
}

#[test]
fn add_body_accepts_kinds_zero_one_and_two() -> Result<(), Physics3DError> {
    let mut engine = engine()?;
    init(&mut engine);
    for kind in 0..=2_u8 {
        let slot = u32::from(kind);
        assert_eq!(add(&mut engine, slot, 1.0, kind), Ok(true));
        assert_eq!(engine.physics3d_get_body_kind(slot)?, kind);
    }
    let state = engine.physics3d_get_body_state(1)?;
    assert_eq!(&state[0..3], &[1.0, 2.0, 3.0]);
    Ok(())
}

#[test]
fn set_body_kind_with_an_unknown_kind_returns_invalid_body_kind_and_keeps_the_kind(
) -> Result<(), Physics3DError> {
    let mut engine = engine()?;
    init(&mut engine);
    add(&mut engine, 1, 1.0, 0)?;
    assert_eq!(
        code(engine.physics3d_set_body_kind(1, 9)),
        INVALID_BODY_KIND
    );
    assert_eq!(engine.physics3d_get_body_kind(1)?, 0);
    assert_eq!(engine.physics3d_set_body_kind(1, 2), Ok(true));
    assert_eq!(engine.physics3d_get_body_kind(1)?, 2);
    Ok(())
}

#[test]
fn remove_body_returns_true_then_body_not_found() -> Result<(), Physics3DError> {
    let mut engine = engine()?;
    init(&mut engine);
    add(&mut engine, 1, 1.0, 1)?;
    assert_eq!(engine.physics3d_remove_body(1), Ok(true));
    assert_eq!(engine.physics3d_has_body(1), Ok(false));
    assert_eq!(code(engine.physics3d_remove_body(1)), BODY_NOT_FOUND);
    Ok(())
}

#[test]
fn set_body_state_round_trips_through_get_body_state() -> Result<(), Physics3DError> {
    let mut engine = engine()?;
    init(&mut engine);
    add(&mut engine, 1, 0.0, 1)?;
    let written = engine.physics3d_set_body_state(
        1, 4.0, 5.0, 6.0, 0.0, 0.0, 0.0, 1.0, 1.0, 2.0, 3.0, 0.25, 0.5, 0.75,
    )?;
    assert_eq!(u8::from(written), 1);
    assert_eq!(
        engine.physics3d_get_body_state(1)?,
        vec![4.0, 5.0, 6.0, 0.0, 0.0, 0.0, 1.0, 1.0, 2.0, 3.0, 0.25, 0.5, 0.75]
    );
    Ok(())
}

#[test]
fn velocity_setters_return_true_and_the_getters_read_the_values() -> Result<(), Physics3DError> {
    let mut engine = engine()?;
    init(&mut engine);
    add(&mut engine, 1, 0.0, 1)?;
    assert_eq!(
        engine.physics3d_set_linear_velocity(1, 3.0, 4.0, 5.0),
        Ok(true)
    );
    assert_eq!(
        engine.physics3d_set_angular_velocity(1, 0.5, 0.0, -0.5),
        Ok(true)
    );
    assert_eq!(
        engine.physics3d_get_linear_velocity(1)?,
        vec![3.0, 4.0, 5.0]
    );
    assert_eq!(
        engine.physics3d_get_angular_velocity(1)?,
        vec![0.5, 0.0, -0.5]
    );
    Ok(())
}

#[test]
fn apply_impulse_returns_true_and_raises_the_velocity() -> Result<(), Physics3DError> {
    let mut engine = engine()?;
    init(&mut engine);
    add(&mut engine, 1, 0.0, 1)?;
    // Rapier computes the mass properties on the first step.
    engine.physics3d_step(0.016)?;
    assert_eq!(engine.physics3d_apply_impulse(1, 2.0, 0.0, 0.0), Ok(true));
    let velocity = engine.physics3d_get_linear_velocity(1)?;
    assert_eq!(
        velocity[0].partial_cmp(&0.0),
        Some(Ordering::Greater),
        "impulse must raise vx, got {velocity:?}"
    );
    Ok(())
}

#[test]
fn gravity_scale_sleeping_locks_and_forces_return_true() -> Result<(), Physics3DError> {
    let mut engine = engine()?;
    init(&mut engine);
    add(&mut engine, 1, 0.0, 1)?;
    assert_eq!(engine.physics3d_get_gravity_scale(1)?, 1.0);
    assert_eq!(engine.physics3d_set_gravity_scale(1, 0.25), Ok(true));
    assert_eq!(engine.physics3d_get_gravity_scale(1)?, 0.25);
    assert_eq!(
        engine.physics3d_lock_translations(1, true, false, true),
        Ok(true)
    );
    assert_eq!(
        engine.physics3d_lock_rotations(1, true, true, true),
        Ok(true)
    );
    assert_eq!(engine.physics3d_add_force(1, 1.0, 0.0, 0.0), Ok(true));
    assert_eq!(engine.physics3d_add_torque(1, 0.0, 1.0, 0.0), Ok(true));
    assert_eq!(
        engine.physics3d_add_force_at_point(1, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0),
        Ok(true)
    );
    assert_eq!(
        engine.physics3d_apply_angular_impulse(1, 0.0, 1.0, 0.0),
        Ok(true)
    );
    assert_eq!(engine.physics3d_set_body_solver_iterations(1, 4), Ok(true));
    assert_eq!(engine.physics3d_set_body_sleeping(1, true), Ok(true));
    assert_eq!(engine.physics3d_is_body_sleeping(1), Ok(true));
    assert_eq!(engine.physics3d_set_body_sleeping(1, false), Ok(true));
    assert_eq!(engine.physics3d_is_body_sleeping(1), Ok(false));
    Ok(())
}

#[test]
fn set_kinematic_position_returns_true_and_the_next_step_reaches_it() -> Result<(), Physics3DError>
{
    let mut engine = engine()?;
    init(&mut engine);
    add(&mut engine, 1, 0.0, 2)?;
    assert_eq!(
        engine.physics3d_set_kinematic_position(1, 5.0, 6.0, 7.0, 0.0, 0.0, 0.0, 1.0),
        Ok(true)
    );
    engine.physics3d_step(0.016)?;
    let state = engine.physics3d_get_body_state(1)?;
    assert_eq!(&state[0..3], &[5.0, 6.0, 7.0]);
    Ok(())
}

#[test]
fn step_with_a_world_applies_gravity() -> Result<(), Physics3DError> {
    let mut engine = engine()?;
    engine.physics3d_init(0.0, -10.0, 0.0, 8);
    add(&mut engine, 1, 0.0, 1)?;
    engine.physics3d_step(0.1)?;
    let state = engine.physics3d_get_body_state(1)?;
    assert_eq!(
        state[1].partial_cmp(&2.0),
        Some(Ordering::Less),
        "y must fall below 2.0, got {}",
        state[1]
    );
    Ok(())
}

#[test]
fn world_setters_and_consume_events_return_ok_with_a_world() -> Result<(), Physics3DError> {
    let mut engine = engine()?;
    init(&mut engine);
    engine.physics3d_set_quality(3)?;
    engine.physics3d_set_event_coalescing(true)?;
    engine.physics3d_wake_all()?;
    engine.physics3d_consume_events()?;
    assert_eq!(engine.physics3d_get_collision_event_count(), 0);
    Ok(())
}

#[test]
fn event_getters_without_a_world_return_zero() -> Result<(), Physics3DError> {
    let engine = engine()?;
    assert_eq!(engine.physics3d_get_collision_event_count(), 0);
    assert_eq!(engine.physics3d_get_collision_events_ptr(), 0);
    Ok(())
}

#[test]
fn sensor_state_round_trips_for_a_registered_body() -> Result<(), Physics3DError> {
    let mut engine = engine()?;
    init(&mut engine);
    add(&mut engine, 1, 0.0, 1)?;
    assert_eq!(engine.physics3d_get_sensor_state(1, 5)?, 0);
    engine.physics3d_update_sensor_state(1, 5, true, 3)?;
    assert_eq!(engine.physics3d_get_sensor_state(1, 5)?, (1_u64 << 32) | 3);
    Ok(())
}

#[test]
fn update_sensor_state_on_a_missing_body_records_nothing() -> Result<(), Physics3DError> {
    let mut engine = engine()?;
    init(&mut engine);
    let refused = engine.physics3d_update_sensor_state(1, 5, true, 3);
    assert_eq!(code(refused), BODY_NOT_FOUND);
    add(&mut engine, 1, 0.0, 1)?;
    assert_eq!(engine.physics3d_get_sensor_state(1, 5)?, 0);
    Ok(())
}

#[test]
fn queries_return_the_miss_array_and_hit_arrays() -> Result<(), Physics3DError> {
    let mut engine = engine()?;
    init(&mut engine);
    let miss = engine.physics3d_cast_ray(
        0.0, 8.0, 3.0, 0.0, -1.0, 0.0, 100.0, ALL_BITS, ALL_BITS, true,
    )?;
    assert_eq!(miss, vec![0.0]);
    add(&mut engine, 1, 0.0, 0)?;
    let attached = engine.physics3d_add_box_collider(
        1, 0.5, 0.5, 0.5, 0.0, 0.0, 0.0, false, 0.5, 0.0, ALL_BITS, ALL_BITS, 1,
    );
    assert_eq!(u8::from(attached), 1);
    engine.physics3d_step(0.016)?;
    let hit = engine.physics3d_cast_ray(
        0.0, 8.0, 3.0, 0.0, -1.0, 0.0, 100.0, ALL_BITS, ALL_BITS, true,
    )?;
    assert_eq!(hit.len(), 9);
    assert_eq!(hit[0], 1.0);
    assert_eq!(hit[1], 1.0);
    let projected = engine.physics3d_project_point(0.0, 8.0, 3.0, ALL_BITS, ALL_BITS, true)?;
    assert_eq!(projected.len(), 6);
    assert_eq!(projected[0], 1.0);
    let swept = engine.physics3d_cast_shape(
        0.0, 8.0, 3.0, 0.0, 0.0, 0.0, 1.0, 0.0, -1.0, 0.0, 1, 0.25, 0.0, 0.0, 100.0, ALL_BITS,
        ALL_BITS,
    )?;
    assert_eq!(swept.len(), 15);
    let far = engine.physics3d_cast_ray(
        50.0, 8.0, 3.0, 0.0, -1.0, 0.0, 100.0, ALL_BITS, ALL_BITS, true,
    )?;
    assert_eq!(far, vec![0.0]);
    Ok(())
}
