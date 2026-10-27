#![cfg(feature = "physics3d")]
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::unreachable,
    clippy::todo,
    clippy::unimplemented,
    clippy::bool_assert_comparison,
    reason = "test-only code"
)]

//! Rapier 0.36 behaviour that 0.22 does not have.
//!
//! A fixed collider far outside the dynamic-body guard must not abort a step.
//! A non-finite angular velocity is Rapier's quarantine, not the linear-velocity guard.

use gwen_core::physics3d::{Physics3DError, PhysicsWorld3D};
use std::panic::{catch_unwind, AssertUnwindSafe};

const DT: f32 = 1.0 / 60.0;
const STEPS: u32 = 180;
const BALL_RADIUS: f32 = 0.5;
const SPAWN_Y: f32 = 0.55;
const FAR_X: f32 = 1.0e12;
const ALL: u32 = 0xFFFF_FFFF;
const GROUND_SLOT: u32 = 0;
const BALL_SLOT: u32 = 1;
const FAR_SLOT: u32 = 2;
const BAD_SLOT: u32 = 1;
const WITNESS_SLOT: u32 = 2;

fn ground_and_ball(world: &mut PhysicsWorld3D) -> Result<(), Physics3DError> {
    assert_eq!(
        world.add_body(GROUND_SLOT, 0.0, -0.5, 0.0, 0, 0.0, 0.0, 0.0),
        true
    );
    world.add_box_collider(
        GROUND_SLOT,
        4.0,
        0.5,
        4.0,
        0.0,
        0.0,
        0.0,
        false,
        0.5,
        0.0,
        ALL,
        ALL,
        1,
    )?;
    assert_eq!(
        world.add_body(BALL_SLOT, 0.0, SPAWN_Y, 0.0, 1, 1.0, 0.0, 0.0),
        true
    );
    world.add_sphere_collider(
        BALL_SLOT,
        BALL_RADIUS,
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
    Ok(())
}

fn far_fixed_ball(world: &mut PhysicsWorld3D) -> Result<(), Physics3DError> {
    assert_eq!(
        world.add_body(FAR_SLOT, FAR_X, 0.0, 0.0, 0, 0.0, 0.0, 0.0),
        true
    );
    world.add_sphere_collider(
        FAR_SLOT,
        BALL_RADIUS,
        0.0,
        0.0,
        0.0,
        false,
        0.5,
        0.0,
        ALL,
        ALL,
        3,
    )?;
    Ok(())
}

fn step_word(world: &mut PhysicsWorld3D) -> &'static str {
    let prev = std::panic::take_hook();
    std::panic::set_hook(Box::new(|_| {}));
    let result = catch_unwind(AssertUnwindSafe(|| {
        for _ in 0..STEPS {
            world.step(DT)?;
        }
        Ok::<(), Physics3DError>(())
    }));
    std::panic::set_hook(prev);
    match result {
        Ok(Ok(())) => "returned",
        Ok(Err(_)) => "refused",
        Err(_) => "panicked",
    }
}

fn ball_y(world: &PhysicsWorld3D) -> f32 {
    let state = world.get_body_state(BALL_SLOT);
    assert_eq!(
        state.len(),
        13,
        "body state is position, rotation, velocities"
    );
    state[1]
}

/// Settled centre of the radius-0.5 ball on a ground whose top is y = 0.
///
/// Measured 2026-10-27 on Rapier 0.36.1 (`std`, `f32`, `dim3`, no `block-solver`),
/// 4 solver iterations, 2 stabilization iterations, 1 CCD substep, last 30 of 180
/// steps at 1/60 s, including the fixed ball at x = 1e12: y = 0.49993077
/// (min = max). The same scene through `PhysicsWorld3D` on Rapier 0.22.0
/// settles at 0.4987237. The half-width is smaller than that measured gap.
const REST_Y: f32 = 0.49993077;
const REST_HALF_WIDTH: f32 = 0.0002;

fn rest_band_contains(y: f32) -> bool {
    (y - REST_Y).abs() <= REST_HALF_WIDTH
}

#[test]
fn a_ball_at_1e12_steps_without_panic() -> Result<(), Physics3DError> {
    let mut world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
    ground_and_ball(&mut world)?;
    far_fixed_ball(&mut world)?;
    assert_eq!(step_word(&mut world), "returned");
    let y = ball_y(&world);
    assert_eq!(
        rest_band_contains(y),
        true,
        "ground ball y {y} is outside the measured rest band"
    );
    Ok(())
}

fn two_dynamic_spheres() -> Result<PhysicsWorld3D, Physics3DError> {
    let mut world = PhysicsWorld3D::new(0.0, 0.0, 0.0);
    assert_eq!(
        world.add_body(BAD_SLOT, 0.0, 1.0, 0.0, 1, 1.0, 0.0, 0.0),
        true
    );
    world.add_sphere_collider(
        BAD_SLOT,
        BALL_RADIUS,
        0.0,
        0.0,
        0.0,
        false,
        0.5,
        0.0,
        ALL,
        ALL,
        1,
    )?;
    assert_eq!(
        world.add_body(WITNESS_SLOT, 5.0, 1.0, 0.0, 1, 1.0, 0.0, 0.0),
        true
    );
    world.add_sphere_collider(
        WITNESS_SLOT,
        BALL_RADIUS,
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
    assert_eq!(world.set_linear_velocity(WITNESS_SLOT, 1.0, 0.0, 0.0), true);
    Ok(world)
}

#[test]
fn a_nan_velocity_body_is_disabled_and_the_other_keeps_stepping() -> Result<(), Physics3DError> {
    let mut world = two_dynamic_spheres()?;
    assert_eq!(
        world.set_angular_velocity(BAD_SLOT, f32::NAN, 0.0, 0.0),
        true
    );
    world.step(DT)?;
    assert_eq!(
        world.is_body_enabled(BAD_SLOT),
        false,
        "NaN angular velocity leaves the body enabled"
    );
    assert_eq!(world.is_body_enabled(WITNESS_SLOT), true);
    let vel = world.get_linear_velocity(WITNESS_SLOT);
    assert_eq!(vel.len(), 3);
    assert_eq!(
        vel.iter().copied().all(f32::is_finite),
        true,
        "witness velocity {vel:?} is not finite"
    );
    Ok(())
}

#[test]
fn an_infinite_velocity_body_is_disabled() -> Result<(), Physics3DError> {
    let mut world = two_dynamic_spheres()?;
    assert_eq!(
        world.set_angular_velocity(BAD_SLOT, f32::INFINITY, 0.0, 0.0),
        true
    );
    world.step(DT)?;
    assert_eq!(
        world.is_body_enabled(BAD_SLOT),
        false,
        "infinite angular velocity leaves the body enabled"
    );
    Ok(())
}

const CAP: f32 = 1000.0;
const STEP: f32 = 1.0 / 60.0;

fn dynamic_ball(world: &mut PhysicsWorld3D, slot: u32) -> Result<(), Physics3DError> {
    assert_eq!(world.add_body(slot, 0.0, 0.0, 0.0, 1, 1.0, 0.0, 0.0), true);
    world.add_sphere_collider(slot, 0.2, 0.0, 0.0, 0.0, false, 0.5, 0.0, ALL, ALL, slot)?;
    Ok(())
}

fn linear_speed(world: &PhysicsWorld3D, slot: u32) -> f32 {
    let v = world.get_linear_velocity(slot);
    assert_eq!(v.len(), 3, "velocity is vx, vy, vz");
    v[0].hypot(v[1]).hypot(v[2])
}

fn cap_plus_one_velocity() -> (f32, f32) {
    let component = CAP / 2.0f32.sqrt();
    (component, component)
}

fn raised_cap_with_ball() -> Result<PhysicsWorld3D, Physics3DError> {
    let mut world = PhysicsWorld3D::new(0.0, 0.0, 0.0);
    assert_eq!(world.set_max_linear_velocity(CAP), true);
    dynamic_ball(&mut world, 0)?;
    Ok(world)
}

/// 5000 m/s is above the raised cap, so this step is a real clamp.
#[test]
fn speed_after_one_step_is_capped_at_a_raised_max_linear_velocity() -> Result<(), Physics3DError> {
    let mut world = raised_cap_with_ball()?;
    assert_eq!(world.set_linear_velocity(0, 5000.0, 0.0, 0.0), true);
    world.step(STEP)?;
    let speed = linear_speed(&world, 0);
    assert_eq!(speed, CAP, "speed {speed}");
    Ok(())
}

#[test]
fn a_body_at_exactly_the_raised_cap_keeps_its_speed() -> Result<(), Physics3DError> {
    let mut world = raised_cap_with_ball()?;
    assert_eq!(world.set_linear_velocity(0, CAP, 0.0, 0.0), true);
    world.step(STEP)?;
    let speed = linear_speed(&world, 0);
    assert_eq!(speed, CAP, "speed {speed}");
    Ok(())
}

#[test]
fn cap_plus_one_is_clamped_to_the_raised_cap() -> Result<(), Physics3DError> {
    let mut world = raised_cap_with_ball()?;
    let (vx, vy) = cap_plus_one_velocity();
    assert_eq!(vx.hypot(vy), CAP.next_up());
    assert_eq!(world.set_linear_velocity(0, vx, vy, 0.0), true);
    world.step(STEP)?;
    let speed = linear_speed(&world, 0);
    // Rapier scales by `cap / length`. That product is the next f32 below the cap.
    assert_eq!(speed, CAP.next_down(), "speed {speed}");
    Ok(())
}

#[test]
fn a_refused_cap_keeps_the_raised_rapier_cap() -> Result<(), Physics3DError> {
    let mut world = raised_cap_with_ball()?;
    assert_eq!(world.set_linear_velocity(0, CAP, 0.0, 0.0), true);
    assert_eq!(world.set_max_linear_velocity(f32::NAN), false);
    assert_eq!(world.set_max_linear_velocity(0.0), false);
    assert_eq!(world.set_max_linear_velocity(-1.0), false);
    world.step(STEP)?;
    let speed = linear_speed(&world, 0);
    assert_eq!(speed, CAP, "speed {speed}");
    Ok(())
}

/// Gravity pushes a body that already sits on a lowered cap. The pre-step guard
/// leaves that speed alone, so only Rapier's per-substep cap can hold it.
#[test]
fn a_lowered_cap_is_enforced_by_the_solver_after_the_guard() -> Result<(), Physics3DError> {
    let mut world = PhysicsWorld3D::new(9.81, 0.0, 0.0);
    assert_eq!(world.set_max_linear_velocity(100.0), true);
    dynamic_ball(&mut world, 0)?;
    assert_eq!(world.set_linear_velocity(0, 100.0, 0.0, 0.0), true);
    world.step(STEP)?;
    let speed = linear_speed(&world, 0);
    assert_eq!(speed, 100.0, "speed {speed}");
    Ok(())
}

#[test]
fn a_body_launched_at_1e12_is_capped_at_the_default_max_linear_velocity(
) -> Result<(), Physics3DError> {
    let mut world = PhysicsWorld3D::new(0.0, 0.0, 0.0);
    dynamic_ball(&mut world, 0)?;
    assert_eq!(world.set_linear_velocity(0, 1.0e12, 0.0, 0.0), true);
    world.step(STEP)?;
    let speed = linear_speed(&world, 0);
    assert_eq!(speed, 400.0, "speed {speed}");
    Ok(())
}

/// Measured 2026-10-27 on Rapier 0.36.1, gravity -9.81, box on the floor.
/// Awake after 30 steps of 1/60 s. Asleep after 31 steps, the first sleeping step.
#[test]
fn a_resting_box_sleeps_after_half_a_second() -> Result<(), Physics3DError> {
    let mut world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
    assert_eq!(world.add_body(0, 0.0, -0.5, 0.0, 0, 0.0, 0.0, 0.0), true);
    world.add_box_collider(
        0, 4.0, 0.5, 4.0, 0.0, 0.0, 0.0, false, 0.5, 0.0, ALL, ALL, 1,
    )?;
    assert_eq!(world.add_body(1, 0.0, 0.5, 0.0, 1, 1.0, 0.0, 0.0), true);
    world.add_box_collider(
        1, 0.5, 0.5, 0.5, 0.0, 0.0, 0.0, false, 0.5, 0.0, ALL, ALL, 2,
    )?;
    for _ in 0..30 {
        world.step(STEP)?;
    }
    assert_eq!(world.is_body_sleeping(1), false);
    world.step(STEP)?;
    assert_eq!(world.is_body_sleeping(1), true);
    Ok(())
}

/// Two touching boxes share an island. A third box, far away, sleeps on its own.
/// The mover is kept at 0.4 m/s along z, so the resting neighbour stays awake.
/// Once the mover is stopped, both sleep on the same step.
#[test]
fn an_island_sleeps_only_when_every_body_is_eligible() -> Result<(), Physics3DError> {
    let mut world = PhysicsWorld3D::new(0.0, -9.81, 0.0);
    assert_eq!(world.add_body(0, 0.0, -0.5, 0.0, 0, 0.0, 0.0, 0.0), true);
    world.add_box_collider(
        0, 50.0, 0.5, 50.0, 0.0, 0.0, 0.0, false, 0.0, 0.0, ALL, ALL, 1,
    )?;
    assert_eq!(world.add_body(1, 0.0, 0.5, 0.0, 1, 1.0, 0.0, 0.0), true);
    world.add_box_collider(
        1, 0.5, 0.5, 0.5, 0.0, 0.0, 0.0, false, 0.0, 0.0, ALL, ALL, 2,
    )?;
    assert_eq!(world.add_body(2, 1.0, 0.5, 0.0, 1, 1.0, 0.0, 0.0), true);
    world.add_box_collider(
        2, 0.5, 0.5, 0.5, 0.0, 0.0, 0.0, false, 0.0, 0.0, ALL, ALL, 3,
    )?;
    assert_eq!(world.add_body(3, 30.0, 0.5, 0.0, 1, 1.0, 0.0, 0.0), true);
    world.add_box_collider(
        3, 0.5, 0.5, 0.5, 0.0, 0.0, 0.0, false, 0.0, 0.0, ALL, ALL, 4,
    )?;
    // 60 steps is past the lone-box sleep (step 31) and before the mover
    // slides out of contact (0.4 m along z, boxes are 1 m deep).
    for _ in 0..60 {
        assert_eq!(world.set_linear_velocity(2, 0.0, 0.0, 0.4), true);
        world.step(STEP)?;
    }
    assert_eq!(world.is_body_sleeping(3), true, "distant box");
    assert_eq!(world.is_body_sleeping(1), false, "resting box");
    assert_eq!(world.is_body_sleeping(2), false, "moving box");
    let mover_z = world.get_body_state(2)[2];
    assert_eq!(mover_z < 1.0, true, "mover z {mover_z}");

    assert_eq!(world.set_linear_velocity(2, 0.0, 0.0, 0.0), true);
    assert_eq!(world.set_angular_velocity(2, 0.0, 0.0, 0.0), true);
    for _ in 0..30 {
        world.step(STEP)?;
    }
    assert_eq!(world.is_body_sleeping(1), false, "resting box at 0.5 s");
    assert_eq!(world.is_body_sleeping(2), false, "mover at 0.5 s");
    world.step(STEP)?;
    assert_eq!(world.is_body_sleeping(1), true, "resting box");
    assert_eq!(world.is_body_sleeping(2), true, "mover");
    Ok(())
}

fn slept_revolute() -> Result<(PhysicsWorld3D, u32), Physics3DError> {
    let mut world = PhysicsWorld3D::new(0.0, 0.0, 0.0);
    assert_eq!(world.add_body(0, 0.0, 0.0, 0.0, 1, 1.0, 0.0, 0.0), true);
    world.add_sphere_collider(0, 0.2, 0.0, 0.0, 0.0, false, 0.5, 0.0, ALL, ALL, 1)?;
    assert_eq!(world.add_body(1, 1.0, 0.0, 0.0, 1, 1.0, 0.0, 0.0), true);
    world.add_sphere_collider(1, 0.2, 0.0, 0.0, 0.0, false, 0.5, 0.0, ALL, ALL, 2)?;
    let id = world.add_revolute_joint(
        0, 1, 0.0, 0.0, 0.0, -1.0, 0.0, 0.0, 0.0, 1.0, 0.0, false, 0.0, 0.0,
    )?;
    // One step, then both bodies sleep, before the setter under test.
    world.step(STEP)?;
    assert_eq!(world.set_body_sleeping(0, true), true);
    assert_eq!(world.set_body_sleeping(1, true), true);
    Ok((world, id))
}

/// Characterisation test of a Rapier 0.36.1 default already true after P-RAP-3a.
///
/// Each setter passes `wake_up = true`. Both dynamic bodies are asleep before
/// the setter and awake after one step.
#[test]
fn joint_setters_wake_connected_bodies() -> Result<(), Physics3DError> {
    let (mut velocity_world, velocity_id) = slept_revolute()?;
    assert_eq!(velocity_world.is_body_sleeping(0), true);
    assert_eq!(velocity_world.is_body_sleeping(1), true);
    velocity_world.set_joint_motor_velocity(velocity_id, 20.0, 1.0e6)?;
    velocity_world.step(STEP)?;
    assert_eq!(velocity_world.is_body_sleeping(0), false);
    assert_eq!(velocity_world.is_body_sleeping(1), false);

    let (mut position_world, position_id) = slept_revolute()?;
    assert_eq!(position_world.is_body_sleeping(0), true);
    assert_eq!(position_world.is_body_sleeping(1), true);
    position_world.set_joint_motor_position(position_id, 1.0, 1.0e5, 1.0e3)?;
    position_world.step(STEP)?;
    assert_eq!(position_world.is_body_sleeping(0), false);
    assert_eq!(position_world.is_body_sleeping(1), false);

    let (mut enabled_world, enabled_id) = slept_revolute()?;
    assert_eq!(enabled_world.is_body_sleeping(0), true);
    assert_eq!(enabled_world.is_body_sleeping(1), true);
    enabled_world.set_joint_enabled(enabled_id, false)?;
    enabled_world.step(STEP)?;
    assert_eq!(enabled_world.is_body_sleeping(0), false);
    assert_eq!(enabled_world.is_body_sleeping(1), false);
    Ok(())
}
