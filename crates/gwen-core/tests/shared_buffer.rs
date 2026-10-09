#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::unreachable,
    clippy::todo,
    clippy::unimplemented,
    reason = "test-only code"
)]
//! World transforms packed into a live `alloc_shared_buffer` allocation.

use gwen_core::bindings::Engine;
use gwen_core::{CoreError, TRANSFORM_STRIDE};

fn read_f32(ptr: usize, offset: usize) -> f32 {
    let mut bytes = [0u8; 4];
    // SAFETY: `ptr + offset` addresses 4 live bytes inside the shared buffer.
    unsafe {
        std::ptr::copy_nonoverlapping((ptr + offset) as *const u8, bytes.as_mut_ptr(), 4);
    }
    f32::from_le_bytes(bytes)
}

fn read_u32(ptr: usize, offset: usize) -> u32 {
    let mut bytes = [0u8; 4];
    // SAFETY: `ptr + offset` addresses 4 live bytes inside the shared buffer.
    unsafe {
        std::ptr::copy_nonoverlapping((ptr + offset) as *const u8, bytes.as_mut_ptr(), 4);
    }
    u32::from_le_bytes(bytes)
}

fn slot_bytes(ptr: usize, index: usize) -> [u8; TRANSFORM_STRIDE] {
    let mut bytes = [0u8; TRANSFORM_STRIDE];
    // SAFETY: `ptr + index * TRANSFORM_STRIDE` addresses one live transform slot.
    unsafe {
        std::ptr::copy_nonoverlapping(
            (ptr + index * TRANSFORM_STRIDE) as *const u8,
            bytes.as_mut_ptr(),
            TRANSFORM_STRIDE,
        );
    }
    bytes
}

#[test]
fn packed_values_match_world_transforms_including_a_parented_child() {
    let mut engine = match Engine::new(4) {
        Ok(engine) => engine,
        Err(err) => {
            assert_eq!(err.code(), "created");
            return;
        }
    };
    let parent = match engine.create_entity() {
        Ok(id) => id,
        Err(err) => {
            assert_eq!(err.code(), "created");
            return;
        }
    };
    let child = match engine.create_entity() {
        Ok(id) => id,
        Err(err) => {
            assert_eq!(err.code(), "created");
            return;
        }
    };
    assert_eq!(parent.index(), 0);
    assert_eq!(child.index(), 1);
    engine.add_entity_transform(parent.index(), 10.0, 0.0, 0.0, 2.0, 2.0);
    engine.add_entity_transform(child.index(), 3.0, 4.0, 0.0, 1.0, 1.0);
    match engine.set_entity_parent(child.index(), parent.index(), false) {
        Ok(()) => {}
        Err(err) => {
            assert_eq!(err.code(), "linked");
            return;
        }
    }
    engine.set_entity_local_position(child.index(), 3.0, 4.0);

    let ptr = engine.alloc_shared_buffer(4 * TRANSFORM_STRIDE);
    match engine.sync_transforms_to_buffer(ptr, 4) {
        Ok(()) => {}
        Err(err) => {
            assert_eq!(err.code(), "synced");
            return;
        }
    }

    assert_eq!(
        read_f32(ptr, 0).to_bits(),
        engine.get_entity_world_x(0).to_bits()
    );
    assert_eq!(
        read_f32(ptr, 4).to_bits(),
        engine.get_entity_world_y(0).to_bits()
    );
    assert_eq!(
        read_f32(ptr, 8).to_bits(),
        engine.get_entity_world_rotation(0).to_bits()
    );
    assert_eq!(read_f32(ptr, 12).to_bits(), 2.0f32.to_bits());
    assert_eq!(read_f32(ptr, 16).to_bits(), 2.0f32.to_bits());
    assert_eq!(read_f32(ptr, 32).to_bits(), 16.0f32.to_bits());
    assert_eq!(read_f32(ptr, 36).to_bits(), 8.0f32.to_bits());
    assert_eq!(read_f32(ptr, 44).to_bits(), 2.0f32.to_bits());
    assert_eq!(read_f32(ptr, 48).to_bits(), 2.0f32.to_bits());
    assert_eq!(
        read_f32(ptr, 32).to_bits(),
        engine.get_entity_world_x(1).to_bits()
    );
    assert_eq!(
        read_f32(ptr, 36).to_bits(),
        engine.get_entity_world_y(1).to_bits()
    );
    assert_eq!(read_u32(ptr, 20) & 1, 1);
    assert_eq!(read_u32(ptr, 20) & !1, 0);
    assert_eq!(read_u32(ptr, 32 + 20) & 1, 1);
    assert_eq!(slot_bytes(ptr, 2), [0u8; TRANSFORM_STRIDE]);
    assert_eq!(slot_bytes(ptr, 3), [0u8; TRANSFORM_STRIDE]);
}

#[test]
fn unknown_or_short_buffer_is_invalid_shared_buffer() {
    let mut engine = match Engine::new(4) {
        Ok(engine) => engine,
        Err(err) => {
            assert_eq!(err.code(), "created");
            return;
        }
    };
    let unknown = match engine.sync_transforms_to_buffer(0x1000, 1) {
        Err(err) => err,
        Ok(()) => {
            assert_eq!("ok", "CORE:INVALID_SHARED_BUFFER");
            return;
        }
    };
    assert_eq!(
        unknown,
        CoreError::InvalidSharedBuffer {
            ptr: 0x1000,
            len: 0
        }
    );
    assert_eq!(unknown.code(), "CORE:INVALID_SHARED_BUFFER");

    let short = engine.alloc_shared_buffer(16);
    let short_err = match engine.sync_transforms_to_buffer(short, 1) {
        Err(err) => err,
        Ok(()) => {
            assert_eq!("ok", "CORE:INVALID_SHARED_BUFFER");
            return;
        }
    };
    assert_eq!(
        short_err,
        CoreError::InvalidSharedBuffer {
            ptr: short,
            len: 16
        }
    );

    let exact = engine.alloc_shared_buffer(TRANSFORM_STRIDE);
    match engine.sync_transforms_to_buffer(exact, 1) {
        Ok(()) => {}
        Err(err) => {
            assert_eq!(err.code(), "exact");
            return;
        }
    }
    assert_eq!(slot_bytes(exact, 0), [0u8; TRANSFORM_STRIDE]);

    engine.free_shared_buffer(exact, TRANSFORM_STRIDE);
    let freed = match engine.sync_transforms_to_buffer(exact, 1) {
        Err(err) => err,
        Ok(()) => {
            assert_eq!("ok", "CORE:INVALID_SHARED_BUFFER");
            return;
        }
    };
    assert_eq!(freed, CoreError::InvalidSharedBuffer { ptr: exact, len: 0 });
}
