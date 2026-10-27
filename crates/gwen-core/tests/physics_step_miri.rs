//! Physics step tests that run under Miri as well as natively.
//!
//! Each test steps a world and then reads what the step wrote through a raw pointer or a slot.
//! `rust-miri-step` runs this file under Miri with Tree Borrows on aarch64 (`ci.yml`): once with
//! `--features physics2d` for the 2D tests, once with `--features physics3d` for the 3D ones.
//! Natively: `cargo test -p gwen-core --features physics2d --test physics_step_miri`, and the same
//! with `physics3d`. Without a physics feature this file holds no test.

#[cfg(feature = "physics2d")]
fn overlapping_pair(
) -> Result<gwen_core::physics2d::PhysicsWorld, gwen_core::physics2d::Physics2DError> {
    use gwen_core::physics2d::{BodyOptions, BodyType, ColliderOptions, PhysicsWorld};

    let mut world = PhysicsWorld::new(0.0, 0.0);
    let left = world.add_rigid_body(1, 0.0, 0.0, BodyType::Dynamic, BodyOptions::default())?;
    world.add_box_collider(left, 0.5, 0.5, ColliderOptions::default())?;
    let right = world.add_rigid_body(2, 0.2, 0.0, BodyType::Dynamic, BodyOptions::default())?;
    world.add_box_collider(right, 0.5, 0.5, ColliderOptions::default())?;
    Ok(world)
}

#[cfg(feature = "physics2d")]
fn separated_pair(
) -> Result<gwen_core::physics2d::PhysicsWorld, gwen_core::physics2d::Physics2DError> {
    use gwen_core::physics2d::{BodyOptions, BodyType, ColliderOptions, PhysicsWorld};

    let mut world = PhysicsWorld::new(0.0, 0.0);
    let left = world.add_rigid_body(1, 0.0, 0.0, BodyType::Dynamic, BodyOptions::default())?;
    world.add_box_collider(left, 0.5, 0.5, ColliderOptions::default())?;
    let right = world.add_rigid_body(2, 50.0, 0.0, BodyType::Dynamic, BodyOptions::default())?;
    world.add_box_collider(right, 0.5, 0.5, ColliderOptions::default())?;
    Ok(world)
}

#[cfg(feature = "physics2d")]
#[test]
#[cfg_attr(
    all(miri, not(target_arch = "x86_64")),
    ignore = "aarch64 Miri: llvm.aarch64.neon.fmaxnm.v4f32 (wide 1.7.1 src/f32x4_.rs:668 vmaxnmq_f32) and inline assembly prfm pldl1keep in rapier2d-0.36.1 and rapier3d-0.36.1 src/utils/prefetch.rs:24 (inline assembly is not supported)"
)]
fn step_records_a_collision_2d() -> Result<(), gwen_core::physics2d::Physics2DError> {
    use gwen_core::physics2d::PhysicsCollisionEvent;

    let mut world = overlapping_pair()?;
    world.step(1.0 / 60.0)?;
    assert_ne!(world.collision_event_count(), 0);
    // SAFETY: `step` just wrote at least one event at the start of this world's buffer.
    let event = unsafe { *world.collision_events_ptr() };
    let event: PhysicsCollisionEvent = event;
    let mut pair = [event.entity_a, event.entity_b];
    pair.sort_unstable();
    assert_eq!(pair, [1, 2]);
    Ok(())
}

#[cfg(feature = "physics2d")]
#[test]
#[cfg_attr(
    all(miri, not(target_arch = "x86_64")),
    ignore = "aarch64 Miri: llvm.aarch64.neon.fmaxnm.v4f32 (wide 1.7.1 src/f32x4_.rs:668 vmaxnmq_f32) and inline assembly prfm pldl1keep in rapier2d-0.36.1 and rapier3d-0.36.1 src/utils/prefetch.rs:24 (inline assembly is not supported)"
)]
fn two_worlds_do_not_share_events_2d() -> Result<(), gwen_core::physics2d::Physics2DError> {
    let mut crowded = overlapping_pair()?;
    let mut quiet = separated_pair()?;
    crowded.step(1.0 / 60.0)?;
    quiet.step(1.0 / 60.0)?;
    assert_ne!(crowded.collision_event_count(), 0);
    assert_eq!(quiet.collision_event_count(), 0);
    assert_ne!(crowded.collision_events_ptr(), quiet.collision_events_ptr());
    Ok(())
}

#[cfg(feature = "physics3d")]
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

#[cfg(feature = "physics3d")]
fn overlapping_pair_3d() -> gwen_core::physics3d::PhysicsWorld3D {
    use gwen_core::physics3d::PhysicsWorld3D;

    let mut world = PhysicsWorld3D::new(0.0, 0.0, 0.0);
    add_dynamic_box(&mut world, 1, 0.0);
    add_dynamic_box(&mut world, 2, 0.2);
    world
}

#[cfg(feature = "physics3d")]
fn separated_pair_3d() -> gwen_core::physics3d::PhysicsWorld3D {
    use gwen_core::physics3d::PhysicsWorld3D;

    let mut world = PhysicsWorld3D::new(0.0, 0.0, 0.0);
    add_dynamic_box(&mut world, 1, 0.0);
    add_dynamic_box(&mut world, 2, 50.0);
    world
}

#[cfg(feature = "physics3d")]
fn first_pair_3d(world: &gwen_core::physics3d::PhysicsWorld3D) -> [u32; 2] {
    use gwen_core::physics3d::PhysicsCollisionEvent3D;

    // SAFETY: `step` just wrote at least one event at the start of this world's buffer.
    let event = unsafe { *(world.get_collision_events_ptr() as *const PhysicsCollisionEvent3D) };
    let mut pair = [event.entity_a, event.entity_b];
    pair.sort_unstable();
    pair
}

#[cfg(feature = "physics3d")]
#[test]
#[cfg_attr(
    all(miri, not(target_arch = "x86_64")),
    ignore = "aarch64 Miri: llvm.aarch64.neon.fmaxnm.v4f32 (wide 1.7.1 src/f32x4_.rs:668 vmaxnmq_f32) and inline assembly prfm pldl1keep in rapier2d-0.36.1 and rapier3d-0.36.1 src/utils/prefetch.rs:24 (inline assembly is not supported)"
)]
fn step_records_a_collision_3d() -> Result<(), gwen_core::physics3d::Physics3DError> {
    let mut world = overlapping_pair_3d();
    world.step(1.0 / 60.0)?;
    if world.get_collision_event_count() == 0 {
        world.step(1.0 / 60.0)?;
    }
    assert_ne!(world.get_collision_event_count(), 0);
    assert_eq!(first_pair_3d(&world), [1, 2]);

    Ok(())
}

#[cfg(feature = "physics3d")]
#[test]
#[cfg_attr(
    all(miri, not(target_arch = "x86_64")),
    ignore = "aarch64 Miri: llvm.aarch64.neon.fmaxnm.v4f32 (wide 1.7.1 src/f32x4_.rs:668 vmaxnmq_f32) and inline assembly prfm pldl1keep in rapier2d-0.36.1 and rapier3d-0.36.1 src/utils/prefetch.rs:24 (inline assembly is not supported)"
)]
fn two_worlds_do_not_share_events_3d() -> Result<(), gwen_core::physics3d::Physics3DError> {
    let mut crowded = overlapping_pair_3d();
    let mut quiet = separated_pair_3d();
    crowded.step(1.0 / 60.0)?;
    if crowded.get_collision_event_count() == 0 {
        crowded.step(1.0 / 60.0)?;
    }
    quiet.step(1.0 / 60.0)?;
    assert_ne!(crowded.get_collision_event_count(), 0);
    assert_eq!(quiet.get_collision_event_count(), 0);
    assert_ne!(
        crowded.get_collision_events_ptr(),
        quiet.get_collision_events_ptr()
    );
    Ok(())
}

#[cfg(feature = "physics3d")]
#[test]
#[cfg_attr(
    all(miri, not(target_arch = "x86_64")),
    ignore = "aarch64 Miri: llvm.aarch64.neon.fmaxnm.v4f32 (wide 1.7.1 src/f32x4_.rs:668 vmaxnmq_f32) and inline assembly prfm pldl1keep in rapier2d-0.36.1 and rapier3d-0.36.1 src/utils/prefetch.rs:24 (inline assembly is not supported)"
)]
fn overlap_after_step_writes_the_entity() -> Result<(), gwen_core::physics3d::Physics3DError> {
    use gwen_core::physics3d::PhysicsWorld3D;

    let mut world = PhysicsWorld3D::new(0.0, 0.0, 0.0);
    add_dynamic_box(&mut world, 4, 0.0);
    world.step(1.0 / 60.0)?;
    let mut buf = [0u32; 16];
    let count = world.overlap_shape(
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        1.0,
        0,
        0.5,
        0.5,
        0.5,
        0xFFFF_FFFF,
        0xFFFF_FFFF,
        &mut buf,
    );
    assert_eq!(count, 1);
    assert_eq!(buf[0], 4);

    Ok(())
}

#[cfg(feature = "physics3d")]
fn cc_slot_bits(world: &gwen_core::physics3d::PhysicsWorld3D) -> [u32; 5] {
    let mut slot = [0f32; 5];
    // SAFETY: slot 0 is the first five floats of this world's character-controller state.
    unsafe {
        std::ptr::copy_nonoverlapping(world.cc_state_ptr(), slot.as_mut_ptr(), 5);
    }
    slot.map(f32::to_bits)
}

#[cfg(feature = "physics3d")]
fn no_hit_bits() -> [u32; 5] {
    [
        0.0f32.to_bits(),
        0.0f32.to_bits(),
        1.0f32.to_bits(),
        0.0f32.to_bits(),
        u32::MAX,
    ]
}

#[cfg(feature = "physics3d")]
#[test]
#[cfg_attr(
    all(miri, not(target_arch = "x86_64")),
    ignore = "aarch64 Miri: llvm.aarch64.neon.fmaxnm.v4f32 (wide 1.7.1 src/f32x4_.rs:668 vmaxnmq_f32) and inline assembly prfm pldl1keep in rapier2d-0.36.1 and rapier3d-0.36.1 src/utils/prefetch.rs:24 (inline assembly is not supported)"
)]
fn grounded_move_writes_contact() -> Result<(), gwen_core::physics3d::Physics3DError> {
    use gwen_core::physics3d::PhysicsWorld3D;

    let mut world = PhysicsWorld3D::new(0.0, 0.0, 0.0);
    assert_eq!(
        u8::from(world.add_body(1, 0.0, -0.5, 0.0, 0, 0.0, 0.0, 0.0)),
        1
    );
    assert_eq!(
        world.add_box_collider(
            1,
            8.0,
            0.5,
            8.0,
            0.0,
            0.0,
            0.0,
            false,
            0.5,
            0.0,
            0xFFFF_FFFF,
            0xFFFF_FFFF,
            1,
        ),
        Ok(())
    );
    assert_eq!(
        u8::from(world.add_body(0, 0.0, 0.5, 0.0, 2, 1.0, 0.0, 0.0)),
        1
    );
    assert_eq!(
        world.add_box_collider(
            0,
            0.3,
            0.4,
            0.3,
            0.0,
            0.0,
            0.0,
            false,
            0.5,
            0.0,
            0xFFFF_FFFF,
            0xFFFF_FFFF,
            2,
        ),
        Ok(())
    );
    assert_eq!(
        world.add_character_controller(0, 0.3, 50.0, 0.01, 0.5, true, false),
        Ok(0)
    );
    world.step(1.0 / 60.0)?;
    assert_eq!(
        world.character_controller_move(0, 0.0, -20.0, 0.0, 1.0 / 60.0),
        Ok(())
    );
    let slot = cc_slot_bits(&world);
    assert_eq!(slot[0], 1.0f32.to_bits());
    assert_eq!(slot[1], 0.0f32.to_bits());
    assert_eq!(slot[2], (-1.0f32).to_bits());
    assert_eq!(slot[3], 0.0f32.to_bits());
    // Floor collider is parented to body 1, so the slot stores that entity index.
    assert_eq!(slot[4], 1);

    Ok(())
}

#[cfg(feature = "physics3d")]
#[test]
#[cfg_attr(
    all(miri, not(target_arch = "x86_64")),
    ignore = "aarch64 Miri: llvm.aarch64.neon.fmaxnm.v4f32 (wide 1.7.1 src/f32x4_.rs:668 vmaxnmq_f32) and inline assembly prfm pldl1keep in rapier2d-0.36.1 and rapier3d-0.36.1 src/utils/prefetch.rs:24 (inline assembly is not supported)"
)]
fn air_move_writes_no_hit() -> Result<(), gwen_core::physics3d::Physics3DError> {
    use gwen_core::physics3d::PhysicsWorld3D;

    let mut world = PhysicsWorld3D::new(0.0, 0.0, 0.0);
    assert_eq!(
        u8::from(world.add_body(0, 0.0, 2.0, 0.0, 2, 1.0, 0.0, 0.0)),
        1
    );
    assert_eq!(
        world.add_box_collider(
            0,
            0.3,
            0.5,
            0.3,
            0.0,
            0.0,
            0.0,
            false,
            0.5,
            0.0,
            0xFFFF_FFFF,
            0xFFFF_FFFF,
            2,
        ),
        Ok(())
    );
    assert_eq!(
        world.add_character_controller(0, 0.2, 45.0, 0.02, 0.0, false, false),
        Ok(0)
    );
    world.step(1.0 / 60.0)?;
    assert_eq!(
        world.character_controller_move(0, 0.0, 1.0, 0.0, 1.0 / 60.0),
        Ok(())
    );
    assert_eq!(cc_slot_bits(&world), no_hit_bits());

    Ok(())
}
