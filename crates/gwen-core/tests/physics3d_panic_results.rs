//! Physics3d step and query inputs that can abort the instance.
//!
//! The public path is `Engine`. `PhysicsWorld3D::step` stores `delta` and calls
//! `PhysicsPipeline::step` with no input check (`world.rs` step). `cast_ray`
//! forwards the ray to Rapier (`world.rs` `cast_ray`).
#![cfg(feature = "physics3d")]
#![allow(
    clippy::bool_assert_comparison,
    reason = "test-only code: boolean conditions are compared with assert_eq! so the failure message names the value"
)]

use gwen_core::bindings::Engine;
use gwen_core::physics3d::world::MAX_COLLIDER_MAGNITUDE;
use gwen_core::physics3d::Physics3DError;

const ALL: u32 = 0xFFFF_FFFF;
const MAX_WORLD_EXTENT: f32 = 1.0e7;
const MAX_LINEAR_VELOCITY: f32 = 400.0;
const DT: f32 = 1.0 / 60.0;

const GROUND: u32 = 0;
const OFFENDER: u32 = 1;
const OTHER: u32 = 2;
const OUT_OF_BOUNDS: u32 = 1;

fn engine(gravity_y: f32) -> Result<Engine, Physics3DError> {
    let mut engine = Engine::new(16).map_err(Physics3DError::Core)?;
    engine.physics3d_init(0.0, gravity_y, 0.0, 16);
    Ok(engine)
}

fn add_box(
    engine: &mut Engine,
    slot: u32,
    at: [f32; 3],
    kind: u8,
    half: (f32, f32, f32),
    restitution: f32,
) -> Result<(), Physics3DError> {
    engine.physics3d_add_body(slot, at[0], at[1], at[2], kind, 1.0, 0.0, 0.0)?;
    engine.physics3d_add_box_collider(
        slot,
        half.0,
        half.1,
        half.2,
        0.0,
        0.0,
        0.0,
        false,
        0.0,
        restitution,
        ALL,
        ALL,
        slot + 1,
    )?;
    Ok(())
}

fn with_body() -> Result<Engine, Physics3DError> {
    let mut engine = engine(0.0)?;
    add_box(&mut engine, 0, [0.0, 0.0, 0.0], 1, (0.5, 0.5, 0.5), 0.0)?;
    Ok(engine)
}

fn body_state(engine: &Engine, slot: u32) -> Result<Vec<f32>, Physics3DError> {
    let state = engine.physics3d_get_body_state(slot)?;
    assert_eq!(state.len(), 13, "state for slot {slot}");
    Ok(state)
}

fn position_y(engine: &Engine, slot: u32) -> Result<f32, Physics3DError> {
    Ok(body_state(engine, slot)?[1])
}

fn position_x(engine: &Engine, slot: u32) -> Result<f32, Physics3DError> {
    Ok(body_state(engine, slot)?[0])
}

fn speed(engine: &Engine, slot: u32) -> Result<f32, Physics3DError> {
    let velocity = engine.physics3d_get_linear_velocity(slot)?;
    assert_eq!(velocity.len(), 3, "velocity for slot {slot}");
    Ok((velocity[0] * velocity[0] + velocity[1] * velocity[1] + velocity[2] * velocity[2]).sqrt())
}

/// `""` when the export accepted the input. The base has no `INVALID_*` variant.
fn code_of<T>(result: &Result<T, Physics3DError>) -> &'static str {
    match result {
        Ok(_) => "",
        Err(err) => err.code(),
    }
}

fn message_of<T>(result: &Result<T, Physics3DError>) -> String {
    match result {
        Ok(_) => String::new(),
        Err(err) => err.to_string(),
    }
}

fn query_message(field: &str, value: f32) -> String {
    format!(
        "physics3d query field {field} is {value}; it must be finite and within ±MAX_WORLD_EXTENT"
    )
}

fn step_message(delta: f32) -> String {
    format!("physics3d step delta is {delta}; it must be finite and within 0..=1")
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

fn enabled_label(engine: &Engine, slot: u32) -> &'static str {
    if engine.physics3d_is_body_enabled(slot) {
        "enabled"
    } else {
        "disabled"
    }
}

fn measured_speed(engine: &mut Engine, vx: f32) -> Result<f32, Physics3DError> {
    engine.physics3d_set_linear_velocity(0, vx, 0.0, 0.0)?;
    engine.physics3d_step(DT)?;
    speed(engine, 0)
}

fn cast_ray(
    engine: &Engine,
    origin: [f32; 3],
    dir: [f32; 3],
    max_dist: f32,
) -> Result<Vec<f32>, Physics3DError> {
    engine.physics3d_cast_ray(
        origin[0], origin[1], origin[2], dir[0], dir[1], dir[2], max_dist, ALL, ALL, true,
    )
}

fn cast_box(
    engine: &Engine,
    pos: [f32; 3],
    dir: [f32; 3],
    half: [f32; 3],
    max_dist: f32,
) -> Result<Vec<f32>, Physics3DError> {
    engine.physics3d_cast_shape(
        pos[0], pos[1], pos[2], 0.0, 0.0, 0.0, 1.0, dir[0], dir[1], dir[2], 0, half[0], half[1],
        half[2], max_dist, ALL, ALL,
    )
}

#[test]
fn cast_ray_nan_returns_invalid_query() -> Result<(), Physics3DError> {
    let engine = with_body()?;
    let result = cast_ray(&engine, [f32::NAN, 0.0, 0.0], [0.0, -1.0, 0.0], 100.0);
    assert_eq!(code_of(&result), "PHYSICS3D:INVALID_QUERY", "{result:?}");
    assert_eq!(message_of(&result), query_message("ox", f32::NAN));
    Ok(())
}

#[test]
fn cast_ray_nan_leaves_the_body_unmoved() -> Result<(), Physics3DError> {
    let mut engine = with_body()?;
    engine.physics3d_set_linear_velocity(0, 10.0, 0.0, 0.0)?;
    let before_x = position_x(&engine, 0)?;
    let before_y = position_y(&engine, 0)?;
    let result = cast_ray(&engine, [f32::NAN, 0.0, 0.0], [0.0, -1.0, 0.0], 100.0);
    assert_eq!(code_of(&result), "PHYSICS3D:INVALID_QUERY", "{result:?}");
    assert_eq!(message_of(&result), query_message("ox", f32::NAN));
    assert_eq!(position_x(&engine, 0)?, before_x);
    assert_eq!(position_y(&engine, 0)?, before_y);
    Ok(())
}

#[test]
fn cast_ray_zero_direction_returns_invalid_query() -> Result<(), Physics3DError> {
    let engine = with_body()?;
    let result = cast_ray(&engine, [0.0, 5.0, 0.0], [0.0, 0.0, 0.0], 100.0);
    assert_eq!(code_of(&result), "PHYSICS3D:INVALID_QUERY", "{result:?}");
    assert_eq!(message_of(&result), query_message("direction", 0.0));
    Ok(())
}

fn floor_and_mesh() -> Result<Engine, Physics3DError> {
    let mut engine = engine(-9.81)?;
    add_box(&mut engine, 0, [0.0, -0.5, 0.0], 0, (10.0, 0.5, 10.0), 0.0)?;
    engine.physics3d_add_body(1, 0.0, 0.0, 0.0, 0, 1.0, 0.0, 0.0)?;
    let vertices = [1.0, -1.0, -1.0, 1.0, -1.0, 1.0, 1.0, 2.0, 0.0];
    engine.physics3d_add_mesh_collider(
        1,
        &vertices,
        &[0, 1, 2],
        0.0,
        0.0,
        0.0,
        false,
        0.5,
        0.0,
        ALL,
        ALL,
        2,
    )?;
    engine.physics3d_step(DT)?;
    Ok(engine)
}

fn large_directions() -> [(f32, f32, f32); 6] {
    [
        (1.0e8, 0.0, 0.0),
        (1.0e20, 0.0, 0.0),
        (1.0e30, 0.0, 0.0),
        (f32::MAX, 0.0, 0.0),
        (f32::MAX, f32::MAX, 0.0),
        (-1.0e8, 0.0, 0.0),
    ]
}

#[test]
fn cast_ray_large_finite_direction_is_accepted() -> Result<(), Physics3DError> {
    let engine = floor_and_mesh()?;
    for (dx, dy, dz) in large_directions() {
        let result = cast_ray(&engine, [0.0, 1.0, 0.0], [dx, dy, dz], 100.0);
        assert_eq!(
            code_of(&result),
            "",
            "direction ({dx}, {dy}, {dz}) {result:?}"
        );
    }
    let along_y = cast_ray(&engine, [0.0, 1.0, 0.0], [0.0, 1.0e8, 0.0], 100.0);
    assert_eq!(code_of(&along_y), "", "{along_y:?}");
    let along_z = cast_ray(&engine, [0.0, 1.0, 0.0], [0.0, 0.0, 1.0e8], 100.0);
    assert_eq!(code_of(&along_z), "", "{along_z:?}");
    Ok(())
}

#[test]
fn cast_shape_large_finite_direction_is_accepted() -> Result<(), Physics3DError> {
    let engine = floor_and_mesh()?;
    for (dx, dy, dz) in large_directions() {
        let result = cast_box(
            &engine,
            [0.0, 1.0, 0.0],
            [dx, dy, dz],
            [0.5, 0.5, 0.5],
            100.0,
        );
        assert_eq!(
            code_of(&result),
            "",
            "direction ({dx}, {dy}, {dz}) {result:?}"
        );
    }
    let along_y = cast_box(
        &engine,
        [0.0, 1.0, 0.0],
        [0.0, 1.0e8, 0.0],
        [0.5, 0.5, 0.5],
        100.0,
    );
    assert_eq!(code_of(&along_y), "", "{along_y:?}");
    let along_z = cast_box(
        &engine,
        [0.0, 1.0, 0.0],
        [0.0, 0.0, 1.0e8],
        [0.5, 0.5, 0.5],
        100.0,
    );
    assert_eq!(code_of(&along_z), "", "{along_z:?}");
    Ok(())
}

#[test]
fn cast_ray_nan_dy_returns_invalid_query() -> Result<(), Physics3DError> {
    let engine = with_body()?;
    let result = cast_ray(&engine, [0.0, 5.0, 0.0], [0.0, f32::NAN, 0.0], 100.0);
    assert_eq!(code_of(&result), "PHYSICS3D:INVALID_QUERY", "{result:?}");
    assert_eq!(message_of(&result), query_message("dy", f32::NAN));
    Ok(())
}

#[test]
fn cast_ray_nan_dz_returns_invalid_query() -> Result<(), Physics3DError> {
    let engine = with_body()?;
    let result = cast_ray(&engine, [0.0, 5.0, 0.0], [0.0, -1.0, f32::NAN], 100.0);
    assert_eq!(code_of(&result), "PHYSICS3D:INVALID_QUERY", "{result:?}");
    assert_eq!(message_of(&result), query_message("dz", f32::NAN));
    Ok(())
}

#[test]
fn cast_ray_at_exactly_max_extent_is_accepted() -> Result<(), Physics3DError> {
    let engine = with_body()?;
    let result = cast_ray(
        &engine,
        [MAX_WORLD_EXTENT, -MAX_WORLD_EXTENT, 0.0],
        [0.0, -1.0, 0.0],
        100.0,
    );
    assert_eq!(
        code_of(&result),
        "",
        "cast ray at ±1.0e7 was refused: {result:?}"
    );
    Ok(())
}

#[test]
fn cast_ray_one_ulp_above_is_refused() -> Result<(), Physics3DError> {
    let engine = with_body()?;
    let above = MAX_WORLD_EXTENT.next_up();
    let result = cast_ray(&engine, [above, 0.0, 0.0], [0.0, -1.0, 0.0], 100.0);
    assert_eq!(code_of(&result), "PHYSICS3D:INVALID_QUERY", "{result:?}");
    assert_eq!(message_of(&result), query_message("ox", above));
    Ok(())
}

#[test]
fn cast_ray_negative_max_dist_returns_invalid_query() -> Result<(), Physics3DError> {
    let engine = with_body()?;
    let result = cast_ray(&engine, [0.0, 5.0, 0.0], [0.0, -1.0, 0.0], -1.0);
    assert_eq!(code_of(&result), "PHYSICS3D:INVALID_QUERY", "{result:?}");
    assert_eq!(message_of(&result), query_message("max_dist", -1.0));
    Ok(())
}

#[test]
fn project_point_nan_returns_invalid_query() -> Result<(), Physics3DError> {
    let engine = with_body()?;
    let result = engine.physics3d_project_point(f32::NAN, 0.0, 0.0, ALL, ALL, true);
    assert_eq!(code_of(&result), "PHYSICS3D:INVALID_QUERY", "{result:?}");
    assert_eq!(message_of(&result), query_message("px", f32::NAN));
    Ok(())
}

#[test]
fn project_point_at_max_extent_is_accepted() -> Result<(), Physics3DError> {
    let engine = with_body()?;
    let result = engine.physics3d_project_point(
        MAX_WORLD_EXTENT,
        -MAX_WORLD_EXTENT,
        MAX_WORLD_EXTENT,
        ALL,
        ALL,
        true,
    );
    assert_eq!(code_of(&result), "", "{result:?}");
    Ok(())
}

#[test]
fn project_point_one_ulp_above_is_refused() -> Result<(), Physics3DError> {
    let engine = with_body()?;
    let above = MAX_WORLD_EXTENT.next_up();
    let result = engine.physics3d_project_point(above, 0.0, 0.0, ALL, ALL, true);
    assert_eq!(code_of(&result), "PHYSICS3D:INVALID_QUERY", "{result:?}");
    assert_eq!(message_of(&result), query_message("px", above));
    Ok(())
}

#[test]
fn project_point_on_trimesh_at_max_extent_returns_a_result() -> Result<(), Physics3DError> {
    let cap = MAX_COLLIDER_MAGNITUDE;
    let vertices = [-cap, 0.0, -cap, cap, 0.0, -cap, 0.0, 0.0, cap];
    let mut engine = engine(0.0)?;
    engine.physics3d_add_body(0, 0.0, 0.0, 0.0, 0, 1.0, 0.0, 0.0)?;
    engine.physics3d_add_mesh_collider(
        0,
        &vertices,
        &[0, 1, 2],
        0.0,
        0.0,
        0.0,
        false,
        0.0,
        0.0,
        ALL,
        ALL,
        1,
    )?;
    engine.physics3d_step(DT)?;
    let result = engine.physics3d_project_point(0.0, MAX_WORLD_EXTENT, 0.0, ALL, ALL, true)?;
    assert_eq!(result.len(), 6, "projection {result:?}");
    assert_eq!(result[0], 1.0, "projection missed the mesh at the cap");
    Ok(())
}

#[test]
fn cast_shape_negative_half_extent_returns_invalid_collider() -> Result<(), Physics3DError> {
    let engine = with_body()?;
    let result = cast_box(
        &engine,
        [0.0, 5.0, 0.0],
        [0.0, -1.0, 0.0],
        [-1.0, 0.5, 0.5],
        100.0,
    );
    assert_eq!(code_of(&result), "PHYSICS3D:INVALID_COLLIDER", "{result:?}");
    assert_eq!(
        message_of(&result),
        "collider refused: a value must not be negative"
    );
    Ok(())
}

#[test]
fn cast_shape_half_extent_at_cap_is_accepted() -> Result<(), Physics3DError> {
    let engine = with_body()?;
    let cap = MAX_COLLIDER_MAGNITUDE;
    let result = cast_box(
        &engine,
        [0.0, 5.0, 0.0],
        [0.0, -1.0, 0.0],
        [cap, cap, cap],
        100.0,
    );
    assert_eq!(code_of(&result), "", "{result:?}");
    Ok(())
}

#[test]
fn cast_shape_half_extent_one_ulp_above_is_refused() -> Result<(), Physics3DError> {
    let engine = with_body()?;
    let above = MAX_COLLIDER_MAGNITUDE.next_up();
    let result = cast_box(
        &engine,
        [0.0, 5.0, 0.0],
        [0.0, -1.0, 0.0],
        [above, 0.5, 0.5],
        100.0,
    );
    assert_eq!(code_of(&result), "PHYSICS3D:INVALID_COLLIDER", "{result:?}");
    assert_eq!(
        message_of(&result),
        "collider refused: a value is larger than the accepted magnitude"
    );
    Ok(())
}

#[test]
fn cast_shape_nan_direction_returns_invalid_query() -> Result<(), Physics3DError> {
    let engine = with_body()?;
    let result = cast_box(
        &engine,
        [0.0, 5.0, 0.0],
        [f32::NAN, -1.0, 0.0],
        [0.5, 0.5, 0.5],
        100.0,
    );
    assert_eq!(code_of(&result), "PHYSICS3D:INVALID_QUERY", "{result:?}");
    assert_eq!(message_of(&result), query_message("dx", f32::NAN));
    Ok(())
}

#[test]
fn step_nan_delta_returns_invalid_step_delta() -> Result<(), Physics3DError> {
    let mut engine = with_body()?;
    let result = engine.physics3d_step(f32::NAN);
    assert_eq!(
        code_of(&result),
        "PHYSICS3D:INVALID_STEP_DELTA",
        "{result:?}"
    );
    assert_eq!(message_of(&result), step_message(f32::NAN));
    Ok(())
}

#[test]
fn step_negative_delta_returns_invalid_step_delta() -> Result<(), Physics3DError> {
    let mut engine = with_body()?;
    let result = engine.physics3d_step(-f32::MIN_POSITIVE);
    assert_eq!(
        code_of(&result),
        "PHYSICS3D:INVALID_STEP_DELTA",
        "{result:?}"
    );
    assert_eq!(message_of(&result), step_message(-f32::MIN_POSITIVE));
    Ok(())
}

#[test]
fn step_delta_above_one_returns_invalid_step_delta() -> Result<(), Physics3DError> {
    let mut engine = with_body()?;
    let delta = 1.0 + f32::EPSILON;
    let result = engine.physics3d_step(delta);
    assert_eq!(
        code_of(&result),
        "PHYSICS3D:INVALID_STEP_DELTA",
        "{result:?}"
    );
    assert_eq!(message_of(&result), step_message(delta));
    Ok(())
}

#[test]
fn step_zero_delta_is_accepted() -> Result<(), Physics3DError> {
    let mut engine = with_body()?;
    let before = position_y(&engine, 0)?;
    let stepped = engine.physics3d_step(0.0);
    assert_eq!(code_of(&stepped), "", "physics3d_step refused a zero delta");
    assert_eq!(position_y(&engine, 0)?, before);
    Ok(())
}

#[test]
fn step_delta_one_is_accepted() -> Result<(), Physics3DError> {
    let mut engine = with_body()?;
    let result = engine.physics3d_step(1.0);
    assert_eq!(code_of(&result), "", "{result:?}");
    Ok(())
}

#[test]
fn step_non_finite_delta_leaves_the_body_unmoved() -> Result<(), Physics3DError> {
    let mut engine = with_body()?;
    engine.physics3d_set_linear_velocity(0, 10.0, 0.0, 0.0)?;
    let before_x = position_x(&engine, 0)?;
    let before_y = position_y(&engine, 0)?;
    let nan = engine.physics3d_step(f32::NAN);
    assert_eq!(code_of(&nan), "PHYSICS3D:INVALID_STEP_DELTA", "{nan:?}");
    assert_eq!(message_of(&nan), step_message(f32::NAN));
    assert_eq!(position_x(&engine, 0)?, before_x);
    assert_eq!(position_y(&engine, 0)?, before_y);
    let inf = engine.physics3d_step(f32::INFINITY);
    assert_eq!(code_of(&inf), "PHYSICS3D:INVALID_STEP_DELTA", "{inf:?}");
    assert_eq!(message_of(&inf), step_message(f32::INFINITY));
    assert_eq!(position_x(&engine, 0)?, before_x);
    assert_eq!(position_y(&engine, 0)?, before_y);
    Ok(())
}

#[test]
fn velocity_above_the_clamp_is_clamped() -> Result<(), Physics3DError> {
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
fn velocity_far_above_the_clamp_keeps_speed_and_direction() -> Result<(), Physics3DError> {
    let mut diagonal = with_body()?;
    diagonal.physics3d_set_linear_velocity(0, 1.0e20, 1.0e20, 0.0)?;
    diagonal.physics3d_step(DT)?;
    let diagonal_velocity = diagonal.physics3d_get_linear_velocity(0)?;
    assert_eq!(diagonal_velocity.len(), 3, "velocity for slot 0");
    assert_eq!(
        diagonal_velocity[0], diagonal_velocity[1],
        "equal components lost their direction"
    );
    assert_eq!(diagonal_velocity[2], 0.0);
    assert_eq!(speed(&diagonal, 0)?, MAX_LINEAR_VELOCITY);

    let mut axis = with_body()?;
    axis.physics3d_set_linear_velocity(0, 1.0e30, 0.0, 0.0)?;
    axis.physics3d_step(DT)?;
    let axis_velocity = axis.physics3d_get_linear_velocity(0)?;
    assert_eq!(axis_velocity.len(), 3, "velocity for slot 0");
    assert_eq!(axis_velocity[0], MAX_LINEAR_VELOCITY);
    assert_eq!(axis_velocity[1], 0.0);
    assert_eq!(axis_velocity[2], 0.0);
    assert_eq!(speed(&axis, 0)?, MAX_LINEAR_VELOCITY);
    Ok(())
}

#[test]
fn clamp_does_not_disable_the_body() -> Result<(), Physics3DError> {
    let mut engine = with_body()?;
    engine.physics3d_set_linear_velocity(0, 500.0, 0.0, 0.0)?;
    engine.physics3d_step(DT)?;
    assert_eq!(speed(&engine, 0)?, MAX_LINEAR_VELOCITY);
    assert_eq!(
        enabled_label(&engine, 0),
        "enabled",
        "clamp disabled the body"
    );
    assert_eq!(engine.physics3d_take_disabled_slots(), Vec::<u32>::new());
    Ok(())
}

#[test]
fn set_max_linear_velocity_rejects_non_positive_and_non_finite() -> Result<(), Physics3DError> {
    let mut engine = with_body()?;
    assert_eq!(engine.physics3d_set_max_linear_velocity(0.0), 0);
    assert_eq!(engine.physics3d_set_max_linear_velocity(-1.0), 0);
    assert_eq!(engine.physics3d_set_max_linear_velocity(f32::NAN), 0);
    assert_eq!(engine.physics3d_set_max_linear_velocity(f32::INFINITY), 0);
    assert_eq!(measured_speed(&mut engine, 500.0)?, MAX_LINEAR_VELOCITY);
    assert_eq!(engine.physics3d_set_max_linear_velocity(50.0), 1);
    assert_eq!(measured_speed(&mut engine, 500.0)?, 50.0);
    Ok(())
}

/// Restitution `1.0e9` disabled this body on rapier 0.22: the bounce left
/// `MAX_WORLD_EXTENT` and the #217 guard recorded `out-of-bounds`.
/// rapier 0.36.1 caps linear speed after each solver substep
/// (`normalized_max_linear_velocity`, `rapier3d-0.36.1`
/// `dynamics/integration_parameters.rs:282`, default `400.0` at `:423`,
/// `length_unit` 1 at `:430`). Over 200 steps the offender stays enabled,
/// `|y|` peaks at 1103.37708 and each `|Δy|` stays within `400 * dt`
/// (measured 6.66496468). The disable list stays empty. P-RAP-7 re-measures
/// the #217 limits.
#[test]
fn step_after_restitution_1e9_stays_bounded_and_keeps_stepping() -> Result<(), Physics3DError> {
    const STEPS: u32 = 200;
    let mut engine = engine(-9.81)?;
    add_box(
        &mut engine,
        GROUND,
        [0.0, 0.0, 0.0],
        0,
        (20.0, 0.5, 20.0),
        1.0e9,
    )?;
    add_box(
        &mut engine,
        OFFENDER,
        [0.0, 2.0, 0.0],
        1,
        (0.5, 0.5, 0.5),
        1.0e9,
    )?;
    add_box(
        &mut engine,
        OTHER,
        [40.0, 8.0, 0.0],
        1,
        (0.5, 0.5, 0.5),
        0.0,
    )?;
    let before = position_y(&engine, OTHER)?;

    let mut offender_enabled = true;
    let mut max_abs_y = 0.0f32;
    let mut max_dy = 0.0f32;
    let mut prev_y = 2.0f32;
    let mut offender_finite = true;
    for _ in 0..STEPS {
        engine.physics3d_step(DT)?;
        if !engine.physics3d_is_body_enabled(OFFENDER) {
            offender_enabled = false;
        }
        let state = body_state(&engine, OFFENDER)?;
        let velocity = engine.physics3d_get_linear_velocity(OFFENDER)?;
        if !state.iter().copied().all(f32::is_finite)
            || !velocity.iter().copied().all(f32::is_finite)
        {
            offender_finite = false;
        }
        let y = state[1];
        max_dy = max_dy.max((y - prev_y).abs());
        prev_y = y;
        max_abs_y = max_abs_y.max(y.abs());
    }

    let position_ceiling = 2.0 + MAX_LINEAR_VELOCITY * (STEPS as f32) * DT;
    assert_eq!(offender_enabled, true, "offender was disabled");
    assert_eq!(
        offender_finite, true,
        "offender pose or velocity is not finite"
    );
    assert_eq!(
        max_abs_y <= position_ceiling,
        true,
        "offender |y| {max_abs_y} exceeds the cap budget {position_ceiling}"
    );
    assert_eq!(
        max_dy <= MAX_LINEAR_VELOCITY * DT,
        true,
        "offender step |dy| {max_dy} exceeds the 400 m/s cap"
    );
    assert_eq!(
        engine.physics3d_take_disabled_slots(),
        Vec::<u32>::new(),
        "restitution 1e9 disabled a body"
    );
    let after = position_y(&engine, OTHER)?;
    let other_velocity = engine.physics3d_get_linear_velocity(OTHER)?;
    assert_ne!(after, before, "the other body's y did not change");
    assert_eq!(
        after.is_finite() && other_velocity.iter().copied().all(f32::is_finite),
        true,
        "the other body is not finite: y={after} vel={other_velocity:?}"
    );
    engine.physics3d_step(DT)?;
    assert_ne!(position_y(&engine, OTHER)?, after);
    Ok(())
}

#[test]
fn non_finite_velocity_disables_the_body() -> Result<(), Physics3DError> {
    let mut engine = with_body()?;
    engine.physics3d_set_linear_velocity(0, f32::NAN, 0.0, 0.0)?;
    engine.physics3d_step(DT)?;
    assert_eq!(
        enabled_label(&engine, 0),
        "disabled",
        "non-finite velocity stayed enabled"
    );
    assert_eq!(
        drained_reasons(&engine.physics3d_take_disabled_slots()),
        vec![(0, "non-finite")]
    );
    Ok(())
}

#[test]
fn fixed_and_kinematic_bodies_past_the_extent_are_not_disabled() -> Result<(), Physics3DError> {
    let mut engine = engine(0.0)?;
    let above = MAX_WORLD_EXTENT.next_up();
    add_box(&mut engine, 0, [above, 0.0, 0.0], 0, (0.5, 0.5, 0.5), 0.0)?;
    add_box(&mut engine, 1, [above, 0.0, 0.0], 2, (0.5, 0.5, 0.5), 0.0)?;
    engine.physics3d_step(DT)?;
    assert_eq!(
        enabled_label(&engine, 0),
        "enabled",
        "fixed body past the extent was disabled"
    );
    assert_eq!(
        enabled_label(&engine, 1),
        "enabled",
        "kinematic body past the extent was disabled"
    );
    assert_eq!(engine.physics3d_take_disabled_slots(), Vec::<u32>::new());
    Ok(())
}

#[test]
fn position_past_max_extent_disables_the_body() -> Result<(), Physics3DError> {
    let mut engine = engine(0.0)?;
    add_box(
        &mut engine,
        0,
        [MAX_WORLD_EXTENT.next_up(), 0.0, 0.0],
        1,
        (0.5, 0.5, 0.5),
        0.0,
    )?;
    engine.physics3d_step(DT)?;
    assert_eq!(
        enabled_label(&engine, 0),
        "disabled",
        "out-of-bounds body stayed enabled"
    );
    assert_eq!(
        drained_reasons(&engine.physics3d_take_disabled_slots()),
        vec![(0, "out-of-bounds")]
    );
    Ok(())
}

#[test]
fn velocity_that_would_leave_the_world_disables_the_body() -> Result<(), Physics3DError> {
    let mut engine = engine(0.0)?;
    add_box(
        &mut engine,
        0,
        [MAX_WORLD_EXTENT, 0.0, 0.0],
        1,
        (0.5, 0.5, 0.5),
        0.0,
    )?;
    engine.physics3d_set_linear_velocity(0, MAX_LINEAR_VELOCITY, 0.0, 0.0)?;
    engine.physics3d_step(DT)?;
    assert_eq!(
        enabled_label(&engine, 0),
        "disabled",
        "leaving velocity stayed enabled"
    );
    assert_eq!(
        drained_reasons(&engine.physics3d_take_disabled_slots()),
        vec![(0, "velocity")]
    );
    Ok(())
}

#[test]
fn disabled_body_stays_registered_and_is_not_reported_twice() -> Result<(), Physics3DError> {
    let mut engine = engine(0.0)?;
    add_box(
        &mut engine,
        0,
        [MAX_WORLD_EXTENT.next_up(), 0.0, 0.0],
        1,
        (0.5, 0.5, 0.5),
        0.0,
    )?;
    engine.physics3d_step(DT)?;
    let pose = engine.physics3d_get_body_state(0)?;
    assert_eq!(pose.len(), 13, "disabled body dropped its position");
    let queried = engine.physics3d_project_point(0.0, 0.0, 0.0, ALL, ALL, true);
    assert_eq!(
        code_of(&queried),
        "",
        "project point after disable: {queried:?}"
    );
    assert_eq!(
        drained_reasons(&engine.physics3d_take_disabled_slots()),
        vec![(0, "out-of-bounds")]
    );
    engine.physics3d_step(DT)?;
    assert_eq!(engine.physics3d_take_disabled_slots(), Vec::<u32>::new());
    Ok(())
}

fn disable_three_out_of_bounds(
    engine: &mut Engine,
) -> Result<Vec<(u32, &'static str)>, Physics3DError> {
    add_box(
        engine,
        2,
        [MAX_WORLD_EXTENT.next_up(), 0.0, 0.0],
        1,
        (0.5, 0.5, 0.5),
        0.0,
    )?;
    add_box(
        engine,
        0,
        [MAX_WORLD_EXTENT.next_up(), 5.0, 0.0],
        1,
        (0.5, 0.5, 0.5),
        0.0,
    )?;
    add_box(
        engine,
        1,
        [-MAX_WORLD_EXTENT.next_up(), 0.0, 0.0],
        1,
        (0.5, 0.5, 0.5),
        0.0,
    )?;
    engine.physics3d_step(DT)?;
    Ok(drained_reasons(&engine.physics3d_take_disabled_slots()))
}

#[test]
fn disabled_slots_in_one_step_drain_in_ascending_slot_order() -> Result<(), Physics3DError> {
    let mut first = engine(0.0)?;
    let mut second = engine(0.0)?;
    let left = disable_three_out_of_bounds(&mut first)?;
    let right = disable_three_out_of_bounds(&mut second)?;
    let expected = vec![
        (0, "out-of-bounds"),
        (1, "out-of-bounds"),
        (2, "out-of-bounds"),
    ];
    assert_eq!(left, expected);
    assert_eq!(right, expected);
    Ok(())
}

/// Two engines stay apart when one disables a body.
///
/// Restitution `1.0e9` no longer disables a body on rapier 0.36.1 (see
/// `step_after_restitution_1e9_stays_bounded_and_keeps_stepping`). This test
/// spawns a dynamic body past `MAX_WORLD_EXTENT` and steps once. Measured:
/// the body is disabled and `physics3d_take_disabled_slots` is `[0, 1]`
/// (`out-of-bounds`). The other engine's body falls and stays enabled.
#[test]
fn two_engines_do_not_share_a_disabled_body() -> Result<(), Physics3DError> {
    let mut blown = engine(0.0)?;
    let mut other = engine(-9.81)?;
    let above = MAX_WORLD_EXTENT.next_up();
    add_box(&mut blown, 0, [above, 0.0, 0.0], 1, (0.5, 0.5, 0.5), 0.0)?;
    add_box(&mut other, 0, [0.0, 8.0, 0.0], 1, (0.5, 0.5, 0.5), 0.0)?;
    let before = position_y(&other, 0)?;
    blown.physics3d_step(DT)?;
    assert_eq!(
        enabled_label(&blown, 0),
        "disabled",
        "body past the extent stayed enabled"
    );
    assert_eq!(
        drained_reasons(&blown.physics3d_take_disabled_slots()),
        vec![(0, "out-of-bounds")]
    );
    other.physics3d_step(DT)?;
    assert_ne!(
        position_y(&other, 0)?,
        before,
        "the other engine did not step"
    );
    assert_eq!(
        position_y(&other, 0)?.is_finite(),
        true,
        "the other engine's y is not finite"
    );
    assert_eq!(
        enabled_label(&other, 0),
        "enabled",
        "the other engine's body was disabled"
    );
    assert_eq!(other.physics3d_take_disabled_slots(), Vec::<u32>::new());
    Ok(())
}
