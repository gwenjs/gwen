//! `physics3d_step` allocates nothing after the first step has warmed the world.
//!
//! Native only, and only with `physics3d`. A counting allocator cannot share a
//! crate with the physics2d gate, so this file is its own test binary.
//! `crates/gwen-core/tests/physics_step_alloc.rs` is physics2d only.

#![cfg(not(target_arch = "wasm32"))]
#![cfg(feature = "physics3d")]
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
use gwen_core::physics3d::Physics3DError;

struct CountingAlloc;

static LOCK: Mutex<()> = Mutex::new(());

thread_local! {
    /// Allocations made by this thread. `Cell<usize>` has no destructor and a `const`
    /// initializer, so reading or writing it never allocates inside the allocator.
    static ALLOCS: Cell<usize> = const { Cell::new(0) };
}

fn count_allocation() {
    ALLOCS.with(|count| count.set(count.get() + 1));
}

fn hold_lock() -> std::sync::MutexGuard<'static, ()> {
    match LOCK.lock() {
        Ok(guard) => guard,
        Err(poison) => poison.into_inner(),
    }
}

// SAFETY: forwards to the system allocator and only counts calls. The test process is the only user.
unsafe impl GlobalAlloc for CountingAlloc {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        count_allocation();
        // SAFETY: `layout` is the layout the caller passed to this allocator.
        unsafe { System.alloc(layout) }
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        // SAFETY: `ptr` and `layout` are the pair this allocator returned.
        unsafe { System.dealloc(ptr, layout) }
    }

    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        count_allocation();
        // SAFETY: `ptr` and `layout` are the pair this allocator returned.
        unsafe { System.realloc(ptr, layout, new_size) }
    }
}

#[global_allocator]
static GLOBAL: CountingAlloc = CountingAlloc;

fn allocs_during(body: impl FnOnce()) -> usize {
    ALLOCS.with(|count| count.set(0));
    body();
    ALLOCS.with(Cell::get)
}

const BODIES: u32 = 8;

fn world_with_dynamic_bodies() -> Result<Engine, Physics3DError> {
    let mut engine = Engine::new(BODIES).map_err(Physics3DError::Core)?;
    engine.physics3d_init(0.0, -9.81, 0.0, BODIES);
    for index in 0..BODIES {
        let id = engine.create_entity().map_err(Physics3DError::Core)?;
        engine.add_entity_transform(id.index(), 0.0, 10.0, 0.0, 1.0, 1.0);
        engine.physics3d_add_body(index, 0.0, 10.0, 0.0, 1, 1.0, 0.0, 0.0)?;
    }
    Ok(engine)
}

#[test]
fn physics3d_step_allocates_nothing_after_warmup() -> Result<(), Physics3DError> {
    let _guard = hold_lock();
    let mut engine = world_with_dynamic_bodies()?;
    engine.physics3d_step(0.1)?;
    let mut stepped = 0u8;
    let allocations = allocs_during(|| {
        stepped = u8::from(engine.physics3d_step(0.1).is_ok());
    });
    assert_eq!(stepped, 1);
    assert_eq!(allocations, 0);
    Ok(())
}
