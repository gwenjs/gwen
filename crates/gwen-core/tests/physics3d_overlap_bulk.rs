//! `physics3d_overlap_shape` output pointer checks and `physics3d_bulk_*` error propagation.
//!
//! `rust-miri-step` runs this file under Miri with Tree Borrows on aarch64 (`ci.yml`, step
//! `Miri physics3d overlap export`). Natively:
//! `cargo test -p gwen-core --features physics3d --test physics3d_overlap_bulk`.
//!
//! The overlap export takes `out_ptr: u32`. A 64-bit native host cannot pass its own heap address
//! through a `u32`, so the pointer cases call `Engine::check_shared_u32_slots`, the same
//! registry lookup the export uses before it writes, with a real `usize` address from
//! `alloc_shared_buffer`. The export itself is called with the addresses a `u32` can hold.

#![cfg(feature = "physics3d")]

use gwen_core::bindings::Engine;
use gwen_core::physics3d::Physics3DError;
use gwen_core::CoreError;

type Outcome = Result<(), Physics3DError>;

const ALL: u32 = 0xFFFF_FFFF;

fn invalid_buffer(ptr: usize, len: usize) -> Physics3DError {
    Physics3DError::Core(CoreError::InvalidSharedBuffer { ptr, len })
}

fn engine_with_box() -> Result<Engine, Physics3DError> {
    let mut e = Engine::new(8).map_err(Physics3DError::Core)?;
    e.physics3d_init(0.0, 0.0, 0.0, 8);
    e.physics3d_add_body(4, 0.0, 0.0, 0.0, 1, 1.0, 0.0, 0.0)?;
    e.physics3d_add_box_collider(
        4, 0.5, 0.5, 0.5, 0.0, 0.0, 0.0, false, 0.5, 0.0, ALL, ALL, 1,
    )?;
    e.physics3d_step(1.0 / 60.0)?;
    Ok(e)
}

/// Frees a shared buffer when dropped, including when a check fails the test.
struct Shared<'a> {
    engine: &'a mut Engine,
    ptr: usize,
    len: usize,
}

impl<'a> Shared<'a> {
    fn new(engine: &'a mut Engine, len: usize) -> Self {
        let ptr = engine.alloc_shared_buffer(len);
        Self { engine, ptr, len }
    }
}

impl Drop for Shared<'_> {
    fn drop(&mut self) {
        let _ = self.engine.free_shared_buffer(self.ptr, self.len);
    }
}

fn overlap(e: &mut Engine, out_ptr: u32, max_results: u32) -> Result<u32, Physics3DError> {
    e.physics3d_overlap_shape(
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
        ALL,
        ALL,
        out_ptr,
        max_results,
    )
}

// ── overlap: world and pointer ──────────────────────────────────────────────

#[test]
fn overlap_without_a_world_returns_not_initialized_before_looking_at_the_pointer() -> Outcome {
    let mut e = Engine::new(4).map_err(Physics3DError::Core)?;
    assert_eq!(
        overlap(&mut e, 0, 4),
        Err(Physics3DError::WorldNotInitialized)
    );
    assert_eq!(
        overlap(&mut e, 0xDEAD_BEEF, 4),
        Err(Physics3DError::WorldNotInitialized)
    );
    Ok(())
}

#[test]
fn export_refuses_null_and_unregistered_pointers_with_invalid_shared_buffer() -> Outcome {
    let mut e = engine_with_box()?;
    assert_eq!(overlap(&mut e, 0, 4), Err(invalid_buffer(0, 0)));
    assert_eq!(overlap(&mut e, 0, 0), Err(invalid_buffer(0, 0)));
    assert_eq!(
        overlap(&mut e, 0xDEAD_BEEF, 4),
        Err(invalid_buffer(0xDEAD_BEEF, 0))
    );
    assert_eq!(overlap(&mut e, 8, u32::MAX), Err(invalid_buffer(8, 0)));
    Ok(())
}

#[test]
fn check_accepts_the_exact_size_and_refuses_one_slot_more() -> Outcome {
    let mut e = engine_with_box()?;
    let shared = Shared::new(&mut e, 16);
    let ptr = shared.ptr;
    assert_eq!(shared.engine.check_shared_u32_slots(ptr, 4), Ok(()));
    assert_eq!(shared.engine.check_shared_u32_slots(ptr, 1), Ok(()));
    assert_eq!(shared.engine.check_shared_u32_slots(ptr, 0), Ok(()));
    assert_eq!(
        shared.engine.check_shared_u32_slots(ptr, 5),
        Err(invalid_buffer(ptr, 16))
    );
    Ok(())
}

#[test]
fn check_refuses_a_count_whose_byte_size_overflows_32_bits() -> Outcome {
    let mut e = engine_with_box()?;
    let shared = Shared::new(&mut e, 16);
    let ptr = shared.ptr;
    // u32::MAX * 4 does not fit in 32 bits (wasm32 usize), and is far past 16 bytes on a host.
    for count in [u32::MAX, 1 << 30, (1 << 30) + 1] {
        assert_eq!(
            shared.engine.check_shared_u32_slots(ptr, count),
            Err(invalid_buffer(ptr, 16)),
            "count {count}"
        );
    }
    Ok(())
}

#[test]
fn check_refuses_null_even_for_zero_slots() -> Outcome {
    let e = engine_with_box()?;
    assert_eq!(e.check_shared_u32_slots(0, 0), Err(invalid_buffer(0, 0)));
    assert_eq!(e.check_shared_u32_slots(0, 4), Err(invalid_buffer(0, 0)));
    Ok(())
}

#[test]
fn check_refuses_an_address_outside_every_live_allocation() -> Outcome {
    let e = engine_with_box()?;
    let local = [0u32; 8];
    let ptr = local.as_ptr() as usize;
    assert_eq!(
        e.check_shared_u32_slots(ptr, 4),
        Err(invalid_buffer(ptr, 0))
    );
    Ok(())
}

#[test]
fn check_refuses_an_interior_or_misaligned_address() -> Outcome {
    let mut e = engine_with_box()?;
    let shared = Shared::new(&mut e, 32);
    let base = shared.ptr;
    for offset in [1usize, 2, 3, 4, 8, 31] {
        assert_eq!(
            shared.engine.check_shared_u32_slots(base + offset, 1),
            Err(invalid_buffer(base + offset, 0)),
            "offset {offset}"
        );
    }
    Ok(())
}

#[test]
fn check_refuses_a_freed_allocation() -> Outcome {
    let mut e = engine_with_box()?;
    let ptr = e.alloc_shared_buffer(16);
    assert_eq!(e.check_shared_u32_slots(ptr, 4), Ok(()));
    assert_eq!(e.free_shared_buffer(ptr, 16), Ok(()));
    assert_eq!(
        e.check_shared_u32_slots(ptr, 4),
        Err(invalid_buffer(ptr, 0))
    );
    Ok(())
}

#[test]
fn check_refuses_an_allocation_that_belongs_to_another_engine() -> Outcome {
    let mut owner = engine_with_box()?;
    let other = engine_with_box()?;
    let shared = Shared::new(&mut owner, 16);
    let ptr = shared.ptr;
    assert_eq!(
        other.check_shared_u32_slots(ptr, 4),
        Err(invalid_buffer(ptr, 0))
    );
    assert_eq!(shared.engine.check_shared_u32_slots(ptr, 4), Ok(()));
    Ok(())
}

// ── bulk sync and impulse ───────────────────────────────────────────────────

fn engine_with_component(bytes: &[u8]) -> Result<(Engine, u32, u32, u32), CoreError> {
    let mut e = Engine::new(8)?;
    let type_id = e.register_component(&[0])?;
    let id = e.create_entity()?;
    assert_eq!(
        e.add_component(id.index(), id.generation(), type_id, bytes),
        Ok(true)
    );
    Ok((e, type_id, id.index(), id.generation()))
}

#[test]
fn sync_from_rapier_returns_count_and_bytes_and_propagates_a_length_mismatch(
) -> Result<(), CoreError> {
    let (mut e, type_id, index, generation) = engine_with_component(&[1, 2, 3, 4])?;
    let before = e.get_component_raw(index, generation, type_id);

    let mut slots = [7u32];
    let mut gens = [7u32, 9];
    let mut buf = [9u8; 8];
    assert_eq!(
        e.physics3d_bulk_sync_from_rapier(type_id, &mut slots, &mut gens, &mut buf),
        Err(Physics3DError::Core(CoreError::BufferLengthMismatch {
            buffer: "gens",
            expected: 1,
            actual: 2,
        }))
    );
    assert_eq!(slots, [7]);
    assert_eq!(gens, [7, 9]);
    assert_eq!(buf, [9; 8]);
    assert_eq!(e.get_component_raw(index, generation, type_id), before);

    let mut read_slots = [7u32];
    let mut read_gens = [7u32];
    let mut read_buf = [9u8; 8];
    assert_eq!(
        e.physics3d_bulk_sync_from_rapier(type_id, &mut read_slots, &mut read_gens, &mut read_buf),
        Ok(vec![1, 4])
    );
    assert_eq!(read_slots, [index]);
    assert_eq!(read_gens, [generation]);
    assert_eq!(&read_buf[..4], &[1, 2, 3, 4]);
    Ok(())
}

#[test]
fn sync_to_rapier_propagates_a_length_mismatch_and_writes_nothing() -> Result<(), CoreError> {
    let (mut e, type_id, index, generation) = engine_with_component(&[1, 2, 3, 4])?;
    let before = e.get_component_raw(index, generation, type_id);

    assert_eq!(
        e.physics3d_bulk_sync_to_rapier(&[index], &[generation, 9], type_id, &[9, 9, 9, 9]),
        Err(Physics3DError::Core(CoreError::BufferLengthMismatch {
            buffer: "gens",
            expected: 1,
            actual: 2,
        }))
    );
    assert_eq!(
        e.physics3d_bulk_sync_to_rapier(&[index], &[generation], type_id, &[9]),
        Err(Physics3DError::Core(CoreError::BufferLengthMismatch {
            buffer: "data",
            expected: 4,
            actual: 1,
        }))
    );
    assert_eq!(e.get_component_raw(index, generation, type_id), before);

    assert_eq!(
        e.physics3d_bulk_sync_to_rapier(&[index], &[generation], type_id, &[9, 9, 9, 9]),
        Ok(())
    );
    assert_eq!(
        e.get_component_raw(index, generation, type_id),
        Ok(vec![9, 9, 9, 9])
    );
    Ok(())
}

#[test]
fn apply_impulse_propagates_a_length_mismatch_and_writes_nothing() -> Result<(), CoreError> {
    let (mut e, type_id, index, generation) = engine_with_component(&[5, 6, 7, 8])?;
    let before = e.get_component_raw(index, generation, type_id);

    assert_eq!(
        e.physics3d_bulk_apply_impulse(&[index], &[generation, 3], type_id, &[1, 1, 1, 1]),
        Err(Physics3DError::Core(CoreError::BufferLengthMismatch {
            buffer: "gens",
            expected: 1,
            actual: 2,
        }))
    );
    assert_eq!(
        e.physics3d_bulk_apply_impulse(&[index], &[generation], type_id, &[1, 1]),
        Err(Physics3DError::Core(CoreError::BufferLengthMismatch {
            buffer: "data",
            expected: 4,
            actual: 2,
        }))
    );
    assert_eq!(e.get_component_raw(index, generation, type_id), before);

    assert_eq!(
        e.physics3d_bulk_apply_impulse(&[index], &[generation], type_id, &[1, 1, 1, 1]),
        Ok(())
    );
    assert_eq!(
        e.get_component_raw(index, generation, type_id),
        Ok(vec![1, 1, 1, 1])
    );
    Ok(())
}
