#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::unreachable,
    clippy::todo,
    clippy::unimplemented,
    reason = "test-only code"
)]
//! After 60 frames of the reference scene, the bench-only models agree bitwise.
//! See internals-docs/adr/0001-component-storage.md.

#[path = "../benches/storage_models/models.rs"]
mod models;

use models::{
    run_frame, ModelADirect, ModelAProd, ModelB, ModelC, StorageModel, DT, REFERENCE_FRAMES,
    STORAGE_REFERENCE_SCENE,
};

fn assert_same(left: &impl StorageModel, right: &impl StorageModel, entity: u32) {
    let left_pos = left.position(entity);
    let right_pos = right.position(entity);
    assert_eq!(
        left_pos[0].to_bits(),
        right_pos[0].to_bits(),
        "position.x entity {entity}"
    );
    assert_eq!(
        left_pos[1].to_bits(),
        right_pos[1].to_bits(),
        "position.y entity {entity}"
    );
    let left_vel = left.velocity(entity);
    let right_vel = right.velocity(entity);
    assert_eq!(
        left_vel[0].to_bits(),
        right_vel[0].to_bits(),
        "velocity.vx entity {entity}"
    );
    assert_eq!(
        left_vel[1].to_bits(),
        right_vel[1].to_bits(),
        "velocity.vy entity {entity}"
    );
    let left_health = left.health(entity);
    let right_health = right.health(entity);
    assert_eq!(
        left_health.is_some(),
        right_health.is_some(),
        "health presence entity {entity}"
    );
    if let (Some(l), Some(r)) = (left_health, right_health) {
        assert_eq!(
            l[0].to_bits(),
            r[0].to_bits(),
            "health.current entity {entity}"
        );
        assert_eq!(l[1].to_bits(), r[1].to_bits(), "health.max entity {entity}");
    }
    assert_eq!(
        left.has_enemy(entity),
        right.has_enemy(entity),
        "enemy entity {entity}"
    );
}

#[test]
fn reference_scene_models_match_after_60_frames() {
    for &count in &STORAGE_REFERENCE_SCENE {
        let mut prod = ModelAProd::build(count);
        let mut direct = ModelADirect::build(count);
        let mut sparse = ModelB::build(count);
        let mut chunked = ModelC::build(count);
        assert!(prod.heap_bytes() > 0, "A.prod heap");
        assert!(direct.heap_bytes() > 0, "A.direct heap");
        assert!(sparse.heap_bytes() > 0, "B heap");
        assert!(chunked.heap_bytes() > 0, "C heap");
        for frame in 0..REFERENCE_FRAMES {
            run_frame(&mut prod, frame, DT);
            run_frame(&mut direct, frame, DT);
            run_frame(&mut sparse, frame, DT);
            run_frame(&mut chunked, frame, DT);
        }
        for entity in 0..count as u32 {
            assert_same(&prod, &direct, entity);
            assert_same(&prod, &sparse, entity);
            assert_same(&prod, &chunked, entity);
        }
    }
}
