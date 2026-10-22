//! A dynamic body that `physics_step` moves takes its transform child with it.
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

/// Rounds to 1e-4 so a float comparison tolerates the matrix round trip.
fn round4(value: f32) -> f32 {
    (value * 1e4).round() / 1e4
}

#[test]
fn stepped_body_moves_its_child() -> Result<(), Physics2DError> {
    let mut engine = Engine::new(8).map_err(Physics2DError::Core)?;
    engine.physics_init(0.0, -9.81, 8);
    let parent = engine.create_entity().map_err(Physics2DError::Core)?;
    let child = engine.create_entity().map_err(Physics2DError::Core)?;
    let parent_index = parent.index();
    let child_index = child.index();
    engine.add_entity_transform(parent_index, 0.0, 10.0, 0.0, 1.0, 1.0);
    engine.add_entity_transform(child_index, 0.0, 1.0, 0.0, 1.0, 1.0);
    engine.physics_add_rigid_body(
        parent_index,
        0.0,
        10.0,
        1,
        1.0,
        1.0,
        0.0,
        0.0,
        0.0,
        0.0,
        None,
        None,
    )?;
    engine
        .set_entity_parent(child_index, parent_index, false)
        .map_err(Physics2DError::Core)?;

    engine.update_transforms();
    assert_eq!(engine.get_entity_world_y(child_index), 11.0);

    engine.physics_step(0.1)?;
    // The pose is published inside `physics_step`, before the next transform pass.
    let parent_y_after_step = engine.get_entity_world_y(parent_index);
    assert_eq!(
        parent_y_after_step.partial_cmp(&10.0),
        Some(std::cmp::Ordering::Less)
    );

    engine.update_transforms();
    let parent_y = engine.get_entity_world_y(parent_index);
    let child_y = engine.get_entity_world_y(child_index);
    assert_eq!(parent_y.partial_cmp(&10.0), Some(std::cmp::Ordering::Less));
    assert_eq!(
        round4(child_y),
        round4(parent_y + 1.0),
        "left: {child_y} right: {}",
        parent_y + 1.0
    );
    Ok(())
}
