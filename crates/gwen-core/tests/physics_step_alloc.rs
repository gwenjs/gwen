//! `physics_step` allocates at most one 64-byte block after the pose scratch has been warmed up.
//!
//! Native only, and only with `physics2d`. `verify-red` runs this target
//! without that feature, so the file is empty in that run.

#![cfg(not(target_arch = "wasm32"))]
#![cfg(feature = "physics2d")]
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::unreachable,
    clippy::todo,
    clippy::unimplemented,
    clippy::bool_assert_comparison,
    reason = "test-only code"
)]

use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;
use std::sync::Mutex;

use gwen_core::bindings::Engine;
use gwen_core::physics2d::Physics2DError;

struct CountingAlloc;

static LOCK: Mutex<()> = Mutex::new(());

thread_local! {
    /// Allocations made by this thread. `Cell<usize>` has no destructor and a `const`
    /// initializer, so reading or writing it never allocates inside the allocator.
    static ALLOCS: Cell<usize> = const { Cell::new(0) };
    /// Largest layout size seen since the last reset. Same `const` init as `ALLOCS`.
    static MAX_LAYOUT: Cell<usize> = const { Cell::new(0) };
}

fn note_layout(bytes: usize) {
    ALLOCS.with(|count| count.set(count.get() + 1));
    MAX_LAYOUT.with(|max_bytes| {
        if bytes > max_bytes.get() {
            max_bytes.set(bytes);
        }
    });
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
        note_layout(layout.size());
        // SAFETY: `layout` is the layout the caller passed to this allocator.
        unsafe { System.alloc(layout) }
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        // SAFETY: `ptr` and `layout` are the pair this allocator returned.
        unsafe { System.dealloc(ptr, layout) }
    }

    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        note_layout(new_size);
        // SAFETY: `ptr` and `layout` are the pair this allocator returned.
        unsafe { System.realloc(ptr, layout, new_size) }
    }
}

#[global_allocator]
static GLOBAL: CountingAlloc = CountingAlloc;

fn allocs_during(body: impl FnOnce()) -> (usize, usize) {
    ALLOCS.with(|count| count.set(0));
    MAX_LAYOUT.with(|max_bytes| max_bytes.set(0));
    body();
    (ALLOCS.with(Cell::get), MAX_LAYOUT.with(Cell::get))
}

const BODIES: u32 = 8;

fn world_with_dynamic_bodies() -> Result<Engine, Physics2DError> {
    let mut engine = Engine::new(BODIES).map_err(Physics2DError::Core)?;
    engine.physics_init(0.0, -9.81, BODIES);
    for index in 0..BODIES {
        let id = engine.create_entity().map_err(Physics2DError::Core)?;
        engine.add_entity_transform(id.index(), 0.0, 10.0, 0.0, 1.0, 1.0);
        engine.physics_add_rigid_body(
            index, 0.0, 10.0, 1, 1.0, 1.0, 0.0, 0.0, 0.0, 0.0, None, None,
        )?;
    }
    Ok(engine)
}

/// Rapier 0.36.1 builds one `Vec` of `num_workers` `PaddedCursor` values
/// (`#[repr(align(64))]`) on every step.
///
/// `rapier2d-0.36.1` `src/dynamics/solver/staged_island_solver/init.rs:618` calls
/// `StageSync::new`. The `Vec` is `sync.rs:60-62`. Without `parallel`, `init.rs:659`
/// keeps `num_workers == 1`, so the block is 64 bytes. The same lines are in
/// `rapier3d-0.36.1`.
///
/// Debug builds also clone solver-graph tables.
/// `geometry/narrow_phase/solver_graph.rs:149` calls `debug_validate_body_qualify_info`,
/// whose `body_qualify_info.clone` is at `:706`. `force_event_pairs.clone` is at `:386`.
/// Both functions are `#[cfg(debug_assertions)]` (`:365` and `:704`). The same lines are in
/// `rapier3d-0.36.1`. This test is ignored while `debug_assertions` is on, so that clone is
/// not counted. Any other per-step allocation still fails.
///
/// Maintainer figure (D-RAP-3), 2026-10-27: 15 ns malloc+free against 4.6 µs per step (about 0.3 %).
/// Explicit maintainer override D-RAP-3. The threshold returns to 0 only from a measured
/// run on a Rapier release without the allocation.
#[test]
#[cfg_attr(
    debug_assertions,
    ignore = "debug builds clone solver-graph tables (rapier solver_graph.rs:386 and :706); release allows one block of at most 64 bytes"
)]
fn physics_step_allocates_at_most_one_small_block_per_worker_after_warmup(
) -> Result<(), Physics2DError> {
    let _guard = hold_lock();
    let mut engine = world_with_dynamic_bodies()?;
    engine.physics_step(0.1)?;
    let mut stepped = 0u8;
    let (allocations, max_layout) = allocs_during(|| {
        stepped = u8::from(engine.physics_step(0.1).is_ok());
    });
    assert_eq!(stepped, 1);
    assert_eq!(
        allocations <= 1,
        true,
        "allocations {allocations}, max layout {max_layout}"
    );
    assert_eq!(
        max_layout <= 64,
        true,
        "allocations {allocations}, max layout {max_layout}"
    );
    Ok(())
}
