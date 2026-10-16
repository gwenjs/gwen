//! Native behaviour of the chunked archetype store.

use gwen_core::chunk_store::{
    ChunkStore, EntityLocation, CHUNK_ROWS, LAYOUT_REASON_BAD_LEN, LAYOUT_REASON_TOO_MANY_LANES,
    LAYOUT_REASON_UNKNOWN_LANE, LAYOUT_REASON_UNREGISTERED_TYPE, MAX_ARCHETYPES,
};
use gwen_core::{CoreError, MAX_COMPONENT_TYPES, MAX_ENTITIES_LIMIT};

fn open(max_entities: u32) -> Result<ChunkStore, CoreError> {
    ChunkStore::new(max_entities)
}

fn le4(value: u32) -> [u8; 4] {
    value.to_le_bytes()
}

fn row4(
    store: &ChunkStore,
    index: u32,
    generation: u32,
    type_id: u32,
) -> Result<[u8; 4], CoreError> {
    let mut buf = [0u8; 4];
    let copied = store.copy_row(index, generation, type_id, &mut buf);
    assert_eq!(copied, true);
    Ok(buf)
}

fn require_loc(store: &ChunkStore, index: u32) -> Result<EntityLocation, CoreError> {
    let loc = store.location(index);
    assert_eq!(loc.is_some(), true);
    match loc {
        Some(loc) => Ok(loc),
        None => Ok(EntityLocation { chunk: 0, row: 0 }),
    }
}

fn assert_boundaries(store: &ChunkStore) {
    let mut live = 0u32;
    for id in 0..store.chunk_slot_count() {
        let len = store.chunk_len(id);
        let awake = store.chunk_awake(id);
        if len.is_none() && awake.is_none() {
            continue;
        }
        live = live.saturating_add(1);
        assert_eq!(len.is_some(), true);
        assert_eq!(awake.is_some(), true);
        let (Some(len), Some(awake)) = (len, awake) else {
            continue;
        };
        assert_eq!(u32::from(awake > len), 0);
        for row in 0..awake {
            let entity = store.chunk_entity(id, row);
            assert_eq!(entity.is_some(), true);
            if let Some((index, generation)) = entity {
                assert_eq!(store.is_dormant(index, generation), Some(false));
            }
        }
        for row in awake..len {
            let entity = store.chunk_entity(id, row);
            assert_eq!(entity.is_some(), true);
            if let Some((index, generation)) = entity {
                assert_eq!(store.is_dormant(index, generation), Some(true));
            }
        }
    }
    assert_eq!(u32::from(live > 0), 1);
}

#[test]
fn set_dormant_swaps_across_the_boundary_and_fixes_both_locations() -> Result<(), CoreError> {
    let mut store = open(4)?;
    let kind = store.register(&[0])?;
    assert_eq!(store.add(0, 0, kind, &le4(10))?, true);
    assert_eq!(store.add(1, 0, kind, &le4(11))?, true);
    assert_eq!(store.set_dormant(0, 0, true)?, true);
    let first = require_loc(&store, 0)?;
    let second = require_loc(&store, 1)?;
    assert_eq!(first.row, 1);
    assert_eq!(second.row, 0);
    assert_eq!(store.chunk_entity(first.chunk, 0), Some((1, 0)));
    assert_eq!(store.chunk_entity(first.chunk, 1), Some((0, 0)));
    assert_eq!(store.chunk_awake(first.chunk), Some(1));
    assert_eq!(store.chunk_len(first.chunk), Some(2));
    assert_eq!(store.is_dormant(0, 0), Some(true));
    assert_eq!(store.is_dormant(1, 0), Some(false));
    assert_eq!(row4(&store, 0, 0, kind)?, le4(10));
    assert_eq!(row4(&store, 1, 0, kind)?, le4(11));
    Ok(())
}

#[test]
fn dormant_row_survives_a_migration() -> Result<(), CoreError> {
    let mut store = open(4)?;
    let position = store.register(&[0])?;
    let velocity = store.register(&[0, 0])?;
    assert_eq!(store.add(1, 0, position, &le4(2))?, true);
    assert_eq!(store.add(1, 0, velocity, &[3, 0, 0, 0, 4, 0, 0, 0])?, true);
    assert_eq!(store.add(0, 0, position, &le4(1))?, true);
    assert_eq!(store.set_dormant(0, 0, true)?, true);
    let before = store.generation();
    assert_eq!(store.add(0, 0, velocity, &[5, 0, 0, 0, 6, 0, 0, 0])?, true);
    assert_eq!(store.generation(), before.wrapping_add(1));
    assert_eq!(store.is_dormant(0, 0), Some(true));
    assert_eq!(store.is_dormant(1, 0), Some(false));
    assert_eq!(row4(&store, 0, 0, position)?, le4(1));
    let loc = require_loc(&store, 0)?;
    let awake = store.chunk_awake(loc.chunk);
    assert_eq!(awake.is_some(), true);
    if let Some(awake) = awake {
        assert_eq!(u32::from(loc.row >= awake), 1);
    }
    assert_boundaries(&store);
    Ok(())
}

#[test]
fn hole_fill_from_a_dormant_last_row_stays_dormant() -> Result<(), CoreError> {
    let mut store = open(4)?;
    let kind = store.register(&[0])?;
    assert_eq!(store.add(0, 0, kind, &le4(1))?, true);
    assert_eq!(store.add(1, 0, kind, &le4(2))?, true);
    assert_eq!(store.add(2, 0, kind, &le4(3))?, true);
    assert_eq!(store.set_dormant(2, 0, true)?, true);
    assert_eq!(store.remove(0, 0, kind)?, true);
    assert_eq!(store.location(0), None);
    assert_eq!(store.is_dormant(2, 0), Some(true));
    assert_eq!(store.is_dormant(1, 0), Some(false));
    assert_eq!(row4(&store, 2, 0, kind)?, le4(3));
    assert_eq!(row4(&store, 1, 0, kind)?, le4(2));
    let loc = require_loc(&store, 2)?;
    let awake = store.chunk_awake(loc.chunk);
    if let Some(awake) = awake {
        assert_eq!(u32::from(loc.row >= awake), 1);
    }
    assert_boundaries(&store);
    Ok(())
}

#[test]
fn delete_of_a_dormant_row_drops_it_and_keeps_the_awake_row() -> Result<(), CoreError> {
    let mut store = open(4)?;
    let kind = store.register(&[0])?;
    assert_eq!(store.add(0, 0, kind, &le4(1))?, true);
    assert_eq!(store.add(1, 0, kind, &le4(2))?, true);
    assert_eq!(store.set_dormant(1, 0, true)?, true);
    let generation = store.generation();
    assert_eq!(store.delete_entity(1, 0), true);
    assert_eq!(store.slot_generation(1), Some(1));
    assert_eq!(store.location(1), None);
    assert_eq!(store.is_dormant(1, 1), None);
    assert_eq!(store.is_dormant(0, 0), Some(false));
    assert_eq!(row4(&store, 0, 0, kind)?, le4(1));
    let loc = require_loc(&store, 0)?;
    assert_eq!(store.chunk_len(loc.chunk), Some(1));
    assert_eq!(store.chunk_awake(loc.chunk), Some(1));
    assert_eq!(store.generation(), generation.wrapping_add(1));
    Ok(())
}

#[test]
fn set_dormant_same_state_is_a_no_op() -> Result<(), CoreError> {
    let mut store = open(4)?;
    let kind = store.register(&[0])?;
    assert_eq!(store.add(0, 0, kind, &le4(1))?, true);
    assert_eq!(store.add(1, 0, kind, &le4(2))?, true);
    assert_eq!(store.set_dormant(0, 0, true)?, true);
    let generation = store.generation();
    let first = require_loc(&store, 0)?;
    let second = require_loc(&store, 1)?;
    assert_eq!(store.set_dormant(0, 0, true)?, true);
    assert_eq!(store.generation(), generation);
    assert_eq!(store.location(0), Some(first));
    assert_eq!(store.location(1), Some(second));
    assert_eq!(store.set_dormant(1, 0, false)?, true);
    assert_eq!(store.generation(), generation);
    assert_eq!(store.location(1), Some(second));
    Ok(())
}

#[test]
fn awake_count_never_exceeds_len() -> Result<(), CoreError> {
    let mut store = open(8)?;
    let kind = store.register(&[0])?;
    for index in 0..4 {
        assert_eq!(store.add(index, 0, kind, &le4(index))?, true);
    }
    assert_eq!(store.set_dormant(1, 0, true)?, true);
    assert_eq!(store.set_dormant(2, 0, true)?, true);
    assert_eq!(store.remove(0, 0, kind)?, true);
    assert_eq!(store.set_dormant(3, 0, true)?, true);
    assert_eq!(store.set_dormant(3, 0, false)?, true);
    assert_boundaries(&store);
    Ok(())
}

#[test]
fn a_dormant_row_never_appears_in_the_awake_prefix() -> Result<(), CoreError> {
    let mut store = open(4)?;
    let kind = store.register(&[0])?;
    assert_eq!(store.add(0, 0, kind, &le4(1))?, true);
    assert_eq!(store.add(1, 0, kind, &le4(2))?, true);
    assert_eq!(store.add(2, 0, kind, &le4(3))?, true);
    assert_eq!(store.set_dormant(1, 0, true)?, true);
    let loc = require_loc(&store, 1)?;
    let awake = store.chunk_awake(loc.chunk);
    assert_eq!(awake, Some(2));
    if let Some(awake) = awake {
        assert_eq!(u32::from(loc.row >= awake), 1);
        for row in 0..awake {
            assert_eq!(store.chunk_entity(loc.chunk, row) == Some((1, 0)), false);
        }
    }
    assert_boundaries(&store);
    Ok(())
}

#[test]
fn cross_chunk_fill_at_row_1024_fixes_the_moved_entity() -> Result<(), CoreError> {
    let mut store = open(2048)?;
    let kind = store.register(&[0])?;
    for index in 0..1025 {
        assert_eq!(store.add(index, 0, kind, &le4(index))?, true);
    }
    let tail = require_loc(&store, 1024)?;
    assert_eq!(tail.row, 0);
    assert_eq!(store.chunk_len(tail.chunk), Some(1));
    assert_eq!(store.archetype_chunk_count(0), Some(2));
    assert_eq!(store.remove(0, 0, kind)?, true);
    let moved = require_loc(&store, 1024)?;
    assert_eq!(moved.row, 0);
    assert_eq!(moved.chunk == tail.chunk, false);
    assert_eq!(row4(&store, 1024, 0, kind)?, le4(1024));
    assert_eq!(store.archetype_chunk_count(0), Some(1));
    assert_eq!(store.chunk_len(moved.chunk), Some(CHUNK_ROWS as u16));
    assert_eq!(store.chunk_len(tail.chunk), None);
    assert_eq!(store.location(0), None);
    Ok(())
}

#[test]
fn kept_lanes_stay_byte_identical_after_migration() -> Result<(), CoreError> {
    let mut store = open(4)?;
    let position = store.register(&[0])?;
    let velocity = store.register(&[0, 0])?;
    assert_eq!(store.add(0, 0, position, &[1, 2, 3, 4])?, true);
    assert_eq!(store.add(1, 0, position, &[9, 9, 9, 9])?, true);
    assert_eq!(store.add(0, 0, velocity, &[5, 6, 7, 8, 4, 3, 2, 1])?, true);
    assert_eq!(row4(&store, 0, 0, position)?, [1, 2, 3, 4]);
    assert_eq!(row4(&store, 1, 0, position)?, [9, 9, 9, 9]);
    let mut velocity_bytes = [0u8; 8];
    assert_eq!(store.copy_row(0, 0, velocity, &mut velocity_bytes), true);
    assert_eq!(velocity_bytes, [5, 6, 7, 8, 4, 3, 2, 1]);
    Ok(())
}

#[test]
fn generation_bumps_on_a_structural_change_and_not_on_a_lane_write() -> Result<(), CoreError> {
    let mut store = open(4)?;
    assert_eq!(store.generation(), 0);
    let kind = store.register(&[0])?;
    let other = store.register(&[4])?;
    assert_eq!(store.generation(), 0);
    assert_eq!(store.add(0, 0, kind, &le4(1))?, true);
    assert_eq!(store.generation(), 1);
    assert_eq!(store.add(1, 0, kind, &le4(2))?, true);
    assert_eq!(store.generation(), 2);
    assert_eq!(store.add(0, 0, kind, &le4(7))?, true);
    assert_eq!(store.generation(), 2);
    assert_eq!(row4(&store, 0, 0, kind)?, le4(7));
    let mut staging = [0u8; 4];
    staging.copy_from_slice(&le4(8));
    store.staging_mut()[..4].copy_from_slice(&staging);
    assert_eq!(store.write_staged(0, 0, kind)?, true);
    assert_eq!(store.generation(), 2);
    assert_eq!(row4(&store, 0, 0, kind)?, le4(8));
    store.staging_mut()[..4].fill(0);
    assert_eq!(store.read_staged(1, 0, kind), true);
    assert_eq!(store.generation(), 2);
    assert_eq!(store.staging()[..4], le4(2));
    assert_eq!(store.set_dormant(0, 0, true)?, true);
    assert_eq!(store.generation(), 3);
    assert_eq!(store.set_dormant(0, 0, true)?, true);
    assert_eq!(store.generation(), 3);
    assert_eq!(store.set_dormant(0, 0, false)?, true);
    assert_eq!(store.generation(), 4);
    assert_eq!(store.add(0, 0, other, &[1])?, true);
    assert_eq!(store.generation(), 5);
    assert_eq!(store.remove(0, 0, other)?, true);
    assert_eq!(store.generation(), 6);
    assert_eq!(store.delete_entity(1, 0), true);
    assert_eq!(store.generation(), 7);
    Ok(())
}

#[test]
fn component_layout_invalid_leaves_the_store_unchanged() -> Result<(), CoreError> {
    let mut store = open(4)?;
    let kind = store.register(&[0])?;
    assert_eq!(store.add(0, 0, kind, &le4(4))?, true);
    let generation = store.generation();
    let layouts = store.layout_count();
    let archetypes = store.archetype_count();
    let loc = require_loc(&store, 0)?;
    assert_eq!(
        store.register(&[8]),
        Err(CoreError::ComponentLayoutInvalid {
            type_id: 1,
            reason: LAYOUT_REASON_UNKNOWN_LANE,
        })
    );
    let mut too_many = [0u8; 65];
    too_many[0] = 0;
    assert_eq!(
        store.register(&too_many),
        Err(CoreError::ComponentLayoutInvalid {
            type_id: 1,
            reason: LAYOUT_REASON_TOO_MANY_LANES,
        })
    );
    assert_eq!(
        store.add(0, 0, 9, &le4(1)),
        Err(CoreError::ComponentLayoutInvalid {
            type_id: 9,
            reason: LAYOUT_REASON_UNREGISTERED_TYPE,
        })
    );
    assert_eq!(
        store.add(0, 0, kind, &[1, 2, 3]),
        Err(CoreError::ComponentLayoutInvalid {
            type_id: kind,
            reason: LAYOUT_REASON_BAD_LEN,
        })
    );
    assert_eq!(store.generation(), generation);
    assert_eq!(store.layout_count(), layouts);
    assert_eq!(store.archetype_count(), archetypes);
    assert_eq!(store.location(0), Some(loc));
    assert_eq!(row4(&store, 0, 0, kind)?, le4(4));
    Ok(())
}

#[test]
fn archetype_limit_leaves_the_store_unchanged() -> Result<(), CoreError> {
    let mut store = open(4)?;
    let mut ids = [0u32; 13];
    for (bit, id) in ids.iter_mut().enumerate() {
        let registered = store.register(&[4])?;
        assert_eq!(registered, bit as u32);
        *id = registered;
    }
    let mut mask = 0u32;
    for step in 1..=MAX_ARCHETYPES {
        let next = step ^ (step >> 1);
        let diff = mask ^ next;
        let bit = diff.trailing_zeros();
        let type_id = ids.get(bit as usize).copied();
        assert_eq!(type_id.is_some(), true);
        let Some(type_id) = type_id else {
            return Ok(());
        };
        if next & diff == 0 {
            assert_eq!(store.remove(0, 0, type_id)?, true);
        } else {
            assert_eq!(store.add(0, 0, type_id, &[1])?, true);
        }
        mask = next;
    }
    assert_eq!(store.archetype_count(), MAX_ARCHETYPES);
    let generation = store.generation();
    let next = (MAX_ARCHETYPES + 1) ^ ((MAX_ARCHETYPES + 1) >> 1);
    let diff = mask ^ next;
    let bit = diff.trailing_zeros();
    let type_id = ids.get(bit as usize).copied();
    assert_eq!(type_id.is_some(), true);
    let Some(type_id) = type_id else {
        return Ok(());
    };
    let before = row_flag(&store, type_id);
    let refused = if next & diff == 0 {
        store.remove(0, 0, type_id)
    } else {
        store.add(0, 0, type_id, &[1])
    };
    assert_eq!(
        refused,
        Err(CoreError::ArchetypeLimitReached {
            max: MAX_ARCHETYPES,
        })
    );
    assert_eq!(store.archetype_count(), MAX_ARCHETYPES);
    assert_eq!(store.generation(), generation);
    assert_eq!(row_flag(&store, type_id), before);
    assert_eq!(store.layout_count(), 13);
    Ok(())
}

fn row_flag(store: &ChunkStore, type_id: u32) -> Option<u8> {
    let mut buf = [0u8; 1];
    if store.copy_row(0, 0, type_id, &mut buf) {
        Some(buf[0])
    } else {
        None
    }
}

#[test]
fn the_129th_component_type_is_refused() -> Result<(), CoreError> {
    let mut store = open(2)?;
    for index in 0..MAX_COMPONENT_TYPES {
        let id = store.register(&[4])?;
        assert_eq!(id, index);
    }
    assert_eq!(
        store.register(&[4]),
        Err(CoreError::ComponentTypeLimitReached {
            max: MAX_COMPONENT_TYPES,
        })
    );
    assert_eq!(store.layout_count(), MAX_COMPONENT_TYPES);
    assert_eq!(store.archetype_count(), 0);
    assert_eq!(store.generation(), 0);
    Ok(())
}

#[test]
fn lane_pointers_stay_put_over_10_000_inserts() -> Result<(), CoreError> {
    let mut store = open(10_000)?;
    let kind = store.register(&[0])?;
    assert_eq!(store.add(0, 0, kind, &le4(1))?, true);
    let lane = store.lane_ptr(0, 0);
    let entities = store.entity_index_ptr(0);
    assert_eq!(lane.is_some(), true);
    assert_eq!(entities.is_some(), true);
    let Some(lane) = lane else {
        return Ok(());
    };
    let Some(entities) = entities else {
        return Ok(());
    };
    assert_eq!(lane % 8, 0);
    for index in 1..10_000 {
        assert_eq!(store.add(index, 0, kind, &le4(index))?, true);
    }
    assert_eq!(store.lane_ptr(0, 0), Some(lane));
    assert_eq!(store.entity_index_ptr(0), Some(entities));
    assert_eq!(store.chunk_len(0), Some(CHUNK_ROWS as u16));
    let extra = store.lane_ptr(1, 0);
    assert_eq!(extra.is_some(), true);
    if let Some(extra) = extra {
        assert_eq!(extra % 8, 0);
        assert_eq!(extra == lane, false);
    }
    Ok(())
}

#[test]
fn an_empty_chunk_is_freed_except_the_last_one() -> Result<(), CoreError> {
    let mut store = open(4)?;
    let kind = store.register(&[0])?;
    assert_eq!(store.add(0, 0, kind, &le4(1))?, true);
    assert_eq!(store.add(1, 0, kind, &le4(2))?, true);
    assert_eq!(store.delete_entity(0, 0), true);
    assert_eq!(store.delete_entity(1, 1), false);
    assert_eq!(store.delete_entity(1, 0), true);
    assert_eq!(store.archetype_chunk_count(0), Some(1));
    assert_eq!(store.chunk_len(0), Some(0));
    assert_eq!(store.chunk_awake(0), Some(0));

    let mut wide = open(2048)?;
    let kind = wide.register(&[0])?;
    for index in 0..1025 {
        assert_eq!(wide.add(index, 0, kind, &le4(index))?, true);
    }
    assert_eq!(wide.archetype_chunk_count(0), Some(2));
    for index in 0..1025 {
        assert_eq!(wide.delete_entity(index, 0), true);
    }
    assert_eq!(wide.archetype_chunk_count(0), Some(1));
    let mut live = 0u32;
    for id in 0..wide.chunk_slot_count() {
        if wide.chunk_len(id).is_some() {
            live = live.saturating_add(1);
            assert_eq!(wide.chunk_len(id), Some(0));
            assert_eq!(wide.chunk_awake(id), Some(0));
        }
    }
    assert_eq!(live, 1);
    Ok(())
}

#[test]
fn a_recycled_slot_is_born_awake() -> Result<(), CoreError> {
    let mut store = open(2)?;
    let kind = store.register(&[0])?;
    assert_eq!(store.add(0, 0, kind, &le4(1))?, true);
    assert_eq!(store.set_dormant(0, 0, true)?, true);
    assert_eq!(store.delete_entity(0, 0), true);
    assert_eq!(store.slot_generation(0), Some(1));
    assert_eq!(store.add(0, 1, kind, &le4(2))?, true);
    assert_eq!(store.is_dormant(0, 1), Some(false));
    assert_eq!(store.add(0, 0, kind, &le4(3))?, false);
    assert_eq!(row4(&store, 0, 1, kind)?, le4(2));
    Ok(())
}

#[test]
fn an_added_row_is_awake_beside_a_dormant() -> Result<(), CoreError> {
    let mut store = open(4)?;
    let kind = store.register(&[0])?;
    assert_eq!(store.add(0, 0, kind, &le4(1))?, true);
    assert_eq!(store.set_dormant(0, 0, true)?, true);
    assert_eq!(store.add(1, 0, kind, &le4(2))?, true);
    assert_eq!(store.is_dormant(0, 0), Some(true));
    assert_eq!(store.is_dormant(1, 0), Some(false));
    let added = require_loc(&store, 1)?;
    let awake = store.chunk_awake(added.chunk);
    if let Some(awake) = awake {
        assert_eq!(u32::from(added.row < awake), 1);
    }
    assert_boundaries(&store);
    Ok(())
}

#[test]
fn staged_read_and_write_round_trip_in_place() -> Result<(), CoreError> {
    let mut store = open(2)?;
    let kind = store.register(&[0])?;
    assert_eq!(store.add(0, 0, kind, &le4(1))?, true);
    let generation = store.generation();
    store.staging_mut()[..4].copy_from_slice(&le4(9));
    assert_eq!(store.write_staged(0, 0, kind)?, true);
    assert_eq!(store.generation(), generation);
    assert_eq!(row4(&store, 0, 0, kind)?, le4(9));
    store.staging_mut()[..4].fill(0);
    assert_eq!(store.read_staged(0, 0, kind), true);
    assert_eq!(store.staging()[..4], le4(9));
    assert_eq!(store.generation(), generation);
    let mut staged = [0u8; 4];
    staged.copy_from_slice(&store.staging()[..4]);
    assert_eq!(store.read_staged(0, 1, kind), false);
    assert_eq!(&store.staging()[..4], &staged);
    assert_eq!(store.write_staged(0, 1, kind)?, false);
    assert_eq!(row4(&store, 0, 0, kind)?, le4(9));
    Ok(())
}

#[test]
fn a_stale_generation_changes_nothing() -> Result<(), CoreError> {
    let mut store = open(2)?;
    let kind = store.register(&[0])?;
    assert_eq!(store.add(0, 0, kind, &le4(1))?, true);
    let generation = store.generation();
    let loc = require_loc(&store, 0)?;
    assert_eq!(store.add(0, 1, kind, &le4(2))?, false);
    assert_eq!(store.remove(0, 1, kind)?, false);
    assert_eq!(store.set_dormant(0, 1, true)?, false);
    assert_eq!(store.delete_entity(0, 1), false);
    assert_eq!(store.generation(), generation);
    assert_eq!(store.location(0), Some(loc));
    assert_eq!(store.slot_generation(0), Some(0));
    assert_eq!(row4(&store, 0, 0, kind)?, le4(1));
    Ok(())
}

#[test]
fn two_stores_do_not_share_rows() -> Result<(), CoreError> {
    let mut left = open(2)?;
    let mut right = open(2)?;
    let left_kind = left.register(&[0])?;
    let right_kind = right.register(&[0])?;
    assert_eq!(left.add(0, 0, left_kind, &le4(1))?, true);
    assert_eq!(right.copy_row(0, 0, right_kind, &mut [0u8; 4]), false);
    assert_eq!(right.archetype_count(), 0);
    assert_eq!(right.generation(), 0);
    assert_eq!(row4(&left, 0, 0, left_kind)?, le4(1));
    Ok(())
}

#[test]
fn new_rejects_zero_and_the_limit_plus_one() -> Result<(), CoreError> {
    assert_eq!(
        ChunkStore::new(0).err(),
        Some(CoreError::InvalidMaxEntities {
            value: 0,
            max: MAX_ENTITIES_LIMIT,
        })
    );
    assert_eq!(
        ChunkStore::new(MAX_ENTITIES_LIMIT + 1).err(),
        Some(CoreError::InvalidMaxEntities {
            value: MAX_ENTITIES_LIMIT + 1,
            max: MAX_ENTITIES_LIMIT,
        })
    );
    let small = ChunkStore::new(1)?;
    assert_eq!(small.max_entities(), 1);
    let full = ChunkStore::new(MAX_ENTITIES_LIMIT)?;
    assert_eq!(full.max_entities(), MAX_ENTITIES_LIMIT);
    Ok(())
}

#[test]
fn remove_of_an_absent_type_changes_nothing() -> Result<(), CoreError> {
    let mut store = open(2)?;
    let kind = store.register(&[0])?;
    let other = store.register(&[4])?;
    assert_eq!(store.add(0, 0, kind, &le4(1))?, true);
    let generation = store.generation();
    let loc = require_loc(&store, 0)?;
    assert_eq!(store.remove(0, 0, other)?, false);
    assert_eq!(store.generation(), generation);
    assert_eq!(store.location(0), Some(loc));
    assert_eq!(row4(&store, 0, 0, kind)?, le4(1));
    assert_eq!(store.archetype_count(), 1);
    Ok(())
}

#[test]
fn cross_chunk_dormant_fill_stays_dormant() -> Result<(), CoreError> {
    let mut store = open(2048)?;
    let kind = store.register(&[0])?;
    for index in 0..1025 {
        assert_eq!(store.add(index, 0, kind, &le4(index))?, true);
    }
    assert_eq!(store.set_dormant(1024, 0, true)?, true);
    assert_eq!(store.remove(0, 0, kind)?, true);
    assert_eq!(store.is_dormant(1024, 0), Some(true));
    assert_eq!(row4(&store, 1024, 0, kind)?, le4(1024));
    let loc = require_loc(&store, 1024)?;
    let awake = store.chunk_awake(loc.chunk);
    assert_eq!(awake.is_some(), true);
    if let Some(awake) = awake {
        assert_eq!(u32::from(loc.row >= awake), 1);
    }
    assert_eq!(store.archetype_chunk_count(0), Some(1));
    assert_eq!(store.chunk_len(loc.chunk), Some(CHUNK_ROWS as u16));
    assert_boundaries(&store);
    Ok(())
}

#[test]
fn an_index_past_the_table_changes_nothing() -> Result<(), CoreError> {
    let mut store = open(2)?;
    let kind = store.register(&[0])?;
    assert_eq!(store.generation(), 0);
    assert_eq!(
        store.add(2, 0, kind, &le4(1)),
        Err(CoreError::InvalidMaxEntities { value: 2, max: 2 })
    );
    assert_eq!(
        store.remove(2, 0, kind),
        Err(CoreError::InvalidMaxEntities { value: 2, max: 2 })
    );
    assert_eq!(
        store.set_dormant(2, 0, true),
        Err(CoreError::InvalidMaxEntities { value: 2, max: 2 })
    );
    assert_eq!(
        store.write_staged(2, 0, kind),
        Err(CoreError::InvalidMaxEntities { value: 2, max: 2 })
    );
    assert_eq!(store.delete_entity(2, 0), false);
    assert_eq!(store.read_staged(2, 0, kind), false);
    assert_eq!(store.archetype_count(), 0);
    assert_eq!(store.generation(), 0);
    assert_eq!(store.layout_count(), 1);
    Ok(())
}

#[test]
fn sixty_four_lanes_fit_and_sixty_five_do_not() -> Result<(), CoreError> {
    let mut store = open(2)?;
    let wide = [6u8; 64];
    let id = store.register(&wide)?;
    assert_eq!(store.layout(id).map(|layout| layout.row_bytes), Some(512));
    assert_eq!(store.layout_count(), 1);
    let too_many = [6u8; 65];
    assert_eq!(
        store.register(&too_many),
        Err(CoreError::ComponentLayoutInvalid {
            type_id: 1,
            reason: LAYOUT_REASON_TOO_MANY_LANES,
        })
    );
    assert_eq!(store.layout_count(), 1);
    let mut bytes = [0u8; 512];
    bytes[0] = 7;
    assert_eq!(store.add(0, 0, id, &bytes)?, true);
    let mut out = [0u8; 512];
    assert_eq!(store.copy_row(0, 0, id, &mut out), true);
    assert_eq!(out[0], 7);
    assert_eq!(out[511], 0);
    Ok(())
}
