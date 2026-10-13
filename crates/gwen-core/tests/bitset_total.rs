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

#[test]
fn set_returns_true_for_bits_inside_the_set() {
    let mut set = BitSet128::new();
    let mut other = BitSet128::new();
    for index in [0u8, 63, 64, 127] {
        assert_eq!(set.contains(index), false);
        assert_eq!(set.set(index), true);
        assert_eq!(set.set(index), true);
        assert_eq!(set.contains(index), true);
        assert_eq!(other.contains(index), false);
    }
}

#[test]
fn set_rejects_128_and_255_without_changing_bits() {
    let mut empty = BitSet128::new();
    assert_eq!(empty.set(128), false);
    assert_eq!(empty.set(255), false);
    assert_eq!(empty.is_empty(), true);

    let mut marked = BitSet128::new();
    assert_eq!(marked.set(0), true);
    assert_eq!(marked.set(127), true);
    assert_eq!(marked.set(128), false);
    assert_eq!(marked.set(255), false);
    assert_eq!(marked.contains(0), true);
    assert_eq!(marked.contains(127), true);
    assert_eq!(marked.contains(63), false);
    assert_eq!(marked.is_empty(), false);
}

#[test]
fn contains_rejects_128_and_255_on_a_full_set() {
    let mut set = BitSet128::new();
    for index in 0..128u8 {
        assert_eq!(set.set(index), true);
    }
    assert_eq!(set.contains(128), false);
    assert_eq!(set.contains(255), false);
    assert_eq!(set.contains(0), true);
    assert_eq!(set.contains(127), true);
}

#[test]
fn query_finds_bit_127_and_the_129th_type_is_refused() {
    let mut engine = Engine::new(4).expect("engine");
    let holder = engine.create_entity().expect("holder");
    let other = engine.create_entity().expect("other");
    let only_last = engine.create_entity().expect("only last");
    for type_id in 0..128u32 {
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

    let mut found = engine.query_entities(&[127]);
    found.sort_unstable();
    assert_eq!(found, vec![holder.index(), only_last.index()]);
    assert_eq!(
        engine.get_component_raw(holder.index(), holder.generation(), 127),
        vec![1]
    );

    let err = match engine.add_component(holder.index(), holder.generation(), 128, &[9, 9, 9, 9]) {
        Ok(value) => panic!("expected ComponentTypeLimitReached, got {value}"),
        Err(err) => err,
    };
    assert_eq!(err, CoreError::ComponentTypeLimitReached { max: 128 });
    assert_eq!(err.code(), "CORE:COMPONENT_TYPE_LIMIT_REACHED");
    assert_eq!(err.to_string(), "Component type limit reached: 128");
    assert_eq!(
        engine.has_component(holder.index(), holder.generation(), 128),
        false
    );
    assert_eq!(
        engine.get_component_raw(holder.index(), holder.generation(), 128),
        Vec::<u8>::new()
    );
    assert_eq!(
        engine.get_component_raw(holder.index(), holder.generation(), 127),
        vec![1]
    );
    assert_eq!(engine.count_entities(), 3);

    let mut second = Engine::new(2).expect("second engine");
    let fresh = second.create_entity().expect("fresh");
    assert_eq!(
        second.add_component(fresh.index(), fresh.generation(), 0, &[1]),
        Ok(true)
    );
}
