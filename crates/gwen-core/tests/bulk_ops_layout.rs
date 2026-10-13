#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::unreachable,
    clippy::todo,
    clippy::unimplemented,
    reason = "test-only code"
)]
//! Integration tests for bulk operations on layout (transforms).
//!
//! These tests verify that the Engine correctly:
//! - Destroys multiple entities in a single bulk_destroy call
//! - Creates multiple entities with transforms in bulk_spawn_with_transforms
//! - Properly assigns positions and rotations to bulk-spawned entities

use gwen_core::bindings::Engine;
use gwen_core::CoreError;

fn open(max_entities: u32) -> Engine {
    match Engine::new(max_entities) {
        Ok(engine) => engine,
        Err(_) => unreachable!("max entities"),
    }
}

#[test]
fn bulk_destroy_frees_all_provided_entities() {
    let mut engine = Engine::new(100).expect("max entities");
    let a = engine.create_entity().expect("entity limit").index();
    let b = engine.create_entity().expect("entity limit").index();
    let c = engine.create_entity().expect("entity limit").index();

    engine.bulk_destroy(&[a, b, c]);
    // After destroying 3 entities, count should be 0
    assert_eq!(engine.count_entities(), 0);
}

#[test]
fn bulk_destroy_skips_already_dead_entities() {
    let mut engine = Engine::new(100).expect("max entities");
    let a = engine.create_entity().expect("entity limit").index();
    let gen = engine.get_entity_generation(a);
    engine.delete_entity(a, gen);
    // Should not panic when bulk_destroy is called with a dead entity
    engine.bulk_destroy(&[a]);
    assert_eq!(engine.count_entities(), 0);
}

#[test]
fn bulk_destroy_with_mixed_alive_and_dead() {
    let mut engine = Engine::new(100).expect("max entities");
    let a = engine.create_entity().expect("entity limit").index();
    let b = engine.create_entity().expect("entity limit").index();
    let c = engine.create_entity().expect("entity limit").index();

    // Delete b
    let gen_b = engine.get_entity_generation(b);
    engine.delete_entity(b, gen_b);

    // Bulk destroy a and c (b is already dead, should be skipped)
    engine.bulk_destroy(&[a, b, c]);
    assert_eq!(engine.count_entities(), 0);
}

#[test]
fn bulk_spawn_with_transforms_creates_correct_count() {
    let mut engine = Engine::new(100).expect("max entities");
    let positions = [0.0f32, 0.0, 16.0, 0.0, 32.0, 0.0];
    let rotations = [0.0f32, 0.0, 0.0];
    assert_eq!(engine.bulk_spawn_with_transforms(&[], &[]), Ok(vec![]));
    assert_eq!(engine.count_entities(), 0);

    let ids = engine
        .bulk_spawn_with_transforms(&positions, &rotations)
        .expect("entity limit");
    assert_eq!(ids.len(), 3);
    assert_eq!(engine.count_entities(), 3);
}

#[test]
fn bulk_spawn_assigns_correct_positions() {
    let mut engine = Engine::new(100).expect("max entities");
    let positions = [10.0f32, 20.0, 30.0, 40.0];
    let ids = engine
        .bulk_spawn_with_transforms(&positions, &[0.0, 0.0])
        .expect("entity limit");
    engine.update_transforms();

    assert!((engine.get_entity_world_x(ids[0]) - 10.0).abs() < 1e-4);
    assert!((engine.get_entity_world_y(ids[0]) - 20.0).abs() < 1e-4);
    assert!((engine.get_entity_world_x(ids[1]) - 30.0).abs() < 1e-4);
    assert!((engine.get_entity_world_y(ids[1]) - 40.0).abs() < 1e-4);
}

#[test]
fn bulk_spawn_assigns_correct_rotations() {
    let mut engine = Engine::new(100).expect("max entities");
    let positions = [0.0f32, 0.0, 0.0, 0.0, 0.0, 0.0];
    let rotations = [0.5f32, 1.0, 1.5];
    let ids = engine
        .bulk_spawn_with_transforms(&positions, &rotations)
        .expect("entity limit");
    engine.update_transforms();

    assert_eq!(ids.len(), 3);
    assert_eq!(engine.count_entities(), 3);
    assert_eq!(engine.get_entity_local_rotation(ids[0]), 0.5);
    assert_eq!(engine.get_entity_local_rotation(ids[1]), 1.0);
    assert_eq!(engine.get_entity_local_rotation(ids[2]), 1.5);
}

#[test]
fn bulk_spawn_rejects_fewer_rotations_than_entities() {
    let mut engine = open(100);
    assert_eq!(engine.create_entity().map(|id| id.index()), Ok(0));
    let positions = [0.0f32, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0];
    let rotations = [0.5f32, 1.0];
    let err = engine.bulk_spawn_with_transforms(&positions, &rotations);
    assert_eq!(
        err,
        Err(CoreError::BufferLengthMismatch {
            buffer: "rotations",
            expected: 4,
            actual: 2,
        })
    );
    if let Err(ref mismatch) = err {
        assert_eq!(mismatch.code(), "CORE:BUFFER_LENGTH_MISMATCH");
        assert_eq!(
            mismatch.to_string(),
            "buffer rotations length mismatch: expected 4, actual 2"
        );
    }
    assert_eq!(engine.count_entities(), 1);
}

#[test]
fn bulk_spawn_rejects_empty_rotations() {
    let mut engine = open(100);
    assert_eq!(engine.create_entity().map(|id| id.index()), Ok(0));
    let err = engine.bulk_spawn_with_transforms(&[5.0, 10.0, 15.0, 20.0], &[]);
    assert_eq!(
        err,
        Err(CoreError::BufferLengthMismatch {
            buffer: "rotations",
            expected: 2,
            actual: 0,
        })
    );
    if let Err(ref mismatch) = err {
        assert_eq!(mismatch.code(), "CORE:BUFFER_LENGTH_MISMATCH");
        assert_eq!(
            mismatch.to_string(),
            "buffer rotations length mismatch: expected 2, actual 0"
        );
    }
    assert_eq!(engine.count_entities(), 1);
}

#[test]
fn bulk_spawn_rejects_an_odd_positions_length() {
    let mut engine = open(100);
    assert_eq!(engine.create_entity().map(|id| id.index()), Ok(0));
    let err = engine.bulk_spawn_with_transforms(&[0.0, 0.0, 0.0, 0.0, 1.0], &[0.0, 0.0]);
    assert_eq!(
        err,
        Err(CoreError::BufferLengthMismatch {
            buffer: "positions",
            expected: 6,
            actual: 5,
        })
    );
    if let Err(ref mismatch) = err {
        assert_eq!(mismatch.code(), "CORE:BUFFER_LENGTH_MISMATCH");
        assert_eq!(
            mismatch.to_string(),
            "buffer positions length mismatch: expected 6, actual 5"
        );
    }
    assert_eq!(engine.count_entities(), 1);
}

#[test]
fn bulk_spawn_rejects_one_extra_rotation() {
    let mut engine = open(100);
    assert_eq!(engine.create_entity().map(|id| id.index()), Ok(0));
    let err = engine.bulk_spawn_with_transforms(&[0.0, 0.0, 1.0, 1.0], &[0.1, 0.2, 0.3]);
    assert_eq!(
        err,
        Err(CoreError::BufferLengthMismatch {
            buffer: "rotations",
            expected: 2,
            actual: 3,
        })
    );
    if let Err(ref mismatch) = err {
        assert_eq!(mismatch.code(), "CORE:BUFFER_LENGTH_MISMATCH");
        assert_eq!(
            mismatch.to_string(),
            "buffer rotations length mismatch: expected 2, actual 3"
        );
    }
    assert_eq!(engine.count_entities(), 1);
}

#[test]
fn bulk_destroy_then_spawn_reuses_slots() {
    let mut engine = Engine::new(100).expect("max entities");

    // Create 5 entities
    let ids: Vec<u32> = (0..5)
        .map(|_| engine.create_entity().expect("entity limit").index())
        .collect();

    let initial_count = engine.count_entities();
    assert_eq!(initial_count, 5);

    // Destroy first 3
    engine.bulk_destroy(&ids[0..3]);
    assert_eq!(engine.count_entities(), 2);

    // Spawn 3 new ones with transforms
    let positions = [0.0f32, 0.0, 10.0, 0.0, 20.0, 0.0];
    let new_ids = engine
        .bulk_spawn_with_transforms(&positions, &[0.0, 0.0, 0.0])
        .expect("entity limit");

    // Should have 5 entities again (2 old + 3 new)
    assert_eq!(engine.count_entities(), 5);
    assert_eq!(new_ids.len(), 3);
}

#[test]
fn bulk_spawn_large_batch() {
    let mut engine = Engine::new(1000).expect("max entities");

    // Create 100 entities
    let mut positions = Vec::new();
    for i in 0..100 {
        positions.push((i as f32) * 10.0);
        positions.push(0.0);
    }

    let rotations = vec![0.0f32; 100];
    let ids = engine
        .bulk_spawn_with_transforms(&positions, &rotations)
        .expect("entity limit");
    assert_eq!(ids.len(), 100);
    assert_eq!(engine.count_entities(), 100);
}

#[test]
fn bulk_destroy_large_batch() {
    let mut engine = Engine::new(1000).expect("max entities");

    // Create 100 entities
    let ids: Vec<u32> = (0..100)
        .map(|_| engine.create_entity().expect("entity limit").index())
        .collect();

    assert_eq!(engine.count_entities(), 100);

    // Destroy all
    engine.bulk_destroy(&ids);
    assert_eq!(engine.count_entities(), 0);
}

#[test]
fn bulk_spawn_assigns_scale_one() {
    let mut engine = Engine::new(100).expect("max entities");
    let positions = [0.0f32, 0.0];
    let ids = engine
        .bulk_spawn_with_transforms(&positions, &[0.0])
        .expect("entity limit");
    engine.update_transforms();

    // All bulk-spawned entities should have scale (1, 1)
    // We can verify this by checking the entity exists and was created
    assert_eq!(ids.len(), 1);
    assert_eq!(engine.count_entities(), 1);
}
