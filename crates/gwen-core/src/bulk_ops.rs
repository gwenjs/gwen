//! Tier 1 bulk ECS operations — pure core, no physics dependency.
//!
//! This module provides the **data-transfer** layer for bulk WASM operations.
//! Entity selection is handled by the archetype-cached [`QuerySystem`] in
//! `bindings.rs`; this module fills `out_slots`/`out_gens` from the query
//! result and performs a single [`get_components_bulk`] call.
//!
//! # Frame pattern
//! ```text
//! JS → WASM: engine.query_read_bulk(type_ids, read_type_id, out_slots, out_gens, out_buf)
//!              ↳ QuerySystem (archetype-cached) → entity list
//!              ↳ fill_and_read_bulk → out_slots / out_gens / out_buf packed in one call
//! JS mutates out_buf in-place
//! JS → WASM: engine.query_write_bulk(slots, gens, write_type_id, out_buf)
//!              ↳ set_components_bulk → one write pass, one crossing
//! ```
//!
//! [`QuerySystem`]: crate::ecs::query::QuerySystem
//! [`get_components_bulk`]: crate::bindings::Engine::get_components_bulk

use crate::bindings::Engine;

/// Hard cap on entities processed by a single bulk call.
///
/// Matches the capacity of [`QUERY_RESULT_BUFFER`] in `bindings.rs`.
/// Both must be updated together if the buffer size changes.
///
/// [`QUERY_RESULT_BUFFER`]: crate::bindings
pub const BULK_MAX_ENTITIES: usize = 10_000;

/// Fill `out_slots`/`out_gens` from a pre-queried entity list and bulk-read
/// one component type into `out_buf` — all without additional WASM crossings.
///
/// This is the inner half of [`Engine::query_read_bulk`]: entity selection
/// (via the archetype `QuerySystem`) is done in the binding layer; this
/// function handles generation lookup and the packed component read.
///
/// # Arguments
/// * `engine`        — engine reference (for generation lookup + component read)
/// * `entity_slots`  — slice of entity slot indices from the archetype query result
/// * `read_type_id`  — component type whose bytes are packed into `out_buf`
/// * `out_slots`     — caller buffer for slot indices   (len ≥ `entity_slots.len()`)
/// * `out_gens`      — caller buffer for generations    (len ≥ `entity_slots.len()`)
/// * `out_buf`       — caller buffer for component data (len ≥ count × component_size)
///
/// # Returns
/// `(entity_count, bytes_written)` — entities processed and bytes written to `out_buf`.
/// `entity_count` is capped at `min(out_slots.len(), out_gens.len(), BULK_MAX_ENTITIES)`.
///
/// If `entity_count == BULK_MAX_ENTITIES`, the scene has more matching entities than
/// the buffer holds — the caller must partition the result set or increase buffer sizes.
pub fn fill_and_read_bulk(
    engine: &Engine,
    entity_slots: &[u32],
    read_type_id: u32,
    out_slots: &mut [u32],
    out_gens: &mut [u32],
    out_buf: &mut [u8],
) -> (u32, u32) {
    let cap = out_slots.len().min(out_gens.len()).min(BULK_MAX_ENTITIES);
    let count = entity_slots.len().min(cap);

    // Resolve generation for each slot and fill the output arrays.
    for i in 0..count {
        let slot = entity_slots[i];
        let gen = engine.entity_manager.get_generation(slot).unwrap_or(0);
        out_slots[i] = slot;
        out_gens[i] = gen;
    }

    if count == 0 {
        return (0, 0);
    }

    // One get_components_bulk call — no further WASM crossings.
    let bytes = engine.get_components_bulk(&out_slots[..count], &out_gens[..count], read_type_id, out_buf);

    (count as u32, bytes)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bindings::Engine;

    fn make_engine() -> Engine {
        Engine::new(1000)
    }

    #[test]
    fn test_fill_and_read_bulk_empty_entity_list() {
        let engine = make_engine();
        let mut out_slots = vec![0u32; 16];
        let mut out_gens = vec![0u32; 16];
        let mut out_buf = vec![0u8; 64];
        let (count, bytes) =
            fill_and_read_bulk(&engine, &[], 0, &mut out_slots, &mut out_gens, &mut out_buf);
        assert_eq!(count, 0);
        assert_eq!(bytes, 0);
    }

    #[test]
    fn test_fill_and_read_bulk_resolves_generations() {
        let mut engine = make_engine();
        let type_id = engine.register_component_type();

        let e = engine.create_entity();
        engine.add_component(e.index(), e.generation(), type_id, &[7u8, 0, 0, 0]);

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
        );

        assert_eq!(count, 1);
        assert_eq!(bytes, 4);
        // Generation must be resolved correctly so get_components_bulk finds the entity.
        assert_eq!(out_gens[0], e.generation(), "generation must be resolved");
        assert_eq!(out_buf[0], 7, "component value must be read correctly");
    }

    #[test]
    fn test_fill_and_read_bulk_roundtrip_three_entities() {
        let mut engine = make_engine();
        let type_id = engine.register_component_type();

        let e0 = engine.create_entity();
        let e1 = engine.create_entity();
        let e2 = engine.create_entity();

        let seed_slots = [e0.index(), e1.index(), e2.index()];
        let seed_gens  = [e0.generation(), e1.generation(), e2.generation()];
        engine.set_components_bulk(&seed_slots, &seed_gens, type_id, &[1u8,0,0,0, 2,0,0,0, 3,0,0,0]);

        let mut out_slots = vec![0u32; 16];
        let mut out_gens  = vec![0u32; 16];
        let mut out_buf   = vec![0u8; 12];

        let (count, bytes) = fill_and_read_bulk(
            &engine,
            &seed_slots,
            type_id,
            &mut out_slots,
            &mut out_gens,
            &mut out_buf,
        );

        assert_eq!(count, 3);
        assert_eq!(bytes, 12);
        assert_eq!(out_buf[0], 1);
        assert_eq!(out_buf[4], 2);
        assert_eq!(out_buf[8], 3);
    }

    #[test]
    fn test_fill_and_read_bulk_respects_cap() {
        let mut engine = Engine::new(BULK_MAX_ENTITIES as u32 + 100);
        let type_id = engine.register_component_type();
        let entity_slots: Vec<u32> = (0..(BULK_MAX_ENTITIES + 50) as u32).collect();

        // Spawn + add components
        for _ in 0..(BULK_MAX_ENTITIES + 50) {
            let e = engine.create_entity();
            engine.add_component(e.index(), e.generation(), type_id, &[0u8; 4]);
        }

        let mut out_slots = vec![0u32; BULK_MAX_ENTITIES];
        let mut out_gens  = vec![0u32; BULK_MAX_ENTITIES];
        let mut out_buf   = vec![0u8; BULK_MAX_ENTITIES * 4];

        let (count, _) = fill_and_read_bulk(
            &engine,
            &entity_slots,
            type_id,
            &mut out_slots,
            &mut out_gens,
            &mut out_buf,
        );

        assert_eq!(count, BULK_MAX_ENTITIES as u32, "must be capped at BULK_MAX_ENTITIES");
    }
}
