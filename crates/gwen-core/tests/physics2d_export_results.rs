//! Observable physics2d export behaviour through `Engine`.
//!
//! Native only. `verify-red` runs this target without `--features physics2d`,
//! so the file is empty in that run.

#![cfg(feature = "physics2d")]

use gwen_core::bindings::Engine;
use gwen_core::physics2d::Physics2DError;

fn engine() -> Engine {
    Engine::new(8).unwrap_or_else(|err| {
        assert_eq!(err.code(), "");
        std::process::abort();
    })
}

fn code<T>(result: Result<T, Physics2DError>) -> &'static str {
    match result {
        Ok(_) => "OK",
        Err(err) => err.code(),
    }
}

fn must_u32(result: Result<u32, Physics2DError>) -> u32 {
    result.unwrap_or_else(|err| {
        assert_eq!(err.code(), "");
        std::process::abort();
    })
}

fn must_vec(result: Result<Vec<f32>, Physics2DError>) -> Vec<f32> {
    result.unwrap_or_else(|err| {
        assert_eq!(err.code(), "");
        std::process::abort();
    })
}

fn must_slots(result: Result<Vec<u32>, Physics2DError>) -> Vec<u32> {
    result.unwrap_or_else(|err| {
        assert_eq!(err.code(), "");
        std::process::abort();
    })
}

fn init(engine: &mut Engine) {
    engine.physics_init(0.0, -9.81, 8);
}

fn add(engine: &mut Engine, slot: u32, x: f32, y: f32, kind: u8) -> u32 {
    must_u32(
        engine.physics_add_rigid_body(slot, x, y, kind, 1.0, 1.0, 0.0, 0.0, 0.0, 0.0, None, None),
    )
}

#[test]
fn second_add_rigid_body_keeps_the_first_translation() {
    let mut engine = engine();
    init(&mut engine);
    let _first = add(&mut engine, 1, 3.0, 4.0, 0);
    let second =
        engine.physics_add_rigid_body(1, 9.0, 9.0, 1, 1.0, 1.0, 0.0, 0.0, 0.0, 0.0, None, None);
    assert_eq!(code(second), "PHYSICS2D:BODY_ALREADY_EXISTS");
    assert_eq!(
        must_vec(engine.physics_get_position(1)),
        vec![3.0, 4.0, 0.0]
    );
}

#[test]
fn unknown_body_kind_inserts_no_body() {
    let mut engine = engine();
    init(&mut engine);
    let refused =
        engine.physics_add_rigid_body(1, 1.0, 2.0, 9, 1.0, 1.0, 0.0, 0.0, 0.0, 0.0, None, None);
    assert_eq!(code(refused), "PHYSICS2D:INVALID_BODY_KIND");
    assert_eq!(must_vec(engine.physics_get_position(1)), Vec::<f32>::new());
}

#[test]
fn kind_one_inserts_a_body_at_the_requested_position() {
    let mut engine = engine();
    init(&mut engine);
    let _handle = add(&mut engine, 1, 1.0, 2.0, 1);
    assert_eq!(
        must_vec(engine.physics_get_position(1)),
        vec![1.0, 2.0, 0.0]
    );
}

#[test]
fn second_tilemap_load_keeps_the_first_origin() {
    let mut engine = engine();
    init(&mut engine);
    let pseudo = 7_u32 | 0x8000_0000;
    let _first = must_u32(engine.physics_load_tilemap_chunk_body(7, pseudo, 1.0, 2.0));
    let second = engine.physics_load_tilemap_chunk_body(7, pseudo, 8.0, 9.0);
    assert_eq!(code(second), "PHYSICS2D:TILEMAP_CHUNK_ALREADY_LOADED");
    assert_eq!(
        must_vec(engine.physics_get_position(pseudo)),
        vec![1.0, 2.0, 0.0]
    );
}

#[test]
fn add_without_a_world_returns_not_initialized() {
    let mut engine = engine();
    let refused =
        engine.physics_add_rigid_body(1, 3.0, 4.0, 0, 1.0, 1.0, 0.0, 0.0, 0.0, 0.0, None, None);
    assert_eq!(code(refused), "PHYSICS2D:NOT_INITIALIZED");
    init(&mut engine);
    assert_eq!(must_vec(engine.physics_get_position(1)), Vec::<f32>::new());
}

#[test]
fn step_and_quality_without_a_world_return_not_initialized() {
    let mut engine = engine();
    assert_eq!(
        code(engine.physics_step(0.016)),
        "PHYSICS2D:NOT_INITIALIZED"
    );
    assert_eq!(
        code(engine.physics_set_quality(0)),
        "PHYSICS2D:NOT_INITIALIZED"
    );
    init(&mut engine);
    assert_eq!(must_vec(engine.physics_get_position(1)), Vec::<f32>::new());
}

#[test]
fn set_linear_velocity_on_a_missing_slot_returns_body_not_found() {
    let mut engine = engine();
    init(&mut engine);
    let refused = engine.physics_set_linear_velocity(4, 1.0, 2.0);
    assert_eq!(code(refused), "PHYSICS2D:BODY_NOT_FOUND");
    assert_eq!(must_vec(engine.physics_get_position(4)), Vec::<f32>::new());
}

#[test]
fn set_linear_velocity_returns_one_and_the_velocity() {
    let mut engine = engine();
    engine.physics_init(0.0, 0.0, 8);
    let _handle = add(&mut engine, 1, 0.0, 0.0, 1);
    assert_eq!(must_u32(engine.physics_set_linear_velocity(1, 3.0, 4.0)), 1);
    assert_eq!(
        must_vec(engine.physics_get_linear_velocity(1)),
        vec![3.0, 4.0]
    );
}

#[test]
fn missing_slot_get_position_and_velocity_are_empty() {
    let mut engine = engine();
    init(&mut engine);
    assert_eq!(must_vec(engine.physics_get_position(3)), Vec::<f32>::new());
    assert_eq!(
        must_vec(engine.physics_get_linear_velocity(3)),
        Vec::<f32>::new()
    );
}

#[test]
fn get_position_without_a_world_returns_not_initialized() {
    let engine = engine();
    assert_eq!(
        code(engine.physics_get_position(1)),
        "PHYSICS2D:NOT_INITIALIZED"
    );
    assert_eq!(
        code(engine.physics_get_linear_velocity(1)),
        "PHYSICS2D:NOT_INITIALIZED"
    );
}

#[test]
fn collider_on_an_unknown_handle_returns_stale_body_handle() {
    let mut engine = engine();
    engine.physics_init(0.0, 0.0, 8);
    let _handle = add(&mut engine, 1, 0.0, 0.0, 0);
    let box_refused = engine.physics_add_box_collider(
        999, 0.5, 0.5, 0.0, 0.5, 0, 1.0, 0xFFFF, 0xFFFF, None, None, None, None,
    );
    let ball_refused = engine
        .physics_add_ball_collider(998, 0.5, 0.0, 0.5, 0, 1.0, 0xFFFF, 0xFFFF, None, None, None);
    assert_eq!(code(box_refused), "PHYSICS2D:STALE_BODY_HANDLE");
    assert_eq!(code(ball_refused), "PHYSICS2D:STALE_BODY_HANDLE");
    must_u32(engine.physics_step(1.0 / 60.0).map(|()| 0));
    assert_eq!(
        must_slots(engine.physics_query_radius(0.0, 0.0, 1.0, 0xFFFF, 0xFFFF)),
        Vec::<u32>::new()
    );
    assert_eq!(
        must_vec(engine.physics_get_position(1)),
        vec![0.0, 0.0, 0.0]
    );
}

#[test]
fn unload_of_an_unknown_chunk_returns_not_loaded() {
    let mut engine = engine();
    init(&mut engine);
    let pseudo = 7_u32 | 0x8000_0000;
    let _handle = must_u32(engine.physics_load_tilemap_chunk_body(7, pseudo, 1.0, 2.0));
    assert_eq!(
        code(engine.physics_unload_tilemap_chunk_body(8)),
        "PHYSICS2D:TILEMAP_CHUNK_NOT_LOADED"
    );
    assert_eq!(
        must_vec(engine.physics_get_position(pseudo)),
        vec![1.0, 2.0, 0.0]
    );
    must_u32(engine.physics_unload_tilemap_chunk_body(7).map(|()| 0));
    assert_eq!(
        must_vec(engine.physics_get_position(pseudo)),
        Vec::<f32>::new()
    );
    assert_eq!(
        code(engine.physics_unload_tilemap_chunk_body(7)),
        "PHYSICS2D:TILEMAP_CHUNK_NOT_LOADED"
    );
}

#[test]
fn remove_of_a_missing_slot_leaves_the_other_body() {
    let mut engine = engine();
    init(&mut engine);
    let _handle = add(&mut engine, 1, 3.0, 4.0, 0);
    assert_eq!(
        code(engine.physics_remove_rigid_body(2)),
        "PHYSICS2D:BODY_NOT_FOUND"
    );
    assert_eq!(
        must_vec(engine.physics_get_position(1)),
        vec![3.0, 4.0, 0.0]
    );
}

#[test]
fn apply_impulse_on_a_missing_slot_leaves_the_other_velocity() {
    let mut engine = engine();
    engine.physics_init(0.0, 0.0, 8);
    let _handle = add(&mut engine, 1, 0.0, 0.0, 1);
    assert_eq!(must_u32(engine.physics_set_linear_velocity(1, 5.0, 0.0)), 1);
    assert_eq!(
        code(engine.physics_apply_impulse(2, 9.0, 9.0)),
        "PHYSICS2D:BODY_NOT_FOUND"
    );
    assert_eq!(
        must_vec(engine.physics_get_linear_velocity(1)),
        vec![5.0, 0.0]
    );
}

#[test]
fn set_linear_damping_on_a_missing_slot_leaves_the_velocity() {
    let mut engine = engine();
    engine.physics_init(0.0, 0.0, 8);
    let _handle = add(&mut engine, 1, 0.0, 0.0, 1);
    assert_eq!(must_u32(engine.physics_set_linear_velocity(1, 5.0, 0.0)), 1);
    assert_eq!(
        code(engine.physics_set_linear_damping(2, 100.0)),
        "PHYSICS2D:BODY_NOT_FOUND"
    );
    must_u32(engine.physics_step(0.1).map(|()| 0));
    let velocity = must_vec(engine.physics_get_linear_velocity(1));
    assert_eq!(velocity, vec![5.0, 0.0]);
}

#[test]
fn set_kinematic_position_on_a_missing_slot_leaves_the_other_body() {
    let mut engine = engine();
    init(&mut engine);
    let _handle = add(&mut engine, 1, 1.0, 2.0, 2);
    assert_eq!(
        code(engine.physics_set_kinematic_position(2, 9.0, 9.0, 0.0)),
        "PHYSICS2D:BODY_NOT_FOUND"
    );
    assert_eq!(
        must_vec(engine.physics_get_position(1)),
        vec![1.0, 2.0, 0.0]
    );
    assert_eq!(
        must_u32(engine.physics_set_kinematic_position(1, 6.0, 7.0, 0.0)),
        1
    );
}

#[test]
fn queries_without_a_world_return_not_initialized() {
    let engine = engine();
    assert_eq!(
        code(engine.physics_query_radius(0.0, 0.0, 1.0, 1, 1)),
        "PHYSICS2D:NOT_INITIALIZED"
    );
    assert_eq!(
        code(engine.physics_query_rect(0.0, 0.0, 1.0, 1.0, 1, 1)),
        "PHYSICS2D:NOT_INITIALIZED"
    );
    assert_eq!(
        code(engine.physics_point_query(0.0, 0.0, 1, 1)),
        "PHYSICS2D:NOT_INITIALIZED"
    );
}

#[test]
fn query_with_a_world_and_no_hit_is_empty() {
    let mut engine = engine();
    init(&mut engine);
    assert_eq!(
        must_slots(engine.physics_query_radius(0.0, 0.0, 1.0, 1, 1)),
        Vec::<u32>::new()
    );
}
