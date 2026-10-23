//! Native checks for the invariants named in `crates/gwen-core/UNSAFE.md`.

use gwen_core::bindings::Engine;
use gwen_core::{CoreError, TRANSFORM_STRIDE};

/// Frees every non-zero buffer it allocated, including when the test panics.
struct SharedGuard<'a> {
    engine: &'a mut Engine,
    live: Vec<(usize, usize)>,
}

impl<'a> SharedGuard<'a> {
    fn new(engine: &'a mut Engine) -> Self {
        Self {
            engine,
            live: Vec::new(),
        }
    }

    fn alloc(&mut self, len: usize) -> usize {
        let ptr = self.engine.alloc_shared_buffer(len);
        if ptr != 0 {
            self.live.push((ptr, len));
        }
        ptr
    }

    fn engine(&mut self) -> &mut Engine {
        self.engine
    }
}

impl Drop for SharedGuard<'_> {
    fn drop(&mut self) {
        for (ptr, len) in self.live.drain(..) {
            if ptr == 0 {
                continue;
            }
            let _ = self.engine.free_shared_buffer(ptr, len);
        }
    }
}

#[test]
fn unsafe_site_u002_second_free_is_invalid() {
    let mut engine = Engine::new(1).unwrap_or_else(|err| {
        assert_eq!("", err.code());
        std::process::abort();
    });
    let mut buffers = SharedGuard::new(&mut engine);
    let ptr = buffers.alloc(8);
    assert_ne!(ptr, 0);
    assert_eq!(buffers.engine().free_shared_buffer(ptr, 8), Ok(()));
    assert_eq!(
        buffers.engine().free_shared_buffer(ptr, 8),
        Err(CoreError::InvalidSharedBuffer { ptr, len: 0 })
    );
}

#[test]
fn unsafe_site_u003_short_sync_is_invalid() {
    let mut engine = Engine::new(4).unwrap_or_else(|err| {
        assert_eq!("", err.code());
        std::process::abort();
    });
    let mut buffers = SharedGuard::new(&mut engine);
    let ptr = buffers.alloc(TRANSFORM_STRIDE);
    assert_ne!(ptr, 0);
    assert_eq!(buffers.engine().sync_transforms_to_buffer(ptr, 1), Ok(()));
    assert_eq!(
        buffers.engine().sync_transforms_to_buffer(ptr, 2),
        Err(CoreError::InvalidSharedBuffer {
            ptr,
            len: TRANSFORM_STRIDE,
        })
    );
}

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
#[cfg_attr(
    miri,
    ignore = "x86_64: Miri cannot execute `llvm.x86.sse.stmxcsr` inside Rapier's `flush_denormal_to_zero`. aarch64 Stacked Borrows: `trying to retag ... Unique ... does not exist in the borrow stack` at rapier2d-0.22.0/src/utils.rs:632 (`IndexMut2::index_mut2`). issue #184"
)]
#[test]
fn unsafe_site_u005_step_records_a_collision() -> Result<(), gwen_core::physics2d::Physics2DError> {
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
#[cfg_attr(
    miri,
    ignore = "x86_64: Miri cannot execute `llvm.x86.sse.stmxcsr` inside Rapier's `flush_denormal_to_zero`. aarch64 Stacked Borrows: `trying to retag ... Unique ... does not exist in the borrow stack` at rapier2d-0.22.0/src/utils.rs:632 (`IndexMut2::index_mut2`). issue #184"
)]
#[test]
fn unsafe_site_u006_two_worlds_do_not_share_events(
) -> Result<(), gwen_core::physics2d::Physics2DError> {
    let mut crowded = overlapping_pair()?;
    let mut quiet = separated_pair()?;
    crowded.step(1.0 / 60.0)?;
    quiet.step(1.0 / 60.0)?;
    assert_ne!(crowded.collision_event_count(), 0);
    assert_eq!(quiet.collision_event_count(), 0);
    assert_ne!(crowded.collision_events_ptr(), quiet.collision_events_ptr());
    Ok(())
}

#[cfg(feature = "physics2d")]
#[cfg_attr(
    miri,
    ignore = "x86_64: Miri cannot execute `llvm.x86.sse.stmxcsr` inside Rapier's `flush_denormal_to_zero`. aarch64 Stacked Borrows: `trying to retag ... Unique ... does not exist in the borrow stack` at rapier2d-0.22.0/src/utils.rs:632 (`IndexMut2::index_mut2`). issue #184"
)]
#[test]
fn unsafe_site_u007_event_buffer_fills_then_clears(
) -> Result<(), gwen_core::physics2d::Physics2DError> {
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

#[cfg(feature = "physics2d")]
#[test]
fn unsafe_site_u008_path_caps_at_max_nodes() -> Result<(), gwen_core::physics2d::Physics2DError> {
    use gwen_core::physics2d::{find_path_2d, get_path_buffer_ptr, MAX_PATH_NODES};

    let count = find_path_2d(0.0, 0.0, 255.0, 0.0)?;
    assert_eq!(count, MAX_PATH_NODES);
    // SAFETY: `find_path_2d` just wrote `MAX_PATH_NODES` nodes and this read is the last one.
    let last = unsafe { *get_path_buffer_ptr().add(MAX_PATH_NODES - 1) };
    assert_eq!(last.x, 255.0);
    assert_eq!(last.y, 0.0);
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
#[cfg_attr(
    miri,
    ignore = "x86_64: Miri cannot execute `llvm.x86.sse.stmxcsr` inside Rapier's `flush_denormal_to_zero`. aarch64 Stacked Borrows: `trying to retag ... Unique ... does not exist in the borrow stack` at rapier2d-0.22.0/src/utils.rs:632 (`IndexMut2::index_mut2`). issue #184"
)]
#[test]
fn unsafe_site_u010_step_records_a_collision() -> Result<(), gwen_core::physics3d::Physics3DError> {
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
#[cfg_attr(
    miri,
    ignore = "x86_64: Miri cannot execute `llvm.x86.sse.stmxcsr` inside Rapier's `flush_denormal_to_zero`. aarch64 Stacked Borrows: `trying to retag ... Unique ... does not exist in the borrow stack` at rapier2d-0.22.0/src/utils.rs:632 (`IndexMut2::index_mut2`). issue #184"
)]
#[test]
fn unsafe_site_u011_two_worlds_do_not_share_events(
) -> Result<(), gwen_core::physics3d::Physics3DError> {
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
#[cfg_attr(
    miri,
    ignore = "x86_64: Miri cannot execute `llvm.x86.sse.stmxcsr` inside Rapier's `flush_denormal_to_zero`. aarch64 Stacked Borrows: `trying to retag ... Unique ... does not exist in the borrow stack` at rapier2d-0.22.0/src/utils.rs:632 (`IndexMut2::index_mut2`). issue #184"
)]
#[test]
fn unsafe_site_u012_event_buffer_fills_then_clears(
) -> Result<(), gwen_core::physics3d::Physics3DError> {
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

#[cfg(feature = "physics3d")]
#[cfg_attr(
    miri,
    ignore = "x86_64: Miri cannot execute `llvm.x86.sse.stmxcsr` inside Rapier's `flush_denormal_to_zero`. aarch64 Stacked Borrows: `trying to retag ... Unique ... does not exist in the borrow stack` at rapier2d-0.22.0/src/utils.rs:632 (`IndexMut2::index_mut2`). issue #184"
)]
#[test]
fn unsafe_site_u013_overlap_writes_the_entity() -> Result<(), gwen_core::physics3d::Physics3DError>
{
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
fn body_without_collider_writes_no_hit() {
    use gwen_core::physics3d::PhysicsWorld3D;

    let mut world = PhysicsWorld3D::new(0.0, 0.0, 0.0);
    assert_eq!(
        u8::from(world.add_body(5, 0.0, 1.0, 0.0, 2, 1.0, 0.0, 0.0)),
        1
    );
    assert_eq!(
        world.add_character_controller(5, 0.0, 45.0, 0.0, 0.0, false, false),
        Ok(0)
    );
    assert_eq!(
        world.character_controller_move(5, 0.0, -1.0, 0.0, 1.0 / 60.0),
        Ok(())
    );
    assert_eq!(cc_slot_bits(&world), no_hit_bits());
}

#[cfg(feature = "physics3d")]
#[cfg_attr(
    miri,
    ignore = "x86_64: Miri cannot execute `llvm.x86.sse.stmxcsr` inside Rapier's `flush_denormal_to_zero`. aarch64 Stacked Borrows: `trying to retag ... Unique ... does not exist in the borrow stack` at rapier2d-0.22.0/src/utils.rs:632 (`IndexMut2::index_mut2`). issue #184"
)]
#[test]
fn unsafe_site_u022_grounded_move_writes_contact(
) -> Result<(), gwen_core::physics3d::Physics3DError> {
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
#[cfg_attr(
    miri,
    ignore = "x86_64: Miri cannot execute `llvm.x86.sse.stmxcsr` inside Rapier's `flush_denormal_to_zero`. aarch64 Stacked Borrows: `trying to retag ... Unique ... does not exist in the borrow stack` at rapier2d-0.22.0/src/utils.rs:632 (`IndexMut2::index_mut2`). issue #184"
)]
#[test]
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
