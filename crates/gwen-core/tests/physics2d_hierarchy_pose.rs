//! A dynamic body writes its Rapier pose into the transform hierarchy.
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

/// After one `physics_step`, world x, y, and rotation equal the Rapier pose.
#[test]
fn dynamic_body_hierarchy_world_matches_rapier_and_the_column_keeps_the_pose(
) -> Result<(), Physics2DError> {
    let mut engine = Engine::new(8).map_err(Physics2DError::Core)?;
    engine.physics_init(0.0, -9.81, 8);
    let id = engine.create_entity().map_err(Physics2DError::Core)?;
    let index = id.index();
    engine.add_entity_transform(index, 0.0, 10.0, 0.0, 1.0, 1.0);
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
    Ok(())
}
