//! The collision event buffer fills to its cap and clears after the bodies are removed.
//!
//! Native only by design: 46 bodies make the step too slow under Miri, so `rust-miri-step` does
//! not run this file. Run with `--features physics3d`.

#![cfg(feature = "physics3d")]

fn add_dynamic_box(world: &mut gwen_core::physics3d::PhysicsWorld3D, entity: u32, x: f32) {
    assert_eq!(
        u8::from(world.add_body(entity, x, 0.0, 0.0, 1, 1.0, 0.0, 0.0)),
        1
    );
    assert_eq!(
        world.add_box_collider(
            entity,
            0.5,
            0.5,
            0.5,
            0.0,
            0.0,
            0.0,
            false,
            0.5,
            0.0,
            0xFFFF_FFFF,
            0xFFFF_FFFF,
            entity,
        ),
        Ok(())
    );
}

#[test]
fn event_buffer_fills_then_clears_3d() -> Result<(), gwen_core::physics3d::Physics3DError> {
    use gwen_core::physics3d::events::MAX_COLLISION_EVENTS_3D;
    use gwen_core::physics3d::PhysicsWorld3D;

    let mut world = PhysicsWorld3D::new(0.0, 0.0, 0.0);
    for entity in 0..46 {
        add_dynamic_box(&mut world, entity, 0.0);
    }
    world.step(1.0 / 60.0)?;
    if world.get_collision_event_count() == 0 {
        world.step(1.0 / 60.0)?;
    }
    assert_eq!(
        world.get_collision_event_count(),
        MAX_COLLISION_EVENTS_3D as u32
    );
    for entity in 0..46 {
        assert_eq!(u8::from(world.remove_body(entity)), 1);
    }
    world.step(1.0 / 60.0)?;
    assert_eq!(world.get_collision_event_count(), 0);

    Ok(())
}
