//! The collision event buffer fills to its cap and clears after the bodies are removed.
//!
//! Native only by design: 46 bodies make the step too slow under Miri, so `rust-miri-step` does
//! not run this file. Run with `--features physics2d`.

#![cfg(feature = "physics2d")]

#[test]
fn event_buffer_fills_then_clears_2d() -> Result<(), gwen_core::physics2d::Physics2DError> {
    use gwen_core::physics2d::{
        BodyOptions, BodyType, ColliderOptions, PhysicsWorld, MAX_COLLISION_EVENTS,
    };

    let mut world = PhysicsWorld::new(0.0, 0.0);
    for entity in 0..46 {
        let handle =
            world.add_rigid_body(entity, 0.0, 0.0, BodyType::Dynamic, BodyOptions::default())?;
        world.add_box_collider(handle, 0.5, 0.5, ColliderOptions::default())?;
    }
    world.step(1.0 / 60.0)?;
    assert_eq!(world.collision_event_count(), MAX_COLLISION_EVENTS as u32);
    for entity in 0..46 {
        world.remove_rigid_body(entity);
    }
    world.step(1.0 / 60.0)?;
    assert_eq!(world.collision_event_count(), 0);
    Ok(())
}
