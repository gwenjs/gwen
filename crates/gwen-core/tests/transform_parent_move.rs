#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::unreachable,
    clippy::todo,
    clippy::unimplemented,
    reason = "test-only code"
)]
//! A moved parent moves its children in the same `update_transforms` pass.

use gwen_core::bindings::Engine;
use gwen_core::CoreError;

/// Rounds to 1e-4 so a float comparison tolerates the matrix round trip.
fn round4(value: f32) -> f32 {
    (value * 1e4).round() / 1e4
}

fn engine(max_entities: u32) -> Result<Engine, CoreError> {
    Engine::new(max_entities)
}

#[test]
fn moved_parent_moves_its_child() -> Result<(), CoreError> {
    let mut engine = engine(4)?;
    let parent = engine.create_entity()?;
    let child = engine.create_entity()?;
    engine.add_entity_transform(parent.index(), 0.0, 10.0, 0.0, 1.0, 1.0);
    engine.add_entity_transform(child.index(), 0.0, 1.0, 0.0, 1.0, 1.0);
    engine.set_entity_parent(child.index(), parent.index(), false)?;

    engine.update_transforms();
    assert_eq!(engine.get_entity_world_y(child.index()), 11.0);

    engine.set_entity_local_position(parent.index(), 0.0, 50.0);
    engine.update_transforms();
    assert_eq!(engine.get_entity_world_y(child.index()), 51.0);
    Ok(())
}

#[test]
fn moved_root_moves_a_three_level_chain() -> Result<(), CoreError> {
    let mut engine = engine(8)?;
    let root = engine.create_entity()?;
    let above = engine.create_entity()?;
    let middle = engine.create_entity()?;
    let leaf = engine.create_entity()?;
    engine.add_entity_transform(root.index(), 0.0, 10.0, 0.0, 1.0, 1.0);
    engine.add_entity_transform(above.index(), 0.0, 1.0, 0.0, 1.0, 1.0);
    engine.add_entity_transform(middle.index(), 0.0, 1.0, 0.0, 1.0, 1.0);
    engine.add_entity_transform(leaf.index(), 0.0, 1.0, 0.0, 1.0, 1.0);
    engine.set_entity_parent(above.index(), root.index(), false)?;
    engine.set_entity_parent(middle.index(), above.index(), false)?;
    engine.set_entity_parent(leaf.index(), middle.index(), false)?;

    engine.update_transforms();
    assert_eq!(engine.get_entity_world_y(leaf.index()), 13.0);

    engine.set_entity_local_position(root.index(), 0.0, 50.0);
    engine.update_transforms();
    assert_eq!(engine.get_entity_world_y(above.index()), 51.0);
    assert_eq!(engine.get_entity_world_y(middle.index()), 52.0);
    assert_eq!(engine.get_entity_world_y(leaf.index()), 53.0);
    Ok(())
}

#[test]
fn rotated_parent_rotates_child_offset() -> Result<(), CoreError> {
    let mut engine = engine(4)?;
    let parent = engine.create_entity()?;
    let child = engine.create_entity()?;
    engine.add_entity_transform(parent.index(), 0.0, 0.0, 0.0, 1.0, 1.0);
    engine.add_entity_transform(child.index(), 0.0, 1.0, 0.0, 1.0, 1.0);
    engine.set_entity_parent(child.index(), parent.index(), false)?;
    engine.update_transforms();

    engine.set_entity_local_rotation(parent.index(), std::f32::consts::FRAC_PI_2);
    engine.update_transforms();
    let x = engine.get_entity_world_x(child.index());
    let y = engine.get_entity_world_y(child.index());
    let rotation = engine.get_entity_world_rotation(child.index());
    assert_eq!(round4(x), -1.0, "left: {x} right: -1.0");
    assert_eq!(round4(y), 0.0, "left: {y} right: 0.0");
    assert_eq!(
        round4(rotation),
        round4(std::f32::consts::FRAC_PI_2),
        "left: {rotation} right: {}",
        std::f32::consts::FRAC_PI_2
    );
    Ok(())
}

#[test]
fn unchanged_parent_leaves_child_untouched() -> Result<(), CoreError> {
    let mut engine = engine(4)?;
    let parent = engine.create_entity()?;
    let child = engine.create_entity()?;
    engine.add_entity_transform(parent.index(), 0.0, 10.0, 0.0, 1.0, 1.0);
    engine.add_entity_transform(child.index(), 0.0, 1.0, 0.0, 1.0, 1.0);
    engine.set_entity_parent(child.index(), parent.index(), false)?;
    engine.update_transforms();

    engine.set_entity_local_position(parent.index(), 0.0, 50.0);
    engine.update_transforms();
    assert_eq!(engine.get_entity_world_y(child.index()), 51.0);
    assert_eq!(engine.get_entity_world_y(parent.index()), 50.0);
    let parent_x = engine.get_entity_world_x(parent.index());
    let parent_y = engine.get_entity_world_y(parent.index());
    let parent_rotation = engine.get_entity_world_rotation(parent.index());
    let child_x = engine.get_entity_world_x(child.index());
    let child_y = engine.get_entity_world_y(child.index());
    let child_rotation = engine.get_entity_world_rotation(child.index());

    engine.update_transforms();
    assert_eq!(engine.get_entity_world_x(parent.index()), parent_x);
    assert_eq!(engine.get_entity_world_y(parent.index()), parent_y);
    assert_eq!(
        engine.get_entity_world_rotation(parent.index()),
        parent_rotation
    );
    assert_eq!(engine.get_entity_world_x(child.index()), child_x);
    assert_eq!(engine.get_entity_world_y(child.index()), child_y);
    assert_eq!(
        engine.get_entity_world_rotation(child.index()),
        child_rotation
    );
    Ok(())
}
