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

use gwen_core::physics2d::{BodyOptions, BodyType, ColliderOptions, Physics2DError, PhysicsWorld};
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
