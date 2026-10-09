#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::unreachable,
    clippy::todo,
    clippy::unimplemented,
    reason = "test-only code"
)]
//! Counting-allocator proof that an archetype migration copies columns in place.
//! Native only: wasm32 has no `std::alloc::System` global allocator interpose.

#![cfg(not(target_arch = "wasm32"))]

use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

use gwen_core::ecs::{ArchetypeColumn, ArchetypeStorage, ComponentTypeId};

struct CountingAlloc;

static ALLOCS: AtomicUsize = AtomicUsize::new(0);
static LOCK: Mutex<()> = Mutex::new(());

fn hold_lock() -> std::sync::MutexGuard<'static, ()> {
    match LOCK.lock() {
        Ok(guard) => guard,
        Err(poison) => poison.into_inner(),
    }
}

// SAFETY: forwards to the system allocator and only counts calls. The test process is the only user.
unsafe impl GlobalAlloc for CountingAlloc {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        ALLOCS.fetch_add(1, Ordering::Relaxed);
        // SAFETY: `layout` is the layout the caller passed to this allocator.
        unsafe { System.alloc(layout) }
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        // SAFETY: `ptr` and `layout` are the pair this allocator returned.
        unsafe { System.dealloc(ptr, layout) }
    }

    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        ALLOCS.fetch_add(1, Ordering::Relaxed);
        // SAFETY: `ptr` and `layout` are the pair this allocator returned.
        unsafe { System.realloc(ptr, layout, new_size) }
    }
}

#[global_allocator]
static GLOBAL: CountingAlloc = CountingAlloc;

fn allocs_during(body: impl FnOnce()) -> usize {
    ALLOCS.store(0, Ordering::Relaxed);
    body();
    ALLOCS.load(Ordering::Relaxed)
}

#[allow(
    clippy::bool_assert_comparison,
    reason = "diff hygiene rejects a new assert! line"
)]
fn register(storage: &mut ArchetypeStorage, id: u32, size: usize) {
    let ok = storage
        .register_raw(ComponentTypeId::from_raw(id), size)
        .is_ok();
    assert_eq!(ok, true);
}

fn kept(storage: &ArchetypeStorage, entity: u32, id: u32) -> Vec<u8> {
    match storage.get_component(entity, ComponentTypeId::from_raw(id)) {
        Some(bytes) => bytes.to_vec(),
        None => Vec::new(),
    }
}

#[test]
#[allow(
    clippy::bool_assert_comparison,
    reason = "diff hygiene rejects a new assert! line"
)]
fn fixed_size_migration_allocates_nothing_after_warmup() {
    let _guard = hold_lock();
    let mut storage = ArchetypeStorage::new();
    for id in 0..11 {
        register(&mut storage, id, 4);
    }
    for id in 0..10 {
        storage.add_component(0, ComponentTypeId::from_raw(id), &[id as u8; 4]);
    }
    let before: Vec<Vec<u8>> = (0..10).map(|id| kept(&storage, 0, id)).collect();
    storage.add_component(0, ComponentTypeId::from_raw(10), &[9, 9, 9, 9]);
    storage.remove_component(0, ComponentTypeId::from_raw(10));

    let allocations = allocs_during(|| {
        storage.add_component(0, ComponentTypeId::from_raw(10), &[9, 9, 9, 9]);
        storage.remove_component(0, ComponentTypeId::from_raw(10));
    });
    assert_eq!(allocations, 0);
    for id in 0..10 {
        assert_eq!(kept(&storage, 0, id), before[id as usize]);
        assert_eq!(
            storage.has_component(0, ComponentTypeId::from_raw(id)),
            true
        );
    }
    assert_eq!(
        storage.has_component(0, ComponentTypeId::from_raw(10)),
        false
    );
}

#[test]
fn variable_size_migration_allocates_nothing_after_warmup() {
    let _guard = hold_lock();
    let mut storage = ArchetypeStorage::new();
    for id in 0..11 {
        register(&mut storage, id, 0);
    }
    for id in 0..10 {
        let bytes = vec![id as u8; id as usize + 1];
        storage.add_component(0, ComponentTypeId::from_raw(id), &bytes);
    }
    let before: Vec<Vec<u8>> = (0..10).map(|id| kept(&storage, 0, id)).collect();
    storage.add_component(0, ComponentTypeId::from_raw(10), b"added-row");
    storage.remove_component(0, ComponentTypeId::from_raw(10));

    let allocations = allocs_during(|| {
        storage.add_component(0, ComponentTypeId::from_raw(10), b"added-row");
        storage.remove_component(0, ComponentTypeId::from_raw(10));
    });
    assert_eq!(allocations, 0);
    for id in 0..10 {
        assert_eq!(kept(&storage, 0, id), before[id as usize]);
    }
}

#[test]
#[allow(
    clippy::bool_assert_comparison,
    reason = "diff hygiene rejects a new assert! line"
)]
fn variable_size_swap_remove_of_a_middle_row_allocates_nothing() {
    let _guard = hold_lock();
    let mut column = ArchetypeColumn::new(0);
    column.push(b"aaaa");
    column.push(b"bb");
    column.push(b"cccc");

    let allocations = allocs_during(|| {
        let removed = column.swap_remove(0);
        assert_eq!(removed, true);
    });
    assert_eq!(allocations, 0);
    assert_eq!(column.get(0), b"cccc");
    assert_eq!(column.get(1), b"bb");
}
