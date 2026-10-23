//! Dropping an engine frees every shared buffer it still holds.
//!
//! Native only. A counting allocator records live bytes for this thread.

#![cfg(not(target_arch = "wasm32"))]
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::unreachable,
    clippy::todo,
    clippy::unimplemented,
    reason = "test-only code"
)]

use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;
use std::sync::Mutex;

use gwen_core::bindings::Engine;
use gwen_core::{CoreError, FLAG_HAS_TRANSFORM, TRANSFORM_STRIDE};

struct CountingAlloc;

static LOCK: Mutex<()> = Mutex::new(());

thread_local! {
    /// Live bytes charged to this thread. `Cell<isize>` has no destructor and a `const`
    /// initializer, so reading or writing it never allocates inside the allocator.
    static LIVE_BYTES: Cell<isize> = const { Cell::new(0) };
}

fn add_live(delta: isize) {
    LIVE_BYTES.with(|live| live.set(live.get() + delta));
}

fn live_bytes() -> isize {
    LIVE_BYTES.with(Cell::get)
}

fn hold_lock() -> std::sync::MutexGuard<'static, ()> {
    match LOCK.lock() {
        Ok(guard) => guard,
        Err(poison) => poison.into_inner(),
    }
}

// SAFETY: forwards to the system allocator and only tracks live bytes. The test process is the only user.
unsafe impl GlobalAlloc for CountingAlloc {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        // SAFETY: `layout` is the layout the caller passed to this allocator.
        let ptr = unsafe { System.alloc(layout) };
        if !ptr.is_null() {
            add_live(layout.size() as isize);
        }
        ptr
    }

    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        // Does not call `alloc`, so a zeroed buffer is counted once.
        // SAFETY: `layout` is the layout the caller passed to this allocator.
        let ptr = unsafe { System.alloc_zeroed(layout) };
        if !ptr.is_null() {
            add_live(layout.size() as isize);
        }
        ptr
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        add_live(-(layout.size() as isize));
        // SAFETY: `ptr` and `layout` are the pair this allocator returned.
        unsafe { System.dealloc(ptr, layout) }
    }

    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        // SAFETY: `ptr` and `layout` are the pair this allocator returned.
        let next = unsafe { System.realloc(ptr, layout, new_size) };
        if !next.is_null() {
            add_live(new_size as isize - layout.size() as isize);
        }
        next
    }
}

#[global_allocator]
static GLOBAL: CountingAlloc = CountingAlloc;

fn read_slot(ptr: usize) -> [u8; TRANSFORM_STRIDE] {
    let mut bytes = [0u8; TRANSFORM_STRIDE];
    // SAFETY: `ptr` is the start of a live shared buffer of at least one transform slot.
    unsafe {
        std::ptr::copy_nonoverlapping(ptr as *const u8, bytes.as_mut_ptr(), TRANSFORM_STRIDE);
    }
    bytes
}

fn written_slot(
    x: f32,
    y: f32,
    rotation: f32,
    scale_x: f32,
    scale_y: f32,
) -> [u8; TRANSFORM_STRIDE] {
    let mut slot = [0u8; TRANSFORM_STRIDE];
    slot[0..4].copy_from_slice(&x.to_le_bytes());
    slot[4..8].copy_from_slice(&y.to_le_bytes());
    slot[8..12].copy_from_slice(&rotation.to_le_bytes());
    slot[12..16].copy_from_slice(&scale_x.to_le_bytes());
    slot[16..20].copy_from_slice(&scale_y.to_le_bytes());
    slot[20..24].copy_from_slice(&FLAG_HAS_TRANSFORM.to_le_bytes());
    slot
}

#[test]
fn dropping_the_engine_releases_live_shared_buffers() -> Result<(), CoreError> {
    let _guard = hold_lock();
    let baseline = live_bytes();
    let mut engine = Engine::new(4)?;
    let wide = engine.alloc_shared_buffer(64);
    let narrow = engine.alloc_shared_buffer(8);
    assert_ne!(wide, 0);
    assert_ne!(narrow, 0);
    drop(engine);
    let leaked = live_bytes() - baseline;
    assert_eq!(leaked, 0isize);
    Ok(())
}

#[test]
fn dropping_one_engine_keeps_the_other_engines_buffer_usable() -> Result<(), CoreError> {
    let _guard = hold_lock();
    let baseline = live_bytes();
    let mut engine_a = Engine::new(4)?;
    let mut engine_b = Engine::new(4)?;
    let ptr_a = engine_a.alloc_shared_buffer(64);
    let ptr_b = engine_b.alloc_shared_buffer(64);
    assert_ne!(ptr_a, 0);
    assert_ne!(ptr_b, 0);
    let id = engine_b.create_entity()?;
    assert_eq!(id.index(), 0);
    engine_b.add_entity_transform(id.index(), 10.0, 4.0, 0.0, 2.0, 3.0);
    engine_b.sync_transforms_to_buffer(ptr_b, 1)?;
    drop(engine_a);
    assert_eq!(read_slot(ptr_b), written_slot(10.0, 4.0, 0.0, 2.0, 3.0));
    assert_eq!(engine_b.free_shared_buffer(ptr_b, 64), Ok(()));
    drop(engine_b);
    let leaked = live_bytes() - baseline;
    assert_eq!(leaked, 0isize);
    Ok(())
}
