#![cfg(feature = "physics2d")]
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
//! The dynamic ball on the ground is the witness that the step still simulated.

use gwen_core::physics2d::{
    BodyOptions, BodyType, ColliderOptions, Physics2DError, PhysicsQualityPreset, PhysicsWorld,
};
use std::panic::{catch_unwind, AssertUnwindSafe};

const DT: f32 = 1.0 / 60.0;
/// Long enough for a ball dropped from `SPAWN_Y` to sit on the ground.
const STEPS: u32 = 180;
const BALL_RADIUS: f32 = 0.5;
/// Just above contact with a ground whose top is y = 0.
const SPAWN_Y: f32 = 0.55;
const FAR_X: f32 = 1.0e12;
const GROUND_SLOT: u32 = 0;
const BALL_SLOT: u32 = 1;
const FAR_SLOT: u32 = 2;

/// Ground top at y = 0. Ball centre starts at `SPAWN_Y`.
fn ground_and_ball(world: &mut PhysicsWorld) -> Result<(), Physics2DError> {
    let ground = world.add_rigid_body(
        GROUND_SLOT,
        0.0,
        -0.5,
        BodyType::Fixed,
        BodyOptions::default(),
    )?;
    world.add_box_collider(ground, 4.0, 0.5, ColliderOptions::default())?;
    let ball = world.add_rigid_body(
        BALL_SLOT,
        0.0,
        SPAWN_Y,
        BodyType::Dynamic,
        BodyOptions::default(),
    )?;
    world.add_ball_collider(ball, BALL_RADIUS, ColliderOptions::default())?;
    Ok(())
}

fn far_fixed_ball(world: &mut PhysicsWorld) -> Result<(), Physics2DError> {
    let far = world.add_rigid_body(
        FAR_SLOT,
        FAR_X,
        0.0,
        BodyType::Fixed,
        BodyOptions::default(),
    )?;
    world.add_ball_collider(far, BALL_RADIUS, ColliderOptions::default())?;
    Ok(())
}

fn step_word(world: &mut PhysicsWorld) -> &'static str {
    let prev = std::panic::take_hook();
    std::panic::set_hook(Box::new(|_| {}));
    let result = catch_unwind(AssertUnwindSafe(|| {
        for _ in 0..STEPS {
            world.step(DT)?;
        }
        Ok::<(), Physics2DError>(())
    }));
    std::panic::set_hook(prev);
    match result {
        Ok(Ok(())) => "returned",
        Ok(Err(_)) => "refused",
        Err(_) => "panicked",
    }
}

/// Settled centre of the radius-0.5 ball on a ground whose top is y = 0.
///
/// Measured 2026-10-27 on Rapier 0.36.1 (`std`, `f32`, `dim2`, no `block-solver`),
/// 4 solver iterations, 2 stabilization iterations, 1 CCD substep, last 30 of 180
/// steps at 1/60 s, including the fixed ball at x = 1e12: y = 0.49993077
/// (min = max). The same scene through `PhysicsWorld` on Rapier 0.22.0
/// settles at 0.4987237. The half-width is smaller than that measured gap.
const REST_Y: f32 = 0.49993077;
const REST_HALF_WIDTH: f32 = 0.0002;

fn rest_band_contains(y: f32) -> bool {
    (y - REST_Y).abs() <= REST_HALF_WIDTH
}

#[test]
fn a_ball_at_1e12_steps_without_panic() -> Result<(), Physics2DError> {
    let mut world = PhysicsWorld::new(0.0, -9.81);
    ground_and_ball(&mut world)?;
    far_fixed_ball(&mut world)?;
    assert_eq!(step_word(&mut world), "returned");
    let (_x, y, _angle) = world
        .get_position(BALL_SLOT)
        .ok_or(Physics2DError::BodyNotFound { slot: BALL_SLOT })?;
    assert_eq!(
        rest_band_contains(y),
        true,
        "ground ball y {y} is outside the measured rest band"
    );
    Ok(())
}

const CAP: f32 = 1000.0;
const STEP: f32 = 1.0 / 60.0;

fn dynamic_ball(world: &mut PhysicsWorld, slot: u32) -> Result<(), Physics2DError> {
    let handle = world.add_rigid_body(slot, 0.0, 0.0, BodyType::Dynamic, BodyOptions::default())?;
    world.add_ball_collider(handle, 0.2, ColliderOptions::default())?;
    Ok(())
}

fn linear_speed(world: &PhysicsWorld, slot: u32) -> Result<f32, Physics2DError> {
    let (vx, vy) = world
        .get_linear_velocity(slot)
        .ok_or(Physics2DError::BodyNotFound { slot })?;
    Ok(vx.hypot(vy))
}

/// Length `1000f32.next_up()` on the diagonal. The pre-step guard estimates
/// this pair as exactly 1000 and leaves it, so only Rapier's cap can change it.
fn cap_plus_one_velocity() -> (f32, f32) {
    let component = CAP / 2.0f32.sqrt();
    (component, component)
}

fn raised_cap_with_ball() -> Result<PhysicsWorld, Physics2DError> {
    let mut world = PhysicsWorld::new(0.0, 0.0);
    assert_eq!(world.set_max_linear_velocity(CAP), true);
    dynamic_ball(&mut world, 0)?;
    Ok(world)
}

/// 5000 m/s is above the raised cap, so this step is a real clamp.
#[test]
fn speed_after_one_step_is_capped_at_a_raised_max_linear_velocity() -> Result<(), Physics2DError> {
    let mut world = raised_cap_with_ball()?;
    assert_eq!(world.set_linear_velocity(0, 5000.0, 0.0), true);
    world.step(STEP)?;
    let speed = linear_speed(&world, 0)?;
    assert_eq!(speed, CAP, "speed {speed}");
    Ok(())
}

#[test]
fn a_body_at_exactly_the_raised_cap_keeps_its_speed() -> Result<(), Physics2DError> {
    let mut world = raised_cap_with_ball()?;
    assert_eq!(world.set_linear_velocity(0, CAP, 0.0), true);
    world.step(STEP)?;
    let speed = linear_speed(&world, 0)?;
    assert_eq!(speed, CAP, "speed {speed}");
    Ok(())
}

#[test]
fn cap_plus_one_is_clamped_to_the_raised_cap() -> Result<(), Physics2DError> {
    let mut world = raised_cap_with_ball()?;
    let (vx, vy) = cap_plus_one_velocity();
    assert_eq!(vx.hypot(vy), CAP.next_up());
    assert_eq!(world.set_linear_velocity(0, vx, vy), true);
    world.step(STEP)?;
    let speed = linear_speed(&world, 0)?;
    // Rapier scales by `cap / length`. That product is the next f32 below the cap.
    assert_eq!(speed, CAP.next_down(), "speed {speed}");
    Ok(())
}

#[test]
fn a_refused_cap_keeps_the_raised_rapier_cap() -> Result<(), Physics2DError> {
    let mut world = raised_cap_with_ball()?;
    assert_eq!(world.set_linear_velocity(0, CAP, 0.0), true);
    assert_eq!(world.set_max_linear_velocity(f32::NAN), false);
    assert_eq!(world.set_max_linear_velocity(0.0), false);
    assert_eq!(world.set_max_linear_velocity(-1.0), false);
    world.step(STEP)?;
    let speed = linear_speed(&world, 0)?;
    assert_eq!(speed, CAP, "speed {speed}");
    Ok(())
}

/// Gravity pushes a body that already sits on a lowered cap. The pre-step guard
/// leaves that speed alone, so only Rapier's per-substep cap can hold it.
#[test]
fn a_lowered_cap_is_enforced_by_the_solver_after_the_guard() -> Result<(), Physics2DError> {
    let mut world = PhysicsWorld::new(9.81, 0.0);
    assert_eq!(world.set_max_linear_velocity(100.0), true);
    dynamic_ball(&mut world, 0)?;
    assert_eq!(world.set_linear_velocity(0, 100.0, 0.0), true);
    world.step(STEP)?;
    let speed = linear_speed(&world, 0)?;
    assert_eq!(speed, 100.0, "speed {speed}");
    Ok(())
}

#[test]
fn a_body_launched_at_1e12_is_capped_at_the_default_max_linear_velocity(
) -> Result<(), Physics2DError> {
    let mut world = PhysicsWorld::new(0.0, 0.0);
    dynamic_ball(&mut world, 0)?;
    assert_eq!(world.set_linear_velocity(0, 1.0e12, 0.0), true);
    world.step(STEP)?;
    let speed = linear_speed(&world, 0)?;
    assert_eq!(speed, 400.0, "speed {speed}");
    Ok(())
}

fn fast_box_against_a_thin_wall(world: &mut PhysicsWorld) -> Result<(), Physics2DError> {
    let wall = world.add_rigid_body(2, 0.0, 0.0, BodyType::Fixed, BodyOptions::default())?;
    world.add_box_collider(wall, 0.05, 2.0, ColliderOptions::default())?;
    let box_handle = world.add_rigid_body(
        3,
        -6.0,
        0.0,
        BodyType::Dynamic,
        BodyOptions {
            initial_velocity: (120.0, 0.0),
            ccd_enabled: Some(false),
            ..BodyOptions::default()
        },
    )?;
    world.add_box_collider(box_handle, 0.08, 0.08, ColliderOptions::default())?;
    Ok(())
}

/// Characterisation test of a Rapier 0.36.1 default already true after P-RAP-3a.
///
/// The Low preset keeps one CCD substep. A fast box with per-body CCD off
/// still stops on a thin fixed wall.
#[test]
fn low_preset_does_not_tunnel_a_fast_box() -> Result<(), Physics2DError> {
    let mut world = PhysicsWorld::new(0.0, 0.0);
    world.set_quality_preset(PhysicsQualityPreset::Low);
    fast_box_against_a_thin_wall(&mut world)?;
    for _ in 0..24 {
        world.step(1.0 / 120.0)?;
    }
    let (x, _, _) = world
        .get_position(3)
        .ok_or(Physics2DError::BodyNotFound { slot: 3 })?;
    assert_eq!(x <= 0.30, true, "x={x}");
    Ok(())
}
