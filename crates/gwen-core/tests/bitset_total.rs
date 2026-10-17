//! `BitSet128` is total, and the 129th component type is refused on the engine.

#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::unreachable,
    clippy::todo,
    clippy::unimplemented,
    reason = "test-only code"
)]

use gwen_core::bindings::Engine;
use gwen_core::{BitSet128, CoreError};

fn must_ok<T, E>(result: Result<T, E>) -> T {
    match result {
        Ok(value) => value,
        Err(_) => unreachable!(),
    }
}

fn must_err<T, E>(result: Result<T, E>) -> E {
    match result {
        Ok(_) => unreachable!(),
        Err(err) => err,
    }
}

#[test]
fn set_returns_true_for_bits_inside_the_set() {
    let mut set = BitSet128::new();
    for index in [0u8, 63, 64, 127] {
        assert_eq!([set.contains(index)], [false]);
        assert_eq!([set.set(index), set.set(index)], [true, true]);
        assert_eq!([set.contains(index)], [true]);
    }
}

#[test]
fn set_rejects_128_and_255_without_changing_bits() {
    let mut empty = BitSet128::new();
    assert_eq!([empty.set(128), empty.set(255)], [false, false]);
    assert_eq!(empty, BitSet128::new());

    let mut marked = BitSet128::new();
    assert_eq!([marked.set(0), marked.set(127)], [true, true]);
    assert_eq!([marked.set(128), marked.set(255)], [false, false]);
    assert_eq!(
        [
            marked.contains(0),
            marked.contains(127),
            marked.contains(63)
        ],
        [true, true, false]
    );
    assert_ne!(marked, BitSet128::new());
}

#[test]
fn contains_rejects_128_and_255_on_a_full_set() {
    let mut set = BitSet128::new();
    for index in 0..128u8 {
        assert_eq!([set.set(index)], [true]);
    }
    assert_eq!(
        [
            set.contains(128),
            set.contains(255),
            set.contains(0),
            set.contains(127)
        ],
        [false, false, true, true]
    );
}

#[test]
fn query_finds_bit_127_and_the_129th_type_is_refused() {
    let mut engine = must_ok(Engine::new(4));
    let holder = must_ok(engine.create_entity());
    let other = must_ok(engine.create_entity());
    let only_last = must_ok(engine.create_entity());
    for type_id in 0..128u32 {
        assert_eq!(engine.register_component(&[4]), Ok(type_id));
        assert_eq!(
            engine.add_component(holder.index(), holder.generation(), type_id, &[1]),
            Ok(true)
        );
    }
    assert_eq!(
        engine.add_component(other.index(), other.generation(), 0, &[2]),
        Ok(true)
    );
    assert_eq!(
        engine.add_component(only_last.index(), only_last.generation(), 127, &[3]),
        Ok(true)
    );

    let mut found = match engine.query_entities(&[127]) {
        Ok(rows) => rows,
        Err(err) => {
            assert_eq!(err.code(), "");
            Vec::new()
        }
    };
    found.sort_unstable();
    assert_eq!(found, vec![holder.index(), only_last.index()]);
    assert_eq!(
        engine.get_component_raw(holder.index(), holder.generation(), 127),
        Ok(vec![1])
    );

    let err = must_err(engine.register_component(&[4]));
    assert_eq!(err, CoreError::ComponentTypeLimitReached { max: 128 });
    assert_eq!(err.code(), "CORE:COMPONENT_TYPE_LIMIT_REACHED");
    assert_eq!(err.to_string(), "Component type limit reached: 128");
    assert_eq!(
        [engine.has_component(holder.index(), holder.generation(), 128)],
        [Ok(false)]
    );
    assert_eq!(
        engine.get_component_raw(holder.index(), holder.generation(), 128),
        Ok(Vec::<u8>::new())
    );
    assert_eq!(
        engine.get_component_raw(holder.index(), holder.generation(), 127),
        Ok(vec![1])
    );
    assert_eq!(engine.count_entities(), 3);

    let mut second = must_ok(Engine::new(2));
    let fresh = must_ok(second.create_entity());
    assert_eq!(second.register_component(&[4]), Ok(0));
    assert_eq!(
        second.add_component(fresh.index(), fresh.generation(), 0, &[1]),
        Ok(true)
    );
}
