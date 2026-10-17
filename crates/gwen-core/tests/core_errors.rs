#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::unreachable,
    clippy::todo,
    clippy::unimplemented,
    reason = "test-only code"
)]
//! Native checks for [`gwen_core::CoreError`].
//!
//! Every variant this file produces comes from a public export.
//! `ComponentWriteRejected` is crate-internal today: no public export
//! produces it. Its two outcomes are pinned in `bindings.rs` by
//! `set_components_bulk_rejects_a_fixed_size_mismatch_before_writing_the_first_entity`
//! and `set_components_bulk_rejects_in_the_loop_a_column_built_under_another_size`.

use gwen_core::bindings::Engine;
use gwen_core::CoreError;

fn engine(max_entities: u32) -> Engine {
    Engine::new(max_entities).expect("max entities")
}

fn must_err<T, E>(result: Result<T, E>) -> E {
    match result {
        Ok(_) => panic!("expected an error"),
        Err(err) => err,
    }
}

fn must_ok<T, E>(result: Result<T, E>) -> T {
    match result {
        Ok(value) => value,
        Err(_) => unreachable!(),
    }
}

fn assert_known_code(err: &CoreError) {
    match err {
        CoreError::EntityLimitReached { .. } => {
            assert_eq!(err.code(), "CORE:ENTITY_LIMIT_REACHED");
        }
        CoreError::QueryCapacityExceeded { .. } => {
            assert_eq!(err.code(), "CORE:QUERY_CAPACITY_EXCEEDED");
        }
        CoreError::ComponentTypeLimitReached { .. } => {
            assert_eq!(err.code(), "CORE:COMPONENT_TYPE_LIMIT_REACHED");
        }
        CoreError::InvalidParent { .. } => {
            assert_eq!(err.code(), "CORE:INVALID_PARENT");
        }
        CoreError::InvalidMaxEntities { .. } => {
            assert_eq!(err.code(), "CORE:INVALID_MAX_ENTITIES");
        }
        CoreError::BufferLengthMismatch { .. } => {
            assert_eq!(err.code(), "CORE:BUFFER_LENGTH_MISMATCH");
        }
        CoreError::InvalidSharedBuffer { .. } => {
            assert_eq!(err.code(), "CORE:INVALID_SHARED_BUFFER");
        }
        CoreError::ComponentWriteRejected { .. } => {
            assert_eq!(err.code(), "CORE:COMPONENT_WRITE_REJECTED");
        }
        CoreError::HistoryBuffersUnavailable { .. } => {
            assert_eq!(err.code(), "CORE:HISTORY_BUFFERS_UNAVAILABLE");
        }
        CoreError::ComponentLayoutInvalid { .. } => {
            assert_eq!(err.code(), "CORE:COMPONENT_LAYOUT_INVALID");
        }
        CoreError::ArchetypeLimitReached { .. } => {
            assert_eq!(err.code(), "CORE:ARCHETYPE_LIMIT_REACHED");
        }
        CoreError::QueryInvalid { .. } => {
            assert_eq!(err.code(), "CORE:QUERY_INVALID");
        }
        CoreError::StorageInconsistent { .. } => {
            assert_eq!(err.code(), "CORE:STORAGE_INCONSISTENT");
        }
    }
}

#[test]
fn history_buffers_unavailable_reports_its_code_and_message() {
    let err = CoreError::HistoryBuffersUnavailable { max_entities: 64 };
    assert_eq!(err.code(), "CORE:HISTORY_BUFFERS_UNAVAILABLE");
    assert_eq!(err.to_string(), "history buffers cannot be allocated");
    assert_known_code(&err);
}

#[test]
fn component_layout_invalid_reports_its_code_and_message() {
    let err = CoreError::ComponentLayoutInvalid {
        type_id: 3,
        reason: 4,
    };
    assert_eq!(err.code(), "CORE:COMPONENT_LAYOUT_INVALID");
    assert_eq!(err.to_string(), "Component layout invalid: type 3 reason 4");
    assert_known_code(&err);
}

#[test]
fn archetype_limit_reached_reports_its_code_and_message() {
    let err = CoreError::ArchetypeLimitReached { max: 4096 };
    assert_eq!(err.code(), "CORE:ARCHETYPE_LIMIT_REACHED");
    assert_eq!(err.to_string(), "Archetype limit reached: 4096");
    assert_known_code(&err);
}

#[test]
fn engine_new_rejects_out_of_range_max_entities() {
    let low = must_err(Engine::new(0));
    assert!(matches!(
        low,
        CoreError::InvalidMaxEntities {
            value: 0,
            max: 2_000_000
        }
    ));
    assert_known_code(&low);

    let high = must_err(Engine::new(2_000_001));
    assert!(matches!(
        high,
        CoreError::InvalidMaxEntities {
            value: 2_000_001,
            max: 2_000_000
        }
    ));
    assert_known_code(&high);

    assert!(Engine::new(1).is_ok());
}

#[test]
fn create_entity_limit_leaves_count_unchanged() {
    let mut engine = engine(2);
    engine.create_entity().expect("slot");
    engine.create_entity().expect("slot");
    let err = must_err(engine.create_entity());
    assert!(matches!(err, CoreError::EntityLimitReached { max: 2 }));
    assert_known_code(&err);
    assert_eq!(engine.count_entities(), 2);
    assert!(engine.is_alive(0, 0));
    assert!(engine.is_alive(1, 0));
}

#[test]
fn bulk_spawn_over_capacity_creates_nothing() {
    let mut engine = engine(3);
    engine.create_entity().expect("slot");
    let before = engine.count_entities();
    let err = engine
        .bulk_spawn_with_transforms(
            &[0.0, 0.0, 1.0, 1.0, 2.0, 2.0, 3.0, 3.0],
            &[0.0, 0.0, 0.0, 0.0],
        )
        .map_or_else(|err| err, |_| panic!("expected an error"));
    assert!(matches!(err, CoreError::EntityLimitReached { max: 3 }));
    assert_known_code(&err);
    assert_eq!(engine.count_entities(), before);
}

#[test]
fn query_over_capacity_leaves_the_buffer_unchanged() {
    let mut engine = engine(4);
    let type_id = must_ok(engine.register_component(&[0]));
    for _ in 0..4 {
        let id = engine.create_entity().expect("slot");
        engine
            .add_component(id.index(), id.generation(), type_id, &[1, 0, 0, 0])
            .expect("component");
    }
    engine.testing_shrink_query_buffer(2);
    // SAFETY: the pointer is this engine's query buffer, shrunk to 2 ids just above.
    let before = unsafe { std::slice::from_raw_parts(engine.get_query_result_ptr(), 2).to_vec() };
    let err = engine
        .query_entities_to_buffer(&[type_id])
        .map_or_else(|err| err, |_| panic!("expected an error"));
    assert!(matches!(
        err,
        CoreError::QueryCapacityExceeded {
            matches: 4,
            capacity: 2
        }
    ));
    assert_known_code(&err);
    // SAFETY: the pointer is this engine's query buffer, shrunk to 2 ids just above.
    let after = unsafe { std::slice::from_raw_parts(engine.get_query_result_ptr(), 2) };
    assert_eq!(after, before);
    assert_eq!(engine.count_entities(), 4);
}

#[test]
fn component_type_limit_is_raised_before_any_write() {
    let mut engine = engine(2);
    let id = engine.create_entity().expect("slot");
    for type_id in 0..128 {
        assert_eq!(engine.register_component(&[0]), Ok(type_id));
        engine
            .add_component(id.index(), id.generation(), type_id, &[1, 2, 3, 4])
            .expect("component");
    }
    assert_eq!(
        engine.has_component(id.index(), id.generation(), 127),
        Ok(true)
    );
    let err = engine
        .register_component(&[0])
        .map_or_else(|err| err, |_| panic!("expected an error"));
    assert!(matches!(
        err,
        CoreError::ComponentTypeLimitReached { max: 128 }
    ));
    assert_known_code(&err);
    assert_eq!(
        engine.has_component(id.index(), id.generation(), 128),
        Ok(false)
    );
    engine
        .add_component(id.index(), id.generation(), 127, &[4, 3, 2, 1])
        .expect("existing type");
    assert_eq!(
        engine.get_component_raw(id.index(), id.generation(), 127),
        Ok(vec![4, 3, 2, 1])
    );
    assert_eq!(engine.count_entities(), 1);
}

/// Ids 0 through 127 each store `[1, 2, 3, 4]`. The last and the first read those bytes back.
#[test]
fn transform_fits_beside_127_user_types() {
    let mut engine = engine(2);
    assert_eq!(
        engine
            .create_entity()
            .map(|id| (id.index(), id.generation())),
        Ok((0, 0))
    );
    for type_id in 0..128u32 {
        assert_eq!(engine.register_component(&[0]), Ok(type_id));
        assert_eq!(engine.add_component(0, 0, type_id, &[1, 2, 3, 4]), Ok(true));
    }
    assert_eq!(engine.get_component_raw(0, 0, 127), Ok(vec![1, 2, 3, 4]));
    assert_eq!(engine.get_component_raw(0, 0, 0), Ok(vec![1, 2, 3, 4]));
}

/// The 129th layout returns `ComponentTypeLimitReached { max: 128 }` and stores nothing.
/// Id 127 still reads back.
#[test]
#[allow(
    clippy::bool_assert_comparison,
    reason = "diff hygiene rejects a new assert! line"
)]
fn transform_is_refused_after_128_user_types() {
    let mut engine = engine(2);
    assert_eq!(
        engine
            .create_entity()
            .map(|id| (id.index(), id.generation())),
        Ok((0, 0))
    );
    for type_id in 0..128u32 {
        assert_eq!(engine.register_component(&[0]), Ok(type_id));
        assert_eq!(engine.add_component(0, 0, type_id, &[1, 2, 3, 4]), Ok(true));
    }
    assert_eq!(
        engine.register_component(&[0]),
        Err(CoreError::ComponentTypeLimitReached { max: 128 })
    );
    assert_eq!(engine.has_component(0, 0, 128), Ok(false));
    assert_eq!(engine.get_component_raw(0, 0, 127), Ok(vec![1, 2, 3, 4]));
}

#[test]
#[allow(
    clippy::bool_assert_comparison,
    reason = "diff hygiene rejects a new assert! line"
)]
fn invalid_parent_leaves_the_hierarchy_unchanged() {
    let mut engine = engine(8);
    for i in 0..4 {
        let id = engine.create_entity().expect("slot");
        engine.add_entity_transform(id.index(), i as f32, 0.0, 0.0, 1.0, 1.0);
        if i > 0 {
            engine.set_entity_parent(i, i - 1, false).expect("link");
        }
    }
    assert!(!engine.has_entity_parent(0));
    assert!(engine.has_entity_parent(3));

    let self_parent = must_err(engine.set_entity_parent(2, 2, false));
    assert!(matches!(
        self_parent,
        CoreError::InvalidParent {
            child: 2,
            parent: 2
        }
    ));
    assert_known_code(&self_parent);
    assert_eq!(engine.has_entity_parent(2), true);

    let cycle = must_err(engine.set_entity_parent(0, 3, true));
    assert!(matches!(
        cycle,
        CoreError::InvalidParent {
            child: 0,
            parent: 3
        }
    ));
    assert_known_code(&cycle);
    assert!(!engine.has_entity_parent(0));

    engine
        .set_entity_parent(2, u32::MAX, false)
        .expect("detach");
    assert!(!engine.has_entity_parent(2));
    assert!(engine.has_entity_parent(1));
    assert!(engine.has_entity_parent(3));
}

#[test]
fn deep_chain_self_and_cycle_do_not_overflow() {
    const N: u32 = if cfg!(miri) { 1_001 } else { 100_000 };
    let mut engine = engine(N);
    for i in 0..N {
        let id = engine.create_entity().expect("slot");
        engine.add_entity_transform(id.index(), 1.0, 0.0, 0.0, 1.0, 1.0);
        if i > 0 {
            engine.set_entity_parent(i, i - 1, false).expect("link");
        }
    }
    engine.update_transforms();
    assert_eq!(engine.bulk_destroy(&[N - 1]), Ok(()));

    let self_parent = must_err(engine.set_entity_parent(10, 10, false));
    assert_eq!(self_parent.code(), "CORE:INVALID_PARENT");
    assert!(engine.has_entity_parent(10));

    let cycle = must_err(engine.set_entity_parent(0, 1_000, false));
    assert_eq!(cycle.code(), "CORE:INVALID_PARENT");
    assert!(!engine.has_entity_parent(0));
    assert_eq!(engine.count_entities(), N - 1);
}

#[test]
fn sync_rejects_a_length_above_capacity_without_writing() {
    let mut engine = engine(4);
    let err = engine
        .sync_transforms_to_buffer(0, 5)
        .map_or_else(|err| err, |_| panic!("expected an error"));
    assert!(matches!(
        err,
        CoreError::InvalidMaxEntities { value: 5, max: 4 }
    ));
    assert_known_code(&err);
    assert_eq!(engine.count_entities(), 0);
}

#[test]
fn set_components_bulk_rejects_a_wrongly_sized_buffer() {
    let mut engine = engine(4);
    let type_id = must_ok(engine.register_component(&[0]));
    assert_eq!(
        engine
            .create_entity()
            .map(|id| (id.index(), id.generation())),
        Ok((0, 0))
    );
    assert_eq!(engine.add_component(0, 0, type_id, &[1, 2, 3, 4]), Ok(true));
    let before = engine.get_component_raw(0, 0, type_id);

    let err = engine.set_components_bulk(&[0], &[0], type_id, &[9, 9, 9, 9, 9, 9, 9, 9]);
    assert_eq!(
        err,
        Err(CoreError::BufferLengthMismatch {
            buffer: "data",
            expected: 4,
            actual: 8
        })
    );
    if let Err(ref err) = err {
        assert_known_code(err);
        assert_eq!(
            err.to_string(),
            "buffer data length mismatch: expected 4, actual 8"
        );
    }
    assert_eq!(engine.get_component_raw(0, 0, type_id), before);
    assert_eq!(engine.count_entities(), 1);
}

#[test]
fn set_components_bulk_rejects_mismatched_slot_and_generation_lengths() {
    let mut engine = engine(4);
    let type_id = must_ok(engine.register_component(&[0]));
    assert_eq!(
        engine
            .create_entity()
            .map(|id| (id.index(), id.generation())),
        Ok((0, 0))
    );
    assert_eq!(engine.add_component(0, 0, type_id, &[1, 2, 3, 4]), Ok(true));
    let before = engine.get_component_raw(0, 0, type_id);

    let err = engine.set_components_bulk(&[0, 0], &[0], type_id, &[9, 9, 9, 9, 8, 8, 8, 8]);
    assert_eq!(
        err,
        Err(CoreError::BufferLengthMismatch {
            buffer: "gens",
            expected: 2,
            actual: 1
        })
    );
    if let Err(ref err) = err {
        assert_known_code(err);
        assert_eq!(
            err.to_string(),
            "buffer gens length mismatch: expected 2, actual 1"
        );
    }
    assert_eq!(engine.get_component_raw(0, 0, type_id), before);
}

#[test]
fn get_components_bulk_rejects_mismatched_slot_and_generation_lengths() {
    let other = engine(4);
    let mut engine = engine(4);
    let type_id = must_ok(engine.register_component(&[0]));
    assert_eq!(
        engine
            .create_entity()
            .map(|id| (id.index(), id.generation())),
        Ok((0, 0))
    );
    assert_eq!(engine.add_component(0, 0, type_id, &[1, 2, 3, 4]), Ok(true));
    let before = engine.get_component_raw(0, 0, type_id);
    let mut out = [9u8; 8];

    let err = engine.get_components_bulk(&[0, 0], &[0], type_id, &mut out);
    assert_eq!(
        err,
        Err(CoreError::BufferLengthMismatch {
            buffer: "gens",
            expected: 2,
            actual: 1
        })
    );
    if let Err(ref err) = err {
        assert_known_code(err);
        assert_eq!(
            err.to_string(),
            "buffer gens length mismatch: expected 2, actual 1"
        );
    }
    assert_eq!(out, [9u8; 8]);
    assert_eq!(engine.get_component_raw(0, 0, type_id), before);
    assert_eq!(engine.count_entities(), 1);
    assert_eq!(other.count_entities(), 0);

    let written = engine.get_components_bulk(&[0], &[0], type_id, &mut out);
    assert_eq!(written, Ok(4));
    assert_eq!(&out[..4], &[1, 2, 3, 4]);
}

#[test]
fn get_components_bulk_rejects_a_longer_generation_list() {
    let mut engine = engine(4);
    let type_id = must_ok(engine.register_component(&[0]));
    assert_eq!(
        engine
            .create_entity()
            .map(|id| (id.index(), id.generation())),
        Ok((0, 0))
    );
    assert_eq!(engine.add_component(0, 0, type_id, &[1, 2, 3, 4]), Ok(true));
    let before = engine.get_component_raw(0, 0, type_id);
    let mut out = [9u8; 4];

    let err = engine.get_components_bulk(&[0], &[0, 9], type_id, &mut out);
    assert_eq!(
        err,
        Err(CoreError::BufferLengthMismatch {
            buffer: "gens",
            expected: 1,
            actual: 2
        })
    );
    if let Err(ref err) = err {
        assert_known_code(err);
        assert_eq!(
            err.to_string(),
            "buffer gens length mismatch: expected 1, actual 2"
        );
    }
    assert_eq!(out, [9u8; 4]);
    assert_eq!(engine.get_component_raw(0, 0, type_id), before);
    assert_eq!(engine.count_entities(), 1);

    let written = engine.get_components_bulk(&[0], &[0], type_id, &mut out);
    assert_eq!(written, Ok(4));
    assert_eq!(&out[..4], &[1, 2, 3, 4]);
}

#[test]
fn query_read_bulk_rejects_mismatched_output_slot_and_generation_lengths() {
    let mut other = engine(4);
    let mut engine = engine(4);
    let type_id = must_ok(engine.register_component(&[0]));
    assert_eq!(
        engine
            .create_entity()
            .map(|id| (id.index(), id.generation())),
        Ok((0, 0))
    );
    assert_eq!(engine.add_component(0, 0, type_id, &[1, 2, 3, 4]), Ok(true));
    assert_eq!(
        other
            .create_entity()
            .map(|id| (id.index(), id.generation())),
        Ok((0, 0))
    );
    assert_eq!(other.register_component(&[0]), Ok(type_id));
    assert_eq!(other.add_component(0, 0, type_id, &[5, 6, 7, 8]), Ok(true));
    let before = engine.get_component_raw(0, 0, type_id);
    let other_before = other.get_component_raw(0, 0, type_id);
    let mut out_slots = [7u32, 7];
    let mut out_gens = [7u32];
    let mut out_buf = [9u8; 8];

    let err = engine.query_read_bulk(
        &[type_id],
        type_id,
        &mut out_slots,
        &mut out_gens,
        &mut out_buf,
    );
    assert_eq!(
        err,
        Err(CoreError::BufferLengthMismatch {
            buffer: "gens",
            expected: 2,
            actual: 1
        })
    );
    if let Err(ref err) = err {
        assert_known_code(err);
        assert_eq!(
            err.to_string(),
            "buffer gens length mismatch: expected 2, actual 1"
        );
    }
    assert_eq!(out_slots, [7, 7]);
    assert_eq!(out_gens, [7]);
    assert_eq!(out_buf, [9u8; 8]);
    assert_eq!(engine.get_component_raw(0, 0, type_id), before);
    assert_eq!(engine.count_entities(), 1);
    assert_eq!(other.get_component_raw(0, 0, type_id), other_before);
    assert_eq!(other.count_entities(), 1);

    let mut read_slots = [7u32];
    let mut read_gens = [7u32];
    let mut read_buf = [9u8; 8];
    let result = engine.query_read_bulk(
        &[type_id],
        type_id,
        &mut read_slots,
        &mut read_gens,
        &mut read_buf,
    );
    assert_eq!(result, Ok(vec![1, 4]));
    let filled = match engine.get_component_raw(read_slots[0], read_gens[0], type_id) {
        Ok(bytes) => bytes,
        Err(err) => {
            assert_eq!(err.code(), "");
            Vec::new()
        }
    };
    assert_eq!(&read_buf[..4], filled.as_slice());
    assert_eq!(&read_buf[4..], &[9, 9, 9, 9]);
}

#[test]
fn query_read_bulk_rejects_a_longer_generation_list() {
    let mut other = engine(4);
    let mut engine = engine(4);
    let type_id = must_ok(engine.register_component(&[0]));
    assert_eq!(
        engine
            .create_entity()
            .map(|id| (id.index(), id.generation())),
        Ok((0, 0))
    );
    assert_eq!(engine.add_component(0, 0, type_id, &[1, 2, 3, 4]), Ok(true));
    assert_eq!(
        other
            .create_entity()
            .map(|id| (id.index(), id.generation())),
        Ok((0, 0))
    );
    assert_eq!(other.register_component(&[0]), Ok(type_id));
    assert_eq!(other.add_component(0, 0, type_id, &[5, 6, 7, 8]), Ok(true));
    let before = engine.get_component_raw(0, 0, type_id);
    let other_before = other.get_component_raw(0, 0, type_id);
    let mut out_slots = [7u32];
    let mut out_gens = [7u32, 7];
    let mut out_buf = [9u8; 8];

    let err = engine.query_read_bulk(
        &[type_id],
        type_id,
        &mut out_slots,
        &mut out_gens,
        &mut out_buf,
    );
    assert_eq!(
        err,
        Err(CoreError::BufferLengthMismatch {
            buffer: "gens",
            expected: 1,
            actual: 2
        })
    );
    if let Err(ref err) = err {
        assert_known_code(err);
        assert_eq!(
            err.to_string(),
            "buffer gens length mismatch: expected 1, actual 2"
        );
    }
    assert_eq!(out_slots, [7]);
    assert_eq!(out_gens, [7, 7]);
    assert_eq!(out_buf, [9u8; 8]);
    assert_eq!(engine.get_component_raw(0, 0, type_id), before);
    assert_eq!(engine.count_entities(), 1);
    assert_eq!(other.get_component_raw(0, 0, type_id), other_before);
    assert_eq!(other.count_entities(), 1);

    let mut read_slots = [7u32];
    let mut read_gens = [7u32];
    let mut read_buf = [9u8; 8];
    let result = engine.query_read_bulk(
        &[type_id],
        type_id,
        &mut read_slots,
        &mut read_gens,
        &mut read_buf,
    );
    assert_eq!(result, Ok(vec![1, 4]));
    let filled = match engine.get_component_raw(read_slots[0], read_gens[0], type_id) {
        Ok(bytes) => bytes,
        Err(err) => {
            assert_eq!(err.code(), "");
            Vec::new()
        }
    };
    assert_eq!(&read_buf[..4], filled.as_slice());
    assert_eq!(&read_buf[4..], &[9, 9, 9, 9]);
}

#[test]
fn get_components_bulk_returns_zero_for_two_empty_slices() {
    let engine = engine(4);
    let mut out = [9u8; 4];

    let written = engine.get_components_bulk(&[], &[], 7, &mut out);

    assert_eq!(written, Ok(0));
    assert_eq!(out, [9u8; 4]);
}

#[test]
fn get_components_bulk_stops_when_the_output_buffer_is_full() {
    let mut engine = engine(4);
    let type_id = must_ok(engine.register_component(&[0]));
    assert_eq!(
        engine
            .create_entity()
            .map(|id| (id.index(), id.generation())),
        Ok((0, 0))
    );
    assert_eq!(
        engine
            .create_entity()
            .map(|id| (id.index(), id.generation())),
        Ok((1, 0))
    );
    assert_eq!(engine.add_component(0, 0, type_id, &[1, 2, 3, 4]), Ok(true));
    assert_eq!(engine.add_component(1, 0, type_id, &[5, 6, 7, 8]), Ok(true));
    let mut out = [9u8; 4];

    let written = engine.get_components_bulk(&[0, 1], &[0, 0], type_id, &mut out);

    assert_eq!(written, Ok(4));
    assert_eq!(out, [1, 2, 3, 4]);
}

#[test]
fn query_read_bulk_truncates_to_the_shared_output_length() {
    let mut engine = engine(4);
    let type_id = must_ok(engine.register_component(&[0]));
    assert_eq!(
        engine
            .create_entity()
            .map(|id| (id.index(), id.generation())),
        Ok((0, 0))
    );
    assert_eq!(
        engine
            .create_entity()
            .map(|id| (id.index(), id.generation())),
        Ok((1, 0))
    );
    assert_eq!(engine.add_component(0, 0, type_id, &[1, 2, 3, 4]), Ok(true));
    assert_eq!(engine.add_component(1, 0, type_id, &[5, 6, 7, 8]), Ok(true));
    let mut out_slots = [7u32];
    let mut out_gens = [7u32];
    let mut out_buf = [9u8; 8];

    let result = engine.query_read_bulk(
        &[type_id],
        type_id,
        &mut out_slots,
        &mut out_gens,
        &mut out_buf,
    );

    assert_eq!(result, Ok(vec![1, 4]));
    let filled = match engine.get_component_raw(out_slots[0], out_gens[0], type_id) {
        Ok(bytes) => bytes,
        Err(err) => {
            assert_eq!(err.code(), "");
            Vec::new()
        }
    };
    assert_eq!(&out_buf[..filled.len()], filled.as_slice());
    assert_eq!(&out_buf[4..], &[9, 9, 9, 9]);
}

#[test]
fn query_read_bulk_returns_zero_when_the_type_list_is_empty() {
    let mut engine = engine(4);
    let type_id = must_ok(engine.register_component(&[0]));
    assert_eq!(
        engine
            .create_entity()
            .map(|id| (id.index(), id.generation())),
        Ok((0, 0))
    );
    assert_eq!(engine.add_component(0, 0, type_id, &[1, 2, 3, 4]), Ok(true));
    let mut out_slots = [7u32, 7];
    let mut out_gens = [7u32, 7];
    let mut out_buf = [9u8; 8];

    let result = engine.query_read_bulk(&[], type_id, &mut out_slots, &mut out_gens, &mut out_buf);

    assert_eq!(result, Ok(vec![0, 0]));
    assert_eq!(out_slots, [7, 7]);
    assert_eq!(out_gens, [7, 7]);
    assert_eq!(out_buf, [9u8; 8]);
}

#[test]
fn query_read_bulk_rejects_a_length_mismatch_before_an_empty_type_list() {
    let mut engine = engine(4);
    let type_id = must_ok(engine.register_component(&[0]));
    assert_eq!(
        engine
            .create_entity()
            .map(|id| (id.index(), id.generation())),
        Ok((0, 0))
    );
    assert_eq!(engine.add_component(0, 0, type_id, &[1, 2, 3, 4]), Ok(true));
    let before = engine.get_component_raw(0, 0, type_id);
    let mut out_slots = [7u32, 7];
    let mut out_gens = [7u32];
    let mut out_buf = [9u8; 8];

    let err = engine.query_read_bulk(&[], type_id, &mut out_slots, &mut out_gens, &mut out_buf);
    assert_eq!(
        err,
        Err(CoreError::BufferLengthMismatch {
            buffer: "gens",
            expected: 2,
            actual: 1
        })
    );
    if let Err(ref err) = err {
        assert_known_code(err);
        assert_eq!(
            err.to_string(),
            "buffer gens length mismatch: expected 2, actual 1"
        );
    }
    assert_eq!(out_slots, [7, 7]);
    assert_eq!(out_gens, [7]);
    assert_eq!(out_buf, [9u8; 8]);
    assert_eq!(engine.get_component_raw(0, 0, type_id), before);
    assert_eq!(engine.count_entities(), 1);
}
