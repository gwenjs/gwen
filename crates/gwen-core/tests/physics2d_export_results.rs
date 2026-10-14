//! Observable physics2d export behaviour through `Engine`.
//!
//! Native only. `verify-red` runs this target without `--features physics2d`,
//! so the file is empty in that run.

#![cfg(feature = "physics2d")]

use gwen_core::bindings::Engine;

fn engine() -> Engine {
    Engine::new(8).unwrap_or_else(|err| {
        assert_eq!(err.code(), "");
        std::process::abort();
    })
}

fn add(engine: &mut Engine, slot: u32, x: f32, y: f32, kind: u8) -> u32 {
    engine.physics_add_rigid_body(
        slot, x, y, kind, 1.0, 1.0, 0.0, 0.0, 0.0, 0.0, None, None,
    )
}

#[test]
fn second_add_rigid_body_keeps_the_first_translation() {
    let mut engine = engine();
    engine.physics_init(0.0, -9.81, 8);
    let _first = add(&mut engine, 1, 3.0, 4.0, 0);
    let _second = add(&mut engine, 1, 9.0, 9.0, 1);
    assert_eq!(engine.physics_get_position(1), vec![3.0, 4.0, 0.0]);
}

#[test]
fn unknown_body_kind_inserts_no_body() {
    let mut engine = engine();
    engine.physics_init(0.0, -9.81, 8);
    let _handle = add(&mut engine, 1, 1.0, 2.0, 9);
    assert_eq!(engine.physics_get_position(1), Vec::<f32>::new());
}

#[test]
fn second_tilemap_load_keeps_the_first_origin() {
    let mut engine = engine();
    engine.physics_init(0.0, -9.81, 8);
    let pseudo = 7_u32 | 0x8000_0000;
    let _first = engine.physics_load_tilemap_chunk_body(7, pseudo, 1.0, 2.0);
    let _second = engine.physics_load_tilemap_chunk_body(7, pseudo, 8.0, 9.0);
    assert_eq!(engine.physics_get_position(pseudo), vec![1.0, 2.0, 0.0]);
}
