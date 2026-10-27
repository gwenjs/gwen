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
