//! Entity deletion removes the transform node and detaches children as roots.

use gwen_core::bindings::Engine;
use gwen_core::transform::{Transform, TransformSystem};
use gwen_core::transform_math::Vec2;
use gwen_core::CoreError;
use gwen_core::EntityId;

fn engine(max_entities: u32) -> Result<Engine, CoreError> {
    Engine::new(max_entities)
}

#[test]
fn deleting_1000_entities_removes_their_transform_nodes() -> Result<(), CoreError> {
    let mut engine = engine(1000)?;
    let mut ids = Vec::with_capacity(1000);
    for _ in 0..1000 {
        let id = engine.create_entity()?;
        engine.add_entity_transform(id.index(), 0.0, 0.0, 0.0, 1.0, 1.0);
        ids.push(id);
    }
    assert_eq!(engine.stats(), "{\"entities\":1000,\"transforms\":1000}");
    for id in &ids {
        let deleted = engine.delete_entity(id.index(), id.generation())?;
        assert_eq!(u8::from(deleted), 1);
    }
    assert_eq!(engine.stats(), "{\"entities\":0,\"transforms\":0}");
    Ok(())
}

#[test]
fn delete_of_a_stale_handle_keeps_the_node() -> Result<(), CoreError> {
    let mut engine = engine(4)?;
    let id = engine.create_entity()?;
    engine.add_entity_transform(id.index(), 3.0, 4.0, 0.0, 1.0, 1.0);
    engine.update_transforms();
    assert_eq!(engine.get_entity_world_y(id.index()), 4.0);
    let deleted = engine.delete_entity(id.index(), id.generation().wrapping_add(1))?;
    assert_eq!(u8::from(deleted), 0);
    assert_eq!(engine.stats(), "{\"entities\":1,\"transforms\":1}");
    assert_eq!(engine.get_entity_world_y(id.index()), 4.0);
    Ok(())
}

#[test]
fn children_of_a_deleted_parent_keep_their_world_position() -> Result<(), CoreError> {
    let mut engine = engine(4)?;
    let parent = engine.create_entity()?;
    let child = engine.create_entity()?;
    engine.add_entity_transform(parent.index(), 0.0, 10.0, 0.0, 1.0, 1.0);
    engine.add_entity_transform(child.index(), 0.0, 1.0, 0.0, 1.0, 1.0);
    engine.set_entity_parent(child.index(), parent.index(), false)?;
    engine.update_transforms();
    assert_eq!(engine.get_entity_world_y(child.index()), 11.0);

    let deleted = engine.delete_entity(parent.index(), parent.generation())?;
    assert_eq!(u8::from(deleted), 1);
    engine.update_transforms();
    assert_eq!(engine.get_entity_world_y(child.index()), 11.0);
    // D-220-a: the detached child's local is set to its world pose (11).
    let local_y = engine.get_entity_local_y(child.index());
    let rooted = !engine.has_entity_parent(child.index());

    engine.set_entity_local_position(child.index(), 0.0, 5.0);
    engine.update_transforms();
    assert_eq!(engine.get_entity_world_y(child.index()), 5.0);
    assert_eq!(local_y, 11.0);
    assert_eq!(u8::from(rooted), 1);
    Ok(())
}

#[test]
fn bulk_destroy_removes_the_transform_nodes_and_detaches_children() -> Result<(), CoreError> {
    let mut engine = engine(8)?;
    let spawned = engine.bulk_spawn_with_transforms(&[0.0, 0.0, 4.0, 5.0], &[0.0, 0.0])?;
    assert_eq!(spawned.len(), 2);
    assert_eq!(engine.bulk_destroy(&spawned), Ok(()));
    assert_eq!(engine.stats(), "{\"entities\":0,\"transforms\":0}");

    let family = engine.bulk_spawn_with_transforms(&[0.0, 10.0, 0.0, 1.0], &[0.0, 0.0])?;
    assert_eq!(family.len(), 2);
    let parent = family[0];
    let child = family[1];
    engine.set_entity_parent(child, parent, false)?;
    engine.update_transforms();
    assert_eq!(engine.get_entity_world_y(child), 11.0);

    assert_eq!(engine.bulk_destroy(&[parent]), Ok(()));
    engine.update_transforms();
    assert_eq!(engine.get_entity_world_y(child), 11.0);
    // Same proof as delete_entity: local becomes the kept world pose, then a root.
    let local_y = engine.get_entity_local_y(child);
    let rooted = !engine.has_entity_parent(child);
    engine.set_entity_local_position(child, 0.0, 5.0);
    engine.update_transforms();
    assert_eq!(engine.get_entity_world_y(child), 5.0);
    assert_eq!(local_y, 11.0);
    assert_eq!(u8::from(rooted), 1);
    assert_eq!(engine.stats(), "{\"entities\":1,\"transforms\":1}");
    Ok(())
}

#[test]
fn children_of_a_deleted_parent_keep_their_world_rotation() -> Result<(), CoreError> {
    let mut engine = engine(4)?;
    let parent = engine.create_entity()?;
    let child = engine.create_entity()?;
    let parent_rotation = std::f32::consts::FRAC_PI_2;
    let child_rotation = 0.3;
    engine.add_entity_transform(parent.index(), 0.0, 10.0, parent_rotation, 1.0, 1.0);
    engine.add_entity_transform(child.index(), 0.0, 1.0, child_rotation, 1.0, 1.0);
    engine.set_entity_parent(child.index(), parent.index(), false)?;
    engine.update_transforms();

    let world_x = engine.get_entity_world_x(child.index());
    let world_y = engine.get_entity_world_y(child.index());
    let world_rotation = engine.get_entity_world_rotation(child.index());

    let deleted = engine.delete_entity(parent.index(), parent.generation())?;
    assert_eq!(u8::from(deleted), 1);
    engine.update_transforms();
    assert_eq!(
        engine.get_entity_world_x(child.index()).to_bits(),
        world_x.to_bits()
    );
    assert_eq!(
        engine.get_entity_world_y(child.index()).to_bits(),
        world_y.to_bits()
    );
    let got = engine.get_entity_world_rotation(child.index());
    let expected = parent_rotation + child_rotation;
    assert_eq!(((got - expected).abs() * 100_000.0).round(), 0.0);
    assert_eq!(
        engine.get_entity_local_rotation(child.index()).to_bits(),
        world_rotation.to_bits()
    );
    Ok(())
}

#[test]
fn slot_reuse_after_delete_starts_without_a_parent() -> Result<(), CoreError> {
    let mut engine = engine(4)?;
    let parent = engine.create_entity()?;
    let child = engine.create_entity()?;
    engine.add_entity_transform(parent.index(), 0.0, 10.0, 0.0, 1.0, 1.0);
    engine.add_entity_transform(child.index(), 0.0, 1.0, 0.0, 1.0, 1.0);
    engine.set_entity_parent(child.index(), parent.index(), false)?;
    engine.update_transforms();
    assert_eq!(engine.get_entity_world_y(child.index()), 11.0);

    let deleted = engine.delete_entity(parent.index(), parent.generation())?;
    assert_eq!(u8::from(deleted), 1);
    let reused = engine.create_entity()?;
    assert_eq!(reused.index(), parent.index());
    assert_ne!(reused.generation(), parent.generation());
    engine.add_entity_transform(reused.index(), 0.0, 100.0, 0.0, 1.0, 1.0);
    engine.update_transforms();
    // World y stays 11 either way (the generation differs). has_entity_parent
    // shows the child no longer stores the deleted parent.
    assert_eq!(engine.get_entity_world_y(child.index()), 11.0);
    assert_eq!(u8::from(engine.has_entity_parent(child.index())), 0);
    Ok(())
}

#[test]
fn deleting_a_middle_node_keeps_the_grandchild_under_the_detached_child() -> Result<(), CoreError> {
    let mut engine = engine(4)?;
    let a = engine.create_entity()?;
    let b = engine.create_entity()?;
    let c = engine.create_entity()?;
    let d = engine.create_entity()?;
    engine.add_entity_transform(a.index(), 0.0, 10.0, 0.0, 1.0, 1.0);
    engine.add_entity_transform(b.index(), 0.0, 1.0, 0.0, 1.0, 1.0);
    engine.add_entity_transform(c.index(), 0.0, 1.0, 0.0, 1.0, 1.0);
    engine.add_entity_transform(d.index(), 0.0, 1.0, 0.0, 1.0, 1.0);
    engine.set_entity_parent(b.index(), a.index(), false)?;
    engine.set_entity_parent(c.index(), b.index(), false)?;
    engine.set_entity_parent(d.index(), c.index(), false)?;
    engine.update_transforms();

    let deleted = engine.delete_entity(b.index(), b.generation())?;
    assert_eq!(u8::from(deleted), 1);
    engine.update_transforms();
    assert_eq!(engine.get_entity_world_y(c.index()), 12.0);
    assert_eq!(engine.get_entity_world_y(d.index()), 13.0);
    assert_eq!(u8::from(engine.has_entity_parent(c.index())), 0);
    assert_eq!(u8::from(engine.has_entity_parent(d.index())), 1);

    engine.set_entity_local_position(c.index(), 0.0, 20.0);
    // Same local y: marks D dirty so this update reads C's world pose.
    engine.set_entity_local_position(d.index(), 0.0, 1.0);
    engine.update_transforms();
    assert_eq!(engine.get_entity_world_y(d.index()), 21.0);
    Ok(())
}

#[test]
fn zero_entities_reports_zero_transforms() -> Result<(), CoreError> {
    let engine = engine(4)?;
    assert_eq!(engine.stats(), "{\"entities\":0,\"transforms\":0}");
    Ok(())
}

#[test]
fn deleting_a_child_detaches_it_from_its_parent() -> Result<(), CoreError> {
    // `Engine` does not expose a parent's child list. `TransformSystem::children` does.
    let mut system = TransformSystem::new();
    let parent = EntityId::from_parts(0, 0);
    let child = EntityId::from_parts(1, 0);
    system.add_transform(
        parent,
        Transform::new(Vec2::new(0.0, 10.0), 0.0, Vec2::one()),
    );
    system.add_transform(child, Transform::new(Vec2::new(0.0, 1.0), 0.0, Vec2::one()));
    system.set_parent(child, Some(parent))?;
    let removed = system.remove_transform(child);
    assert_eq!(u8::from(removed.is_some()), 1);
    assert_eq!(
        system
            .get_transform(parent)
            .map(|node| node.children().len()),
        Some(0)
    );
    Ok(())
}
