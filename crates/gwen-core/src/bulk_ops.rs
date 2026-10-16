//! Tier 1 bulk ECS operations — pure core, no physics dependency.
//!
//! This module provides the **data-transfer** layer for bulk WASM operations.
//! Entity selection is handled by the chunk query in `bindings.rs`; this
//! module fills `out_slots`/`out_gens` from the query result and performs a
//! single [`get_components_bulk`] call.
//!
//! # Frame pattern
//! ```text
//! JS → WASM: engine.query_read_bulk(type_ids, read_type_id, out_slots, out_gens, out_buf)
//!              ↳ chunk query → awake entity list
//!              ↳ fill_and_read_bulk → out_slots / out_gens / out_buf packed in one call
//! JS mutates out_buf in-place
//! JS → WASM: engine.query_write_bulk(slots, gens, write_type_id, out_buf)
//!              ↳ set_components_bulk → one write pass, one crossing
//! ```
//!
//! [`get_components_bulk`]: crate::bindings::Engine::get_components_bulk

use crate::bindings::{bulk_len_u32, Engine};
use crate::CoreError;

/// Fill `out_slots`/`out_gens` from a pre-queried entity list and bulk-read
/// one component type into `out_buf` — all without additional WASM crossings.
///
/// This is the inner half of [`Engine::query_read_bulk`]: entity selection
/// (via the chunk query) is done in the binding layer; this
/// function handles generation lookup and the packed component read.
///
/// # Arguments
/// * `engine`        — engine reference (for generation lookup + component read)
/// * `entity_slots`  — slice of entity slot indices from the archetype query result
/// * `read_type_id`  — component type whose bytes are packed into `out_buf`
/// * `out_slots`     — slot indices; same length as `out_gens`, and that length caps the count
/// * `out_gens`      — caller buffer for generations (same length as `out_slots`)
/// * `out_buf`       — caller buffer for component data
///
/// # Errors
///
/// Returns [`CoreError::BufferLengthMismatch`] before any write when
/// `out_gens` differs in length from `out_slots`. The buffer name is
/// `"gens"`, `expected` is the `out_slots` length, and `actual` is the
/// `out_gens` length.
///
/// # Returns
/// `(entity_count, bytes_written)` — entities processed and bytes written to `out_buf`.
/// `entity_count` is `min(entity_slots.len(), out_slots.len())` once the two
/// output slices have the same length.
///
/// A shorter equal-length pair truncates the result. A shorter `out_buf`
/// stops the component copy. There is no fixed entity cap. Pass buffers large
/// enough for the full result set, or partition the work.
pub fn fill_and_read_bulk(
    engine: &Engine,
    entity_slots: &[u32],
    read_type_id: u32,
    out_slots: &mut [u32],
    out_gens: &mut [u32],
    out_buf: &mut [u8],
) -> Result<(u32, u32), CoreError> {
    if out_slots.len() != out_gens.len() {
        return Err(CoreError::BufferLengthMismatch {
            buffer: "gens",
            expected: bulk_len_u32(out_slots.len()),
            actual: bulk_len_u32(out_gens.len()),
        });
    }

    let cap = out_slots.len();
    let count = entity_slots.len().min(cap);

    // Resolve generation for each slot and fill the output arrays.
    for i in 0..count {
        let slot = entity_slots[i];
        let gen = engine.entity_manager.get_generation(slot).unwrap_or(0);
        out_slots[i] = slot;
        out_gens[i] = gen;
    }

    if count == 0 {
        return Ok((0, 0));
    }

    // One get_components_bulk call — no further WASM crossings.
    let bytes = engine.get_components_bulk(
        &out_slots[..count],
        &out_gens[..count],
        read_type_id,
        out_buf,
    )?;

    Ok((count as u32, bytes))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    #![allow(
        clippy::unwrap_used,
        clippy::expect_used,
        clippy::panic,
        clippy::unreachable,
        clippy::todo,
        clippy::unimplemented,
        reason = "test-only code"
    )]
    use super::*;
    use crate::bindings::Engine;
    use crate::CoreError;

    fn make_engine() -> Engine {
        Engine::new(1000).expect("max entities")
    }

    #[test]
    fn test_fill_and_read_bulk_empty_entity_list() -> Result<(), CoreError> {
        let engine = make_engine();
        let mut out_slots = vec![0u32; 16];
        let mut out_gens = vec![0u32; 16];
        let mut out_buf = vec![0u8; 64];
        let (count, bytes) =
            fill_and_read_bulk(&engine, &[], 0, &mut out_slots, &mut out_gens, &mut out_buf)?;
        assert_eq!(count, 0);
        assert_eq!(bytes, 0);
        Ok(())
    }

    #[test]
    fn test_fill_and_read_bulk_resolves_generations() -> Result<(), CoreError> {
        let mut engine = make_engine();
        let type_id = engine.register_component(&[0])?;

        let e = engine.create_entity()?;
        engine.add_component(e.index(), e.generation(), type_id, &[7u8, 0, 0, 0])?;
        let mut out_slots = vec![0u32; 16];
        let mut out_gens = vec![0u32; 16];
        let mut out_buf = vec![0u8; 4];

        let (count, bytes) = fill_and_read_bulk(
            &engine,
            &[e.index()],
            type_id,
            &mut out_slots,
            &mut out_gens,
            &mut out_buf,
        )?;

        assert_eq!(count, 1);
        assert_eq!(bytes, 4);
        // Generation must be resolved correctly so get_components_bulk finds the entity.
        assert_eq!(out_gens[0], e.generation(), "generation must be resolved");
        assert_eq!(out_buf[0], 7, "component value must be read correctly");
        Ok(())
    }

    #[test]
    fn test_fill_and_read_bulk_roundtrip_three_entities() -> Result<(), CoreError> {
        let mut engine = make_engine();
        let type_id = engine.register_component(&[0])?;

        let e0 = engine.create_entity()?;
        let e1 = engine.create_entity()?;
        let e2 = engine.create_entity()?;

        let seed_slots = [e0.index(), e1.index(), e2.index()];
        let seed_gens = [e0.generation(), e1.generation(), e2.generation()];
        engine.set_components_bulk(
            &seed_slots,
            &seed_gens,
            type_id,
            &[1u8, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0],
        )?;

        let mut out_slots = vec![0u32; 16];
        let mut out_gens = vec![0u32; 16];
        let mut out_buf = vec![0u8; 12];

        let (count, bytes) = fill_and_read_bulk(
            &engine,
            &seed_slots,
            type_id,
            &mut out_slots,
            &mut out_gens,
            &mut out_buf,
        )?;

        assert_eq!(count, 3);
        assert_eq!(bytes, 12);
        assert_eq!(out_buf[0], 1);
        assert_eq!(out_buf[4], 2);
        assert_eq!(out_buf[8], 3);
        Ok(())
    }

    #[test]
    fn test_fill_and_read_bulk_respects_cap() -> Result<(), CoreError> {
        // More matches than the old 10_000 hard cap. Only the caller slices cap the result.
        const MATCHES: usize = 10_050;
        let mut engine = Engine::new(MATCHES as u32)?;
        let type_id = engine.register_component(&[0])?;
        let entity_slots: Vec<u32> = (0..MATCHES as u32).collect();

        for _ in 0..MATCHES {
            let e = engine.create_entity()?;
            engine.add_component(e.index(), e.generation(), type_id, &[0u8; 4])?;
        }

        let mut out_slots = vec![0u32; MATCHES];
        let mut out_gens = vec![0u32; MATCHES];
        let mut out_buf = vec![0u8; MATCHES * 4];

        let (count, _) = fill_and_read_bulk(
            &engine,
            &entity_slots,
            type_id,
            &mut out_slots,
            &mut out_gens,
            &mut out_buf,
        )?;

        assert_eq!(
            count, MATCHES as u32,
            "a caller buffer longer than 10_000 must receive every match"
        );

        let short = 25;
        let mut short_slots = vec![0u32; short];
        let mut short_gens = vec![0u32; short];
        let mut short_buf = vec![0u8; short * 4];

        let (short_count, _) = fill_and_read_bulk(
            &engine,
            &entity_slots,
            type_id,
            &mut short_slots,
            &mut short_gens,
            &mut short_buf,
        )?;

        assert_eq!(
            short_count, short as u32,
            "a shorter caller buffer returns that buffer's length, not 10_000"
        );
        assert_ne!(short_count, 10_000);
        Ok(())
    }
}
