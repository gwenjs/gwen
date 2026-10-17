//! Engine exports over the chunk store.
//!
//! `query_chunks` stores addresses as `u32` words. Native tests read the table
//! through [`ChunkStore::query_table`]. The wasm32 export is checked in
//! `archetype-storage.test.ts`.

use gwen_core::bindings::Engine;
use gwen_core::chunk_store::ChunkStore;
use gwen_core::CoreError;

fn engine() -> Result<Engine, CoreError> {
    Engine::new(8)
}

#[test]
fn register_component_rejects_a_short_row_and_leaves_generation() -> Result<(), CoreError> {
    let mut engine = engine()?;
    let id = engine.create_entity()?;
    let position = engine.register_component(&[0])?;
    let generation = engine.storage_generation();
    let added = engine.add_component(id.index(), id.generation(), position, &[1]);
    assert_eq!(
        added.err().map(|err| err.code()),
        Some("CORE:COMPONENT_LAYOUT_INVALID")
    );
    assert_eq!(engine.storage_generation(), generation);
    assert_eq!(
        engine.get_component_raw(id.index(), id.generation(), position),
        Ok(Vec::<u8>::new())
    );
    Ok(())
}

#[test]
fn in_place_write_keeps_storage_generation_and_a_second_type_bumps_it() -> Result<(), CoreError> {
    let mut engine = engine()?;
    let id = engine.create_entity()?;
    let position = engine.register_component(&[0])?;
    let velocity = engine.register_component(&[0])?;
    assert_eq!(
        engine.add_component(id.index(), id.generation(), position, &1u32.to_le_bytes()),
        Ok(true)
    );
    let after_add = engine.storage_generation();
    assert_eq!(
        engine.add_component(id.index(), id.generation(), position, &4u32.to_le_bytes()),
        Ok(true)
    );
    assert_eq!(engine.storage_generation(), after_add);
    assert_eq!(
        engine.get_component_raw(id.index(), id.generation(), position),
        Ok(4u32.to_le_bytes().to_vec())
    );
    assert_eq!(
        engine.add_component(id.index(), id.generation(), velocity, &2u32.to_le_bytes()),
        Ok(true)
    );
    assert_eq!(engine.storage_generation(), after_add.wrapping_add(1));
    Ok(())
}

#[test]
fn set_entity_dormant_is_false_without_a_row_and_for_a_stale_generation() -> Result<(), CoreError> {
    let mut engine = engine()?;
    let id = engine.create_entity()?;
    let position = engine.register_component(&[0])?;
    assert_eq!(
        engine.set_entity_dormant(id.index(), id.generation(), true),
        Ok(false)
    );
    assert_eq!(
        engine.is_entity_dormant(id.index(), id.generation()),
        Ok(false)
    );
    assert_eq!(
        engine.add_component(id.index(), id.generation(), position, &1u32.to_le_bytes()),
        Ok(true)
    );
    assert_eq!(
        engine.set_entity_dormant(id.index(), id.generation(), true),
        Ok(true)
    );
    assert_eq!(
        engine.is_entity_dormant(id.index(), id.generation()),
        Ok(true)
    );
    assert_eq!(
        engine.set_entity_dormant(id.index(), id.generation().wrapping_add(1), false),
        Ok(false)
    );
    assert_eq!(
        engine.is_entity_dormant(id.index(), id.generation()),
        Ok(true)
    );
    Ok(())
}

#[test]
fn query_table_counts_awake_rows_and_skips_a_dormant_one() -> Result<(), CoreError> {
    let mut store = ChunkStore::new(8)?;
    let position = store.register(&[0, 0])?;
    assert_eq!(store.add(0, 0, position, &le_pair(1, 2)), Ok(true));
    assert_eq!(store.add(1, 0, position, &le_pair(3, 4)), Ok(true));
    assert_eq!(store.set_dormant(1, 0, true), Ok(true));
    let query = store.register_query(&[position])?;
    let words = store.query_chunks(query)?;
    let table = store.query_table(query).unwrap_or(&[]);
    assert_eq!(table.first().copied(), Some(1));
    assert_eq!(table.get(1).copied(), Some(store.generation()));
    assert_eq!(table.get(2).copied(), Some(4 + 2));
    assert_eq!(table.get(3).copied(), Some(1));
    assert_eq!(table.get(5).copied(), Some(1));
    let again = store.query_chunks(query)?;
    assert_eq!(again, words);
    assert_eq!(store.release_query(99), ());
    assert_eq!(
        store.query_chunks(99).err().map(|err| err.code()),
        Some("CORE:QUERY_INVALID")
    );
    Ok(())
}

fn le_pair(x: u32, y: u32) -> [u8; 8] {
    let mut bytes = [0u8; 8];
    bytes[..4].copy_from_slice(&x.to_le_bytes());
    bytes[4..].copy_from_slice(&y.to_le_bytes());
    bytes
}
