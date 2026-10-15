#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::unreachable,
    clippy::todo,
    clippy::unimplemented,
    reason = "test-only code"
)]
//! History buffers behind `transform_history_commit`.
//!
//! Each slot is 32 bytes: world x, y, rotation, scale x, scale y, flags, 8 reserved bytes.
//! Bit 0 means the slot has a transform. Bit 2 means the renderer must snap.

use gwen_core::bindings::Engine;
use gwen_core::CoreError;

const SLOT_BYTES: usize = 32;
const FLAG_HAS_TRANSFORM: u32 = 0b001;
const FLAG_TELEPORT: u32 = 0b100;

fn read_bytes(ptr: usize, len: usize) -> Vec<u8> {
    let mut out = vec![0u8; len];
    // SAFETY: `ptr` is the history allocation returned by this engine, and `len`
    // stays inside one 32-byte slot of that allocation.
    unsafe {
        std::ptr::copy_nonoverlapping(ptr as *const u8, out.as_mut_ptr(), len);
    }
    out
}

fn slot(engine: &Engine, buffer: u32, index: u32) -> [u8; SLOT_BYTES] {
    let base = engine.transform_history_ptr(buffer);
    assert_ne!(base, 0, "buffer {buffer} is allocated");
    let offset = base + index as usize * SLOT_BYTES;
    let bytes = read_bytes(offset, SLOT_BYTES);
    let mut slot = [0u8; SLOT_BYTES];
    slot.copy_from_slice(&bytes);
    slot
}

fn f32_at(bytes: &[u8], offset: usize) -> f32 {
    let mut buf = [0u8; 4];
    buf.copy_from_slice(&bytes[offset..offset + 4]);
    f32::from_le_bytes(buf)
}

fn flags_at(bytes: &[u8]) -> u32 {
    let mut buf = [0u8; 4];
    buf.copy_from_slice(&bytes[20..24]);
    u32::from_le_bytes(buf)
}

#[test]
fn commit_packs_world_values_and_alternates_buffers() -> Result<(), CoreError> {
    let mut engine = Engine::new(4)?;
    let parent = engine.create_entity()?;
    let child = engine.create_entity()?;
    engine.add_entity_transform(parent.index(), 10.0, 0.0, 0.0, 1.0, 1.0);
    engine.add_entity_transform(child.index(), 5.0, 0.0, 0.4, 2.0, 3.0);
    engine.set_entity_parent(child.index(), parent.index(), false)?;
    engine.update_transforms();

    let first = engine.transform_history_commit()?;
    assert_eq!(first, 0);
    let child_slot = slot(&engine, first, child.index());
    assert_eq!(f32_at(&child_slot, 0), 15.0);
    assert_eq!(f32_at(&child_slot, 4), 0.0);
    assert_eq!(f32_at(&child_slot, 8), 0.4);
    assert_eq!((f32_at(&child_slot, 12) * 100_000.0).round(), 200_000.0);
    assert_eq!((f32_at(&child_slot, 16) * 100_000.0).round(), 300_000.0);

    engine.set_entity_local_position(child.index(), 8.0, 0.0);
    engine.update_transforms();
    let second = engine.transform_history_commit()?;
    assert_eq!(second, 1);
    assert_eq!(f32_at(&slot(&engine, second, child.index()), 0), 18.0);
    assert_eq!(f32_at(&slot(&engine, first, child.index()), 0), 15.0);

    let third = engine.transform_history_commit()?;
    assert_eq!(third, 0);
    assert_eq!(f32_at(&slot(&engine, third, child.index()), 0), 18.0);
    Ok(())
}

#[test]
fn slots_without_a_transform_are_32_zero_bytes() -> Result<(), CoreError> {
    let mut engine = Engine::new(4)?;
    let with = engine.create_entity()?;
    let without = engine.create_entity()?;
    engine.add_entity_transform(with.index(), 3.0, 4.0, 0.0, 1.0, 1.0);
    engine.update_transforms();
    let buffer = engine.transform_history_commit()?;
    assert_ne!(slot(&engine, buffer, with.index()), [0u8; SLOT_BYTES]);
    assert_eq!(slot(&engine, buffer, without.index()), [0u8; SLOT_BYTES]);
    assert_eq!(slot(&engine, buffer, 3), [0u8; SLOT_BYTES]);
    Ok(())
}

#[test]
fn spawn_sets_the_teleport_bit_on_one_commit_only() -> Result<(), CoreError> {
    let mut engine = Engine::new(8)?;
    let spawned = engine.create_entity()?;
    engine.add_entity_transform(spawned.index(), 1.0, 2.0, 0.0, 1.0, 1.0);
    let bulk = engine.bulk_spawn_with_transforms(&[4.0, 5.0], &[0.0])?;
    assert_eq!(bulk.len(), 1);
    let bulk_index = bulk[0];
    engine.update_transforms();

    let first = engine.transform_history_commit()?;
    assert_eq!(
        flags_at(&slot(&engine, first, spawned.index())),
        FLAG_HAS_TRANSFORM | FLAG_TELEPORT
    );
    assert_eq!(
        flags_at(&slot(&engine, first, bulk_index)),
        FLAG_HAS_TRANSFORM | FLAG_TELEPORT
    );

    let second = engine.transform_history_commit()?;
    assert_eq!(
        flags_at(&slot(&engine, second, spawned.index())),
        FLAG_HAS_TRANSFORM
    );
    assert_eq!(
        flags_at(&slot(&engine, second, bulk_index)),
        FLAG_HAS_TRANSFORM
    );
    Ok(())
}

#[test]
fn reparent_sets_the_teleport_bit_on_one_commit_only() -> Result<(), CoreError> {
    let mut engine = Engine::new(4)?;
    let parent = engine.create_entity()?;
    let child = engine.create_entity()?;
    engine.add_entity_transform(parent.index(), 0.0, 0.0, 0.0, 1.0, 1.0);
    engine.add_entity_transform(child.index(), 1.0, 0.0, 0.0, 1.0, 1.0);
    engine.update_transforms();
    let _ = engine.transform_history_commit()?;
    let cleared = engine.transform_history_commit()?;
    assert_eq!(
        flags_at(&slot(&engine, cleared, child.index())),
        FLAG_HAS_TRANSFORM
    );

    let refused = engine.set_entity_parent(child.index(), child.index(), false);
    assert_eq!(u8::from(refused.is_err()), 1);
    let after_refusal = engine.transform_history_commit()?;
    assert_eq!(
        flags_at(&slot(&engine, after_refusal, child.index())),
        FLAG_HAS_TRANSFORM
    );

    engine.set_entity_parent(child.index(), parent.index(), false)?;
    let snapped = engine.transform_history_commit()?;
    assert_eq!(
        flags_at(&slot(&engine, snapped, child.index())),
        FLAG_HAS_TRANSFORM | FLAG_TELEPORT
    );
    let done = engine.transform_history_commit()?;
    assert_eq!(
        flags_at(&slot(&engine, done, child.index())),
        FLAG_HAS_TRANSFORM
    );
    Ok(())
}

#[test]
fn mark_entity_teleport_sets_the_bit_on_one_commit_only() -> Result<(), CoreError> {
    let mut engine = Engine::new(4)?;
    let id = engine.create_entity()?;
    engine.add_entity_transform(id.index(), 1.0, 1.0, 0.0, 1.0, 1.0);
    engine.update_transforms();
    let _ = engine.transform_history_commit()?;
    let cleared = engine.transform_history_commit()?;
    assert_eq!(
        flags_at(&slot(&engine, cleared, id.index())),
        FLAG_HAS_TRANSFORM
    );

    engine.mark_entity_teleport(id.index());
    engine.mark_entity_teleport(id.index());
    let snapped = engine.transform_history_commit()?;
    assert_eq!(
        flags_at(&slot(&engine, snapped, id.index())),
        FLAG_HAS_TRANSFORM | FLAG_TELEPORT
    );
    let done = engine.transform_history_commit()?;
    assert_eq!(
        flags_at(&slot(&engine, done, id.index())),
        FLAG_HAS_TRANSFORM
    );
    Ok(())
}

#[test]
fn history_ptr_is_zero_before_the_first_commit_and_for_buffer_2() -> Result<(), CoreError> {
    let mut engine = Engine::new(4)?;
    assert_eq!(engine.transform_history_ptr(0), 0);
    assert_eq!(engine.transform_history_ptr(1), 0);
    assert_eq!(engine.transform_history_ptr(2), 0);

    let first = engine.transform_history_commit()?;
    assert_eq!(first, 0);
    assert_ne!(engine.transform_history_ptr(0), 0);
    assert_ne!(engine.transform_history_ptr(1), 0);
    assert_ne!(
        engine.transform_history_ptr(0),
        engine.transform_history_ptr(1)
    );
    assert_eq!(engine.transform_history_ptr(2), 0);

    let mut other = Engine::new(4)?;
    let _ = engine.transform_history_commit()?;
    assert_eq!(other.transform_history_ptr(0), 0);
    assert_eq!(other.transform_history_commit()?, 0);
    Ok(())
}

#[test]
fn commit_before_any_transform_zeroes_every_slot() -> Result<(), CoreError> {
    let mut engine = Engine::new(4)?;
    engine.mark_entity_teleport(0);
    engine.mark_entity_teleport(99);
    let buffer = engine.transform_history_commit()?;
    assert_eq!(buffer, 0);
    assert_eq!(slot(&engine, buffer, 0), [0u8; SLOT_BYTES]);
    assert_eq!(slot(&engine, buffer, 3), [0u8; SLOT_BYTES]);
    let next = engine.transform_history_commit()?;
    assert_eq!(next, 1);
    assert_eq!(slot(&engine, next, 0), [0u8; SLOT_BYTES]);
    Ok(())
}

#[test]
fn destroy_zeroes_the_slot_on_the_next_commit() -> Result<(), CoreError> {
    let mut engine = Engine::new(4)?;
    let id = engine.create_entity()?;
    engine.add_entity_transform(id.index(), 3.0, 4.0, 0.0, 1.0, 1.0);
    engine.update_transforms();
    let written = engine.transform_history_commit()?;
    assert_eq!(f32_at(&slot(&engine, written, id.index()), 0), 3.0);
    assert_eq!(
        u8::from(engine.delete_entity(id.index(), id.generation())),
        1
    );
    let cleared = engine.transform_history_commit()?;
    assert_eq!(slot(&engine, cleared, id.index()), [0u8; SLOT_BYTES]);
    assert_eq!(f32_at(&slot(&engine, written, id.index()), 0), 3.0);
    Ok(())
}
