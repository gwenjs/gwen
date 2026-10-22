//! Physics2d step and query inputs that can abort the instance.
//!
//! The public path is `Engine`. `PhysicsWorld::step` stores `delta` and calls
//! `PhysicsPipeline::step` with no input check (`world.rs:755`). `point_query`
//! forwards the point to Rapier (`world.rs:668`).
#![cfg(feature = "physics2d")]

use gwen_core::bindings::Engine;
use gwen_core::physics2d::Physics2DError;

const ALL: u32 = 0xFFFF_FFFF;
const MAX_WORLD_EXTENT: f32 = 1.0e7;
const MAX_LINEAR_VELOCITY: f32 = 400.0;
const DT: f32 = 1.0 / 60.0;

const GROUND: u32 = 0;
const OFFENDER: u32 = 1;
const OTHER: u32 = 2;
const OUT_OF_BOUNDS: u32 = 1;

fn engine(gravity_y: f32) -> Result<Engine, Physics2DError> {
    let mut engine = Engine::new(16).map_err(Physics2DError::Core)?;
    engine.physics_init(0.0, gravity_y, 16);
    Ok(engine)
}

fn add_box(
    engine: &mut Engine,
    slot: u32,
    x: f32,
    y: f32,
    kind: u8,
    half: (f32, f32),
    restitution: f32,
) -> Result<(), Physics2DError> {
    let handle = engine
        .physics_add_rigid_body(slot, x, y, kind, 1.0, 1.0, 0.0, 0.0, 0.0, 0.0, None, None)?;
    engine.physics_add_box_collider(
        handle,
        half.0,
        half.1,
        restitution,
        0.0,
        0,
        1.0,
        ALL,
        ALL,
        None,
        None,
        None,
        None,
    )
}

fn with_body() -> Result<Engine, Physics2DError> {
    let mut engine = engine(0.0)?;
    add_box(&mut engine, 0, 0.0, 0.0, 1, (0.5, 0.5), 0.0)?;
    Ok(engine)
}

fn position_y(engine: &Engine, slot: u32) -> Result<f32, Physics2DError> {
    let pose = engine.physics_get_position(slot)?;
    assert_eq!(pose.len(), 3, "position for slot {slot}");
    Ok(pose[1])
}

fn speed(engine: &Engine, slot: u32) -> Result<f32, Physics2DError> {
    let velocity = engine.physics_get_linear_velocity(slot)?;
    assert_eq!(velocity.len(), 2, "velocity for slot {slot}");
    Ok((velocity[0] * velocity[0] + velocity[1] * velocity[1]).sqrt())
}

/// `""` when the export accepted the input. The base has no `INVALID_*` variant.
fn code_of<T>(result: &Result<T, Physics2DError>) -> &'static str {
    match result {
        Ok(_) => "",
        Err(err) => err.code(),
    }
}

fn drained_reasons(raw: &[u32]) -> Vec<(u32, &'static str)> {
    let mut reasons = Vec::new();
    let mut index = 0;
    while index + 1 < raw.len() {
        let reason = match raw[index + 1] {
            0 => "non-finite",
            OUT_OF_BOUNDS => "out-of-bounds",
            2 => "velocity",
            _ => "unknown",
        };
        reasons.push((raw[index], reason));
        index += 2;
    }
    if !raw.len().is_multiple_of(2) {
        reasons.push((u32::MAX, "odd-length"));
    }
    reasons
}

fn measured_speed(engine: &mut Engine, vx: f32) -> Result<f32, Physics2DError> {
    engine.physics_set_linear_velocity(0, vx, 0.0)?;
    engine.physics_step(DT)?;
    speed(engine, 0)
}

#[test]
fn point_query_nan_returns_invalid_query() -> Result<(), Physics2DError> {
    let engine = with_body()?;
    let result = engine.physics_point_query(f32::NAN, 0.0, ALL, ALL);
    assert_eq!(code_of(&result), "PHYSICS2D:INVALID_QUERY", "{result:?}");
    Ok(())
}

#[test]
fn query_rect_negative_half_width_returns_invalid_query() -> Result<(), Physics2DError> {
    let engine = with_body()?;
    let result = engine.physics_query_rect(0.0, 0.0, -1.0, 1.0, ALL, ALL);
    assert_eq!(code_of(&result), "PHYSICS2D:INVALID_QUERY", "{result:?}");
    Ok(())
}

#[test]
fn query_at_exactly_max_extent_is_accepted() -> Result<(), Physics2DError> {
    let engine = with_body()?;
    let result = engine.physics_point_query(MAX_WORLD_EXTENT, -MAX_WORLD_EXTENT, ALL, ALL);
    assert_eq!(
        code_of(&result),
        "",
        "point query at ±1.0e7 was refused: {result:?}"
    );
    Ok(())
}

#[test]
fn query_one_ulp_above_is_refused() -> Result<(), Physics2DError> {
    let engine = with_body()?;
    let above = MAX_WORLD_EXTENT.next_up();
    let result = engine.physics_point_query(above, 0.0, ALL, ALL);
    assert_eq!(code_of(&result), "PHYSICS2D:INVALID_QUERY", "{result:?}");
    Ok(())
}

#[test]
fn step_nan_delta_returns_invalid_step_delta() -> Result<(), Physics2DError> {
    let mut engine = with_body()?;
    let result = engine.physics_step(f32::NAN);
    assert_eq!(
        code_of(&result),
        "PHYSICS2D:INVALID_STEP_DELTA",
        "{result:?}"
    );
    Ok(())
}

#[test]
fn step_delta_above_one_returns_invalid_step_delta() -> Result<(), Physics2DError> {
    let mut engine = with_body()?;
    let result = engine.physics_step(1.0 + f32::EPSILON);
    assert_eq!(
        code_of(&result),
        "PHYSICS2D:INVALID_STEP_DELTA",
        "{result:?}"
    );
    Ok(())
}

#[test]
fn step_zero_delta_is_accepted() -> Result<(), Physics2DError> {
    let mut engine = with_body()?;
    let before = position_y(&engine, 0)?;
    let stepped = engine.physics_step(0.0);
    assert_eq!(
        code_of(&stepped),
        "",
        "physics_step refused a zero delta"
    );
    assert_eq!(position_y(&engine, 0)?, before);
    Ok(())
}

#[test]
fn velocity_above_the_clamp_is_clamped() -> Result<(), Physics2DError> {
    let mut engine = with_body()?;
    let at_limit = measured_speed(&mut engine, MAX_LINEAR_VELOCITY)?;
    let just_above = measured_speed(&mut engine, MAX_LINEAR_VELOCITY.next_up())?;
    let fast = measured_speed(&mut engine, 500.0)?;
    assert_eq!(
        (at_limit, just_above, fast),
        (
            MAX_LINEAR_VELOCITY,
            MAX_LINEAR_VELOCITY,
            MAX_LINEAR_VELOCITY
        ),
        "speeds at 400, just above 400, and 500"
    );
    Ok(())
}

#[test]
fn step_after_restitution_blowup_disables_the_body_and_keeps_stepping() -> Result<(), Physics2DError>
{
    let mut engine = engine(-9.81)?;
    add_box(&mut engine, GROUND, 0.0, 0.0, 0, (20.0, 0.5), 1.0e9)?;
    add_box(&mut engine, OFFENDER, 0.0, 2.0, 1, (0.5, 0.5), 1.0e9)?;
    add_box(&mut engine, OTHER, 40.0, 8.0, 1, (0.5, 0.5), 0.0)?;
    let before = position_y(&engine, OTHER)?;

    let mut disabled = false;
    for _ in 0..200 {
        engine.physics_step(DT)?;
        if !engine.is_body_enabled(OFFENDER) {
            disabled = true;
            break;
        }
    }

    let state = if disabled { "disabled" } else { "enabled" };
    assert_eq!(state, "disabled", "offender is_enabled() stayed true");
    assert_eq!(
        drained_reasons(&engine.physics_take_disabled_slots()),
        vec![(OFFENDER, "out-of-bounds")]
    );
    let after = position_y(&engine, OTHER)?;
    assert_ne!(after, before, "the other body's y did not change");
    engine.physics_step(DT)?;
    assert_ne!(position_y(&engine, OTHER)?, after);
    Ok(())
}
