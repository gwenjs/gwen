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
    let mut engine = Engine::new(4).unwrap_or_else(|err| {
        assert_eq!("", err.code());
        std::process::abort();
    });
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

    let mut buffers = SharedGuard::new(&mut engine);
    let ptr = buffers.alloc(4 * TRANSFORM_STRIDE);
    match buffers.engine().sync_transforms_to_buffer(ptr, 4) {
        Ok(()) => {}
        Err(err) => {
            assert_eq!(err.code(), "synced");
            return;
        }
    }

    assert_eq!(
        read_f32(ptr, 0).to_bits(),
        buffers.engine().get_entity_world_x(0).to_bits()
    );
    assert_eq!(
        read_f32(ptr, 4).to_bits(),
        buffers.engine().get_entity_world_y(0).to_bits()
    );
    assert_eq!(
        read_f32(ptr, 8).to_bits(),
        buffers.engine().get_entity_world_rotation(0).to_bits()
    );
    assert_eq!(read_f32(ptr, 12).to_bits(), 2.0f32.to_bits());
    assert_eq!(read_f32(ptr, 16).to_bits(), 2.0f32.to_bits());
    assert_eq!(read_f32(ptr, 32).to_bits(), 16.0f32.to_bits());
    assert_eq!(read_f32(ptr, 36).to_bits(), 8.0f32.to_bits());
    assert_eq!(read_f32(ptr, 44).to_bits(), 2.0f32.to_bits());
    assert_eq!(read_f32(ptr, 48).to_bits(), 2.0f32.to_bits());
    assert_eq!(
        read_f32(ptr, 32).to_bits(),
        buffers.engine().get_entity_world_x(1).to_bits()
    );
    assert_eq!(
        read_f32(ptr, 36).to_bits(),
        buffers.engine().get_entity_world_y(1).to_bits()
    );
    assert_eq!(read_u32(ptr, 20) & 1, 1);
    assert_eq!(read_u32(ptr, 20) & !1, 0);
    assert_eq!(read_u32(ptr, 32 + 20) & 1, 1);
    assert_eq!(slot_bytes(ptr, 2), [0u8; TRANSFORM_STRIDE]);
    assert_eq!(slot_bytes(ptr, 3), [0u8; TRANSFORM_STRIDE]);
}

#[test]
fn unknown_or_short_buffer_is_invalid_shared_buffer() {
    let mut engine = Engine::new(4).unwrap_or_else(|err| {
        assert_eq!("", err.code());
        std::process::abort();
    });
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

    let mut buffers = SharedGuard::new(&mut engine);
    let short = buffers.alloc(16);
    let short_err = match buffers.engine().sync_transforms_to_buffer(short, 1) {
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

    let exact = buffers.alloc(TRANSFORM_STRIDE);
    match buffers.engine().sync_transforms_to_buffer(exact, 1) {
        Ok(()) => {}
        Err(err) => {
            assert_eq!(err.code(), "exact");
            return;
        }
    }
    assert_eq!(slot_bytes(exact, 0), [0u8; TRANSFORM_STRIDE]);

    let free_err = buffers
        .engine()
        .free_shared_buffer(exact, TRANSFORM_STRIDE)
        .shared_buffer_error();
    assert_eq!(free_err, None);
    let freed = match buffers.engine().sync_transforms_to_buffer(exact, 1) {
        Err(err) => err,
        Ok(()) => {
            assert_eq!("ok", "CORE:INVALID_SHARED_BUFFER");
            return;
        }
    };
    assert_eq!(freed, CoreError::InvalidSharedBuffer { ptr: exact, len: 0 });
}

trait FreeOutcome {
    fn shared_buffer_error(self) -> Option<CoreError>;
}

impl FreeOutcome for () {
    fn shared_buffer_error(self) -> Option<CoreError> {
        None
    }
}

impl FreeOutcome for Result<(), CoreError> {
    fn shared_buffer_error(self) -> Option<CoreError> {
        self.err()
    }
}

#[test]
fn free_wrong_length_is_invalid_shared_buffer_and_keeps_the_allocation() {
    let mut engine = Engine::new(4).unwrap_or_else(|err| {
        assert_eq!("", err.code());
        std::process::abort();
    });
    let mut buffers = SharedGuard::new(&mut engine);
    let ptr = buffers.alloc(TRANSFORM_STRIDE);
    assert_eq!(
        buffers
            .engine()
            .free_shared_buffer(0, TRANSFORM_STRIDE)
            .shared_buffer_error(),
        None
    );
    assert_eq!(
        buffers
            .engine()
            .free_shared_buffer(ptr, 0)
            .shared_buffer_error(),
        None
    );
    assert_eq!(buffers.engine().sync_transforms_to_buffer(ptr, 1), Ok(()));
    let err = buffers
        .engine()
        .free_shared_buffer(ptr, 16)
        .shared_buffer_error();
    assert_eq!(
        err,
        Some(CoreError::InvalidSharedBuffer {
            ptr,
            len: TRANSFORM_STRIDE
        })
    );
    assert_eq!(buffers.engine().sync_transforms_to_buffer(ptr, 1), Ok(()));
}

#[test]
fn free_unknown_pointer_is_invalid_shared_buffer_and_keeps_the_registry() {
    let mut engine = Engine::new(4).unwrap_or_else(|err| {
        assert_eq!("", err.code());
        std::process::abort();
    });
    let mut buffers = SharedGuard::new(&mut engine);
    let live = buffers.alloc(TRANSFORM_STRIDE);
    let err = buffers
        .engine()
        .free_shared_buffer(0x1000, TRANSFORM_STRIDE)
        .shared_buffer_error();
    assert_eq!(
        err,
        Some(CoreError::InvalidSharedBuffer {
            ptr: 0x1000,
            len: 0
        })
    );
    assert_eq!(buffers.engine().sync_transforms_to_buffer(live, 1), Ok(()));
}

#[test]
fn free_twice_is_invalid_shared_buffer_and_keeps_the_registry() {
    let mut engine = Engine::new(4).unwrap_or_else(|err| {
        assert_eq!("", err.code());
        std::process::abort();
    });
    let mut buffers = SharedGuard::new(&mut engine);
    let live = buffers.alloc(TRANSFORM_STRIDE);
    let other = buffers.alloc(TRANSFORM_STRIDE);
    let first = buffers
        .engine()
        .free_shared_buffer(live, TRANSFORM_STRIDE)
        .shared_buffer_error();
    assert_eq!(first, None);
    let second = buffers
        .engine()
        .free_shared_buffer(live, TRANSFORM_STRIDE)
        .shared_buffer_error();
    assert_eq!(
        second,
        Some(CoreError::InvalidSharedBuffer { ptr: live, len: 0 })
    );
    assert_eq!(buffers.engine().sync_transforms_to_buffer(other, 1), Ok(()));
    assert_eq!(
        buffers.engine().sync_transforms_to_buffer(live, 1),
        Err(CoreError::InvalidSharedBuffer { ptr: live, len: 0 })
    );
}
