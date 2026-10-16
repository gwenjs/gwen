#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::unreachable,
    clippy::todo,
    clippy::unimplemented,
    reason = "test-only code"
)]
//! Counting-allocator proof that chunk add, remove, and query stay quiet.
//! Native only: wasm32 has no `std::alloc::System` global allocator interpose.

#![cfg(not(target_arch = "wasm32"))]

use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use gwen_core::chunk_store::{ChunkStore, CHUNK_ROWS};
use gwen_core::CoreError;

struct CountingAlloc;

static LOCK: Mutex<()> = Mutex::new(());

thread_local! {
    /// Allocations made by this thread. `Cell<usize>` has no destructor and a `const`
    /// initializer, so reading or writing it never allocates inside the allocator.
    /// A process-wide counter also counted the libtest harness thread and the other
    /// test threads, which allocate while a measured window is open.
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

#[test]
fn allocations_on_other_threads_are_not_counted() {
    let _guard = hold_lock();
    let running = AtomicBool::new(true);
    let measured = std::thread::scope(|scope| {
        let worker = scope.spawn(|| {
            let mut kept = 0usize;
            while running.load(Ordering::Relaxed) {
                let block = vec![0u8; 64];
                kept = kept.wrapping_add(block.len());
                drop(block);
            }
            kept
        });
        let measured = allocs_during(|| {
            let mut sum = 0u64;
            for n in 0..20_000_000u64 {
                sum = sum.wrapping_add(n);
            }
            std::hint::black_box(sum);
        });
        running.store(false, Ordering::Relaxed);
        let _ = worker.join();
        measured
    });
    assert_eq!(measured, 0);
}

#[test]
fn chunk_store_add_remove_allocates_nothing_after_warmup() -> Result<(), CoreError> {
    let _guard = hold_lock();
    let mut store = ChunkStore::new(8)?;
    let position = store.register(&[0])?;
    let velocity = store.register(&[0])?;
    assert_eq!(store.add(0, 0, position, &[1, 0, 0, 0]), Ok(true));
    assert_eq!(store.add(1, 0, position, &[2, 0, 0, 0]), Ok(true));
    assert_eq!(store.add(0, 0, velocity, &[3, 0, 0, 0]), Ok(true));
    assert_eq!(store.remove(0, 0, velocity), Ok(true));
    let allocations = allocs_during(|| {
        let added = store.add(0, 0, velocity, &[3, 0, 0, 0]);
        let removed = store.remove(0, 0, velocity);
        assert_eq!(added, Ok(true));
        assert_eq!(removed, Ok(true));
    });
    assert_eq!(allocations, 0);
    let mut kept = [0u8; 4];
    assert_eq!(Some(store.copy_row(1, 0, position, &mut kept)), Some(true));
    assert_eq!(kept, [2, 0, 0, 0]);
    assert_eq!(Some(store.copy_row(0, 0, velocity, &mut kept)), Some(false));
    Ok(())
}

#[test]
fn chunk_store_delete_allocates_nothing_after_warmup() -> Result<(), CoreError> {
    let _guard = hold_lock();
    let mut store = ChunkStore::new(8)?;
    let position = store.register(&[0])?;
    assert_eq!(store.add(0, 0, position, &[1, 0, 0, 0]), Ok(true));
    assert_eq!(store.add(1, 0, position, &[2, 0, 0, 0]), Ok(true));
    let allocations = allocs_during(|| {
        let deleted = store.delete_entity(1, 0);
        assert_eq!(Some(deleted), Some(true));
    });
    assert_eq!(allocations, 0);
    let mut kept = [0u8; 4];
    assert_eq!(Some(store.copy_row(0, 0, position, &mut kept)), Some(true));
    assert_eq!(kept, [1, 0, 0, 0]);
    assert_eq!(store.location(1), None);
    Ok(())
}

#[test]
fn chunk_store_in_place_write_allocates_nothing_after_warmup() -> Result<(), CoreError> {
    let _guard = hold_lock();
    let mut store = ChunkStore::new(4)?;
    let position = store.register(&[0])?;
    assert_eq!(store.add(0, 0, position, &[1, 0, 0, 0]), Ok(true));
    let generation = store.generation();
    let allocations = allocs_during(|| {
        let written = store.add(0, 0, position, &[9, 0, 0, 0]);
        assert_eq!(written, Ok(true));
    });
    assert_eq!(allocations, 0);
    assert_eq!(store.generation(), generation);
    let mut kept = [0u8; 4];
    assert_eq!(Some(store.copy_row(0, 0, position, &mut kept)), Some(true));
    assert_eq!(kept, [9, 0, 0, 0]);
    Ok(())
}

#[test]
fn chunk_store_staged_read_and_write_allocate_nothing_after_warmup() -> Result<(), CoreError> {
    let _guard = hold_lock();
    let mut store = ChunkStore::new(4)?;
    let position = store.register(&[0])?;
    assert_eq!(store.add(0, 0, position, &[1, 0, 0, 0]), Ok(true));
    let generation = store.generation();
    store.staging_mut()[..4].copy_from_slice(&[4, 0, 0, 0]);
    let allocations = allocs_during(|| {
        let written = store.write_staged(0, 0, position);
        assert_eq!(written, Ok(true));
        store.staging_mut()[..4].fill(0);
        let read = store.read_staged(0, 0, position);
        assert_eq!(Some(read), Some(true));
    });
    assert_eq!(allocations, 0);
    assert_eq!(store.generation(), generation);
    assert_eq!(store.staging()[..4], [4, 0, 0, 0]);
    Ok(())
}

#[test]
fn chunk_store_boundary_add_remove_allocates_nothing_after_warmup() -> Result<(), CoreError> {
    let _guard = hold_lock();
    let mut store = ChunkStore::new(2048)?;
    let position = store.register(&[0])?;
    let bytes = [7, 0, 0, 0];
    let boundary = u32::try_from(CHUNK_ROWS).unwrap_or(1024);
    for index in 0..boundary + 1 {
        assert_eq!(store.add(index, 0, position, &bytes), Ok(true));
    }
    assert_eq!(Some(store.delete_entity(boundary, 0)), Some(true));
    let mut generation = 1u32;
    let allocations = allocs_during(|| {
        for _ in 0..4 {
            let added = store.add(boundary, generation, position, &bytes);
            assert_eq!(added, Ok(true));
            let mut kept = [0u8; 4];
            let copied = store.copy_row(boundary, generation, position, &mut kept);
            assert_eq!(Some(copied), Some(true));
            assert_eq!(kept, bytes);
            let deleted = store.delete_entity(boundary, generation);
            assert_eq!(Some(deleted), Some(true));
            generation = generation.wrapping_add(1);
        }
    });
    assert_eq!(allocations, 0);
    assert_eq!(store.location(boundary), None);
    assert_eq!(store.slot_generation(boundary), Some(generation));
    Ok(())
}

#[test]
fn chunk_store_query_chunks_allocates_nothing_after_warmup() -> Result<(), CoreError> {
    let _guard = hold_lock();
    let mut store = ChunkStore::new(8)?;
    let position = store.register(&[0])?;
    assert_eq!(store.add(0, 0, position, &[1, 0, 0, 0]), Ok(true));
    assert_eq!(store.add(1, 0, position, &[2, 0, 0, 0]), Ok(true));
    let query = store.register_query(&[position])?;
    let first = store.query_chunks(query)?;
    let allocations = allocs_during(|| {
        for _ in 0..4 {
            let again = store.query_chunks(query);
            assert_eq!(again, Ok(first));
        }
    });
    assert_eq!(allocations, 0);
    let table = store.query_table(query).unwrap_or(&[]);
    assert_eq!(table.first().copied(), Some(1));
    assert_eq!(table.get(3).copied(), Some(2));
    Ok(())
}
