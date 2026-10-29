//! Two physics worlds built the same way iterate their public maps in the same order.
//!
//! Native only. Run with `--features physics2d`. Each test owns its worlds and
//! drops them when the function returns.

#![cfg(feature = "physics2d")]

use gwen_core::physics2d::{BodyOptions, BodyType, ColliderOptions, Physics2DError, PhysicsWorld};

const BODIES: u32 = 64;

fn world_with_bodies() -> Result<PhysicsWorld, Physics2DError> {
    let mut world = PhysicsWorld::new(0.0, 0.0);
    for slot in 0..BODIES {
        world.add_rigid_body(
            slot,
            slot as f32,
            0.0,
            BodyType::Fixed,
            BodyOptions::default(),
        )?;
    }
    Ok(world)
}

fn one_way_box() -> ColliderOptions {
    ColliderOptions {
        is_one_way: true,
        ..ColliderOptions::default()
    }
}

fn world_with_one_way_colliders() -> Result<PhysicsWorld, Physics2DError> {
    let mut world = PhysicsWorld::new(0.0, 0.0);
    for slot in 0..BODIES {
        let raw = world.add_rigid_body(
            slot,
            slot as f32,
            0.0,
            BodyType::Fixed,
            BodyOptions::default(),
        )?;
        world.add_box_collider(raw, 0.5, 0.5, one_way_box())?;
    }
    Ok(world)
}

#[test]
fn two_physics2d_worlds_iterate_entity_to_body_in_the_same_order() -> Result<(), Physics2DError> {
    let world_a = world_with_bodies()?;
    let world_b = world_with_bodies()?;
    let keys_a: Vec<u32> = world_a.entity_to_body.keys().copied().collect();
    let keys_b: Vec<u32> = world_b.entity_to_body.keys().copied().collect();
    assert_eq!(keys_a.len(), BODIES as usize);
    assert_eq!(keys_a, keys_b);
    Ok(())
}

#[test]
fn two_physics2d_worlds_iterate_body_to_entity_and_one_way_colliders_in_the_same_order(
) -> Result<(), Physics2DError> {
    let world_a = world_with_one_way_colliders()?;
    let world_b = world_with_one_way_colliders()?;
    let bodies_a: Vec<_> = world_a.body_to_entity.keys().copied().collect();
    let bodies_b: Vec<_> = world_b.body_to_entity.keys().copied().collect();
    assert_eq!(bodies_a.len(), BODIES as usize);
    assert_eq!(bodies_a, bodies_b);
    let one_way_a: Vec<_> = world_a.one_way_colliders.iter().copied().collect();
    let one_way_b: Vec<_> = world_b.one_way_colliders.iter().copied().collect();
    assert_eq!(one_way_a.len(), BODIES as usize);
    assert_eq!(one_way_a, one_way_b);
    Ok(())
}
