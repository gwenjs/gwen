//! Native checks for the invariants named in `crates/gwen-core/UNSAFE.md`.

use gwen_core::bindings::Engine;
use gwen_core::{CoreError, TRANSFORM_STRIDE};

#[test]
fn unsafe_site_u001_alloc_is_8_byte_aligned() {
    let mut engine = match Engine::new(1) {
        Ok(engine) => engine,
        Err(err) => {
            assert_eq!(err.code(), "created");
            return;
        }
    };
    let ptr = engine.alloc_shared_buffer(1);
    assert_ne!(ptr, 0);
    assert_eq!(ptr % 8, 0);
    assert_eq!(engine.free_shared_buffer(ptr, 1), Ok(()));
}

#[test]
fn unsafe_site_u002_second_free_is_invalid() {
    let mut engine = match Engine::new(1) {
        Ok(engine) => engine,
        Err(err) => {
            assert_eq!(err.code(), "created");
            return;
        }
    };
    let ptr = engine.alloc_shared_buffer(8);
    assert_ne!(ptr, 0);
    assert_eq!(engine.free_shared_buffer(ptr, 8), Ok(()));
    assert_eq!(
        engine.free_shared_buffer(ptr, 8),
        Err(CoreError::InvalidSharedBuffer { ptr, len: 0 })
    );
}

#[test]
fn unsafe_site_u003_short_sync_is_invalid() {
    let mut engine = match Engine::new(4) {
        Ok(engine) => engine,
        Err(err) => {
            assert_eq!(err.code(), "created");
            return;
        }
    };
    let ptr = engine.alloc_shared_buffer(TRANSFORM_STRIDE);
    assert_ne!(ptr, 0);
    assert_eq!(engine.sync_transforms_to_buffer(ptr, 1), Ok(()));
    assert_eq!(
        engine.sync_transforms_to_buffer(ptr, 2),
        Err(CoreError::InvalidSharedBuffer {
            ptr,
            len: TRANSFORM_STRIDE,
        })
    );
}

#[cfg(feature = "physics2d")]
#[test]
fn unsafe_site_u007_event_buffer_fills_then_clears() {
    use gwen_core::physics2d::{CollisionEventBuffer, PhysicsCollisionEvent, MAX_COLLISION_EVENTS};

    let mut buffer = CollisionEventBuffer::new();
    for index in 0..MAX_COLLISION_EVENTS + 1 {
        buffer.push(PhysicsCollisionEvent {
            entity_a: index as u32,
            entity_b: 1,
            collider_a_id: 0,
            collider_b_id: 0,
            flags: 1,
        });
    }
    assert_eq!(buffer.len(), MAX_COLLISION_EVENTS);
    // SAFETY: `as_ptr` points at `MAX_COLLISION_EVENTS` slots and index 0 is inside that array.
    let first = unsafe { *buffer.as_ptr() };
    // SAFETY: `MAX_COLLISION_EVENTS - 1` is the last slot of that same array.
    let last = unsafe { *buffer.as_ptr().add(MAX_COLLISION_EVENTS - 1) };
    assert_eq!(first.entity_a, 0);
    assert_eq!(last.entity_a, (MAX_COLLISION_EVENTS - 1) as u32);
    buffer.clear();
    assert_eq!(buffer.len(), 0);
}

#[cfg(feature = "physics2d")]
#[test]
fn unsafe_site_u008_path_caps_at_max_nodes() {
    use gwen_core::physics2d::{find_path_2d, get_path_buffer_ptr, MAX_PATH_NODES};

    let count = find_path_2d(0.0, 0.0, 300.0, 0.0);
    assert_eq!(count, MAX_PATH_NODES);
    // SAFETY: `find_path_2d` just wrote `MAX_PATH_NODES` nodes and this read is the last one.
    let last = unsafe { *get_path_buffer_ptr().add(MAX_PATH_NODES - 1) };
    assert_eq!(last.x, 255.0);
    assert_eq!(last.y, 0.0);
}

#[cfg(feature = "physics3d")]
#[test]
fn unsafe_site_u012_event_buffer_fills_then_clears() {
    use gwen_core::physics3d::events::{
        CollisionEventBuffer3D, PhysicsCollisionEvent3D, MAX_COLLISION_EVENTS_3D,
    };

    let mut buffer = CollisionEventBuffer3D::new();
    for index in 0..MAX_COLLISION_EVENTS_3D + 1 {
        buffer.push(PhysicsCollisionEvent3D {
            entity_a: index as u32,
            entity_b: 1,
            flags: 1,
            collider_a_id: 0,
            collider_b_id: 0,
        });
    }
    assert_eq!(buffer.len(), MAX_COLLISION_EVENTS_3D);
    assert_eq!(buffer.get(0).entity_a, 0);
    assert_eq!(
        buffer.get(MAX_COLLISION_EVENTS_3D - 1).entity_a,
        (MAX_COLLISION_EVENTS_3D - 1) as u32
    );
    buffer.clear();
    assert_eq!(buffer.len(), 0);
}
