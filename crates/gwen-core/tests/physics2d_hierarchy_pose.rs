//! A dynamic body writes its Rapier pose into the transform hierarchy and keeps the column write.
//!
//! Native only. `verify-red` runs this target without `--features physics2d`,
//! so the file is empty in that run.

#![cfg(feature = "physics2d")]
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::unreachable,
    clippy::todo,
    clippy::unimplemented,
    reason = "test-only code"
)]

use gwen_core::bindings::Engine;
use gwen_core::physics2d::Physics2DError;
use gwen_core::TRANSFORM_SAB_TYPE_ID;

fn f32_at(bytes: &[u8], offset: usize) -> f32 {
    let mut buf = [0u8; 4];
    buf.copy_from_slice(&bytes[offset..offset + 4]);
    f32::from_le_bytes(buf)
}

#[test]
fn dynamic_body_hierarchy_world_matches_rapier_and_the_column_keeps_the_pose(
) -> Result<(), Physics2DError> {
    let mut engine = Engine::new(8).map_err(Physics2DError::Core)?;
    engine.physics_init(0.0, -9.81, 8);
    let id = engine.create_entity().map_err(Physics2DError::Core)?;
    let index = id.index();
    let generation = id.generation();
    engine.add_entity_transform(index, 0.0, 10.0, 0.0, 1.0, 1.0);
    engine
        .add_component(index, generation, TRANSFORM_SAB_TYPE_ID, &[0u8; 20])
        .map_err(Physics2DError::Core)?;
    engine.physics_add_rigid_body(
        index, 0.0, 10.0, 1, 1.0, 1.0, 0.0, 0.0, 0.0, 0.0, None, None,
    )?;

    engine.physics_step(0.1)?;

    let pose = engine.physics_get_position(index)?;
    assert_eq!(pose.len(), 3);
    assert_eq!(pose[1].partial_cmp(&10.0), Some(std::cmp::Ordering::Less));
    assert_eq!(engine.get_entity_world_x(index), pose[0]);
    assert_eq!(engine.get_entity_world_y(index), pose[1]);
    assert_eq!(engine.get_entity_world_rotation(index), pose[2]);

    let column = engine.get_component_raw(index, generation, TRANSFORM_SAB_TYPE_ID);
    assert_eq!(column.get(0..12).map(|bytes| bytes.len()), Some(12));
    assert_eq!(f32_at(&column, 0), pose[0]);
    assert_eq!(f32_at(&column, 4), pose[1]);
    assert_eq!(f32_at(&column, 8), pose[2]);
    Ok(())
}
