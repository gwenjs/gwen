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
#[test]
fn path_find_2d_caps_at_max_nodes() -> Result<(), gwen_core::physics2d::Physics2DError> {
    use gwen_core::physics2d::{Physics2DError, MAX_PATH_NODES};

    let mut engine = Engine::new(4).map_err(Physics2DError::Core)?;
    let count = engine.path_find_2d(0.0, 0.0, 255.0, 0.0)?;
    assert_eq!(count, MAX_PATH_NODES as u32);
    let ptr = engine.path_get_result_ptr();
    // SAFETY: `path_find_2d` just wrote `MAX_PATH_NODES` nodes into this engine's buffer.
    let floats = unsafe { std::slice::from_raw_parts(ptr, MAX_PATH_NODES * 2) };
    assert_eq!(floats[MAX_PATH_NODES * 2 - 2], 255.0);
    assert_eq!(floats[MAX_PATH_NODES * 2 - 1], 0.0);
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
