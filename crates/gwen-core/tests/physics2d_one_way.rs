//! One-way platforms let a body through from below and hold it from above.
//!
//! Native only. Run with `--features physics2d`. Each test owns one
//! `PhysicsWorld` and drops it when the function returns.

#![cfg(feature = "physics2d")]

use gwen_core::physics2d::{
    BodyOptions, BodyType, ColliderOptions, Physics2DError, PhysicsMaterial, PhysicsWorld,
};

const DT: f32 = 1.0 / 60.0;
const PLATFORM_SLOT: u32 = 0;
const BODY_SLOT: u32 = 1;
/// Wide enough that the body cannot leave the platform sideways.
const PLATFORM_HW: f32 = 2.0;
const PLATFORM_HH: f32 = 0.5;
const BODY_HW: f32 = 0.4;
const BODY_HH: f32 = 0.5;
/// Centre below the platform, with a 1 m gap between the body top and the underside.
const LAUNCH_Y: f32 = -2.0;
/// Metres per second. One step moves `UP_VY * DT` = 0.1 m, less than the 1 m thickness.
const UP_VY: f32 = 6.0;
/// Steps of free motion. `y = LAUNCH_Y + n * UP_VY * DT` clears the top (0.5) after 25
/// steps and sits 1 m above the resting centre after 40 steps.
const UP_STEPS: u32 = 40;
const GRAVITY_Y: f32 = -9.81;
/// Centre above the platform. Drop to the resting centre is 3 m.
const DROP_Y: f32 = 4.0;
/// One second of contact settling after the free-fall time. Rapier's allowed linear
/// error is 0.001 m (`rapier2d-0.22.0` `dynamics/integration_parameters.rs:291`).
const SETTLE_STEPS: u32 = 60;
/// Ten times that allowed error.
const REST_TOL: f32 = 0.01;
/// Centre after `UP_STEPS` of free motion: `LAUNCH_Y + UP_STEPS * UP_VY * DT`.
fn free_flight_y() -> f32 {
    LAUNCH_Y + (UP_STEPS as f32) * UP_VY * DT
}

/// `UP_STEPS` rounded additions. Each errs by at most one ulp of
/// `|LAUNCH_Y| + |travel|`. `f32::EPSILON` is one ulp of 1.
fn free_flight_tol() -> f32 {
    let travel = (UP_STEPS as f32) * UP_VY * DT;
    (UP_STEPS as f32) * f32::EPSILON * (LAUNCH_Y.abs() + travel.abs())
}

/// Rapier sleeps a body slower than this (`rigid_body_components.rs:1026`).
const REST_SPEED: f32 = 0.4;

fn collider(one_way: bool) -> ColliderOptions {
    ColliderOptions {
        // Frictionless, no bounce: the landing velocity stays vertical.
        material: PhysicsMaterial {
            restitution: 0.0,
            friction: 0.0,
        },
        is_one_way: one_way,
        ..ColliderOptions::default()
    }
}

fn platform_top() -> f32 {
    PLATFORM_HH
}

fn platform_bottom() -> f32 {
    -PLATFORM_HH
}

fn rest_y() -> f32 {
    platform_top() + BODY_HH
}

/// Fixed platform at the origin and a dynamic box. The world is returned to the caller.
///
/// `body_first` creates the dynamic body and its collider before the platform.
/// `OneWayHooks` allows `+Y` when the platform is collider1 and `-Y` when it is
/// collider2 (`physics2d/world.rs:209`). Slots stay `PLATFORM_SLOT` and `BODY_SLOT`.
fn scene(
    one_way: bool,
    body_first: bool,
    y: f32,
    vy: f32,
    gravity_y: f32,
) -> Result<PhysicsWorld, Physics2DError> {
    let mut world = PhysicsWorld::new(0.0, gravity_y);
    if body_first {
        let body =
            world.add_rigid_body(BODY_SLOT, 0.0, y, BodyType::Dynamic, BodyOptions::default())?;
        world.add_box_collider(body, BODY_HW, BODY_HH, collider(false))?;
        let platform = world.add_rigid_body(
            PLATFORM_SLOT,
            0.0,
            0.0,
            BodyType::Fixed,
            BodyOptions::default(),
        )?;
        world.add_box_collider(platform, PLATFORM_HW, PLATFORM_HH, collider(one_way))?;
    } else {
        let platform = world.add_rigid_body(
            PLATFORM_SLOT,
            0.0,
            0.0,
            BodyType::Fixed,
            BodyOptions::default(),
        )?;
        world.add_box_collider(platform, PLATFORM_HW, PLATFORM_HH, collider(one_way))?;
        let body =
            world.add_rigid_body(BODY_SLOT, 0.0, y, BodyType::Dynamic, BodyOptions::default())?;
        world.add_box_collider(body, BODY_HW, BODY_HH, collider(false))?;
    }
    // Keep the half-height vertical so the resting centre is top + half height.
    world.lock_body_rotation(BODY_SLOT, true)?;
    // `set_linear_velocity` returns false when the slot has no body
    // (`physics2d/world.rs:471-476`).
    if !world.set_linear_velocity(BODY_SLOT, 0.0, vy) {
        return Err(Physics2DError::BodyNotFound { slot: BODY_SLOT });
    }
    Ok(world)
}

fn steps(world: &mut PhysicsWorld, count: u32) -> Result<(), Physics2DError> {
    for _ in 0..count {
        world.step(DT)?;
    }
    Ok(())
}

fn centre_y(world: &PhysicsWorld) -> Result<f32, Physics2DError> {
    let (_x, y, _angle) = world
        .get_position(BODY_SLOT)
        .ok_or(Physics2DError::BodyNotFound { slot: BODY_SLOT })?;
    Ok(y)
}

fn velocity_y(world: &PhysicsWorld) -> Result<f32, Physics2DError> {
    let (_vx, vy) = world
        .get_linear_velocity(BODY_SLOT)
        .ok_or(Physics2DError::BodyNotFound { slot: BODY_SLOT })?;
    Ok(vy)
}

#[test]
fn a_body_passes_up_through_a_one_way_platform() -> Result<(), Physics2DError> {
    passes_up(false)
}

#[test]
fn a_body_passes_up_through_a_one_way_platform_when_the_body_was_created_first(
) -> Result<(), Physics2DError> {
    passes_up(true)
}

fn passes_up(body_first: bool) -> Result<(), Physics2DError> {
    let mut world = scene(true, body_first, LAUNCH_Y, UP_VY, 0.0)?;
    steps(&mut world, UP_STEPS)?;
    let y = centre_y(&world)?;
    let vy = velocity_y(&world)?;
    let expected = free_flight_y();
    let delta = (y - expected).abs();
    assert_eq!(
        delta.clamp(0.0, free_flight_tol()),
        delta,
        "centre y {y} expected {expected}"
    );
    assert_eq!(
        vy.total_cmp(&0.0),
        std::cmp::Ordering::Greater,
        "upward speed {vy}"
    );
    Ok(())
}

#[test]
fn a_body_lands_on_a_one_way_platform() -> Result<(), Physics2DError> {
    lands(false)
}

#[test]
fn a_body_lands_on_a_one_way_platform_when_the_body_was_created_first() -> Result<(), Physics2DError>
{
    lands(true)
}

fn lands(body_first: bool) -> Result<(), Physics2DError> {
    let mut world = scene(true, body_first, DROP_Y, 0.0, GRAVITY_Y)?;
    // t = sqrt(2 * drop / |g|), drop = DROP_Y - rest_y = 3.
    let drop = DROP_Y - rest_y();
    let fall_time = (2.0 * drop / GRAVITY_Y.abs()).sqrt();
    let fall_steps = (fall_time / DT).ceil() as u32;
    steps(&mut world, fall_steps + SETTLE_STEPS)?;
    let y = centre_y(&world)?;
    let vy = velocity_y(&world)?;
    let expected = rest_y();
    let delta = (y - expected).abs();
    assert_eq!(
        delta.clamp(0.0, REST_TOL),
        delta,
        "centre y {y} expected {expected}"
    );
    let speed = vy.abs();
    assert_eq!(speed.clamp(0.0, REST_SPEED), speed, "vertical speed {vy}");
    Ok(())
}

#[test]
fn a_solid_platform_blocks_a_body_moving_up() -> Result<(), Physics2DError> {
    let mut world = scene(false, false, LAUNCH_Y, UP_VY, 0.0)?;
    steps(&mut world, UP_STEPS)?;
    let y = centre_y(&world)?;
    // Contact centre is platform_bottom - BODY_HH = -1, still below the underside.
    assert_eq!(
        y.total_cmp(&platform_bottom()),
        std::cmp::Ordering::Less,
        "centre y {y}"
    );
    Ok(())
}
