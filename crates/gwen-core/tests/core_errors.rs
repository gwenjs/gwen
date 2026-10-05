//! Native checks for [`gwen_core::CoreError`].
//!
//! Each variant is produced by the export that owns it. An `Err` leaves the
//! engine state unchanged.

use gwen_core::bindings::Engine;
use gwen_core::{CoreError, FLAGS_OFFSET, TRANSFORM_SAB_TYPE_ID, TRANSFORM_STRIDE};

fn engine(max_entities: u32) -> Engine {
    Engine::new(max_entities).expect("max entities")
}

fn must_err<T, E>(result: Result<T, E>) -> E {
    match result {
        Ok(_) => panic!("expected an error"),
        Err(err) => err,
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
    }
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
        .bulk_spawn_with_transforms(&[0.0, 0.0, 1.0, 1.0, 2.0, 2.0, 3.0, 3.0], &[])
        .map_or_else(|err| err, |_| panic!("expected an error"));
    assert!(matches!(err, CoreError::EntityLimitReached { max: 3 }));
    assert_known_code(&err);
    assert_eq!(engine.count_entities(), before);
}

#[test]
fn query_over_capacity_leaves_the_buffer_unchanged() {
    let mut engine = engine(4);
    let type_id = engine.register_component_type();
    for _ in 0..4 {
        let id = engine.create_entity().expect("slot");
        engine
            .add_component(id.index(), id.generation(), type_id, &[1, 0, 0, 0])
            .expect("component");
    }
    engine.testing_shrink_query_buffer(2);
    let before = unsafe {
        std::slice::from_raw_parts(engine.get_query_result_ptr(), 2).to_vec()
    };
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
    let after = unsafe { std::slice::from_raw_parts(engine.get_query_result_ptr(), 2) };
    assert_eq!(after, before);
    assert_eq!(engine.count_entities(), 4);
}

#[test]
fn component_type_limit_is_raised_before_any_write() {
    let mut engine = engine(2);
    let id = engine.create_entity().expect("slot");
    for type_id in 0..128 {
        engine
            .add_component(id.index(), id.generation(), type_id, &[1, 2, 3, 4])
            .expect("component");
    }
    assert!(engine
        .has_component(id.index(), id.generation(), 127));
    let err = engine
        .add_component(id.index(), id.generation(), 128, &[9, 9, 9, 9])
        .map_or_else(|err| err, |_| panic!("expected an error"));
    assert!(matches!(
        err,
        CoreError::ComponentTypeLimitReached { max: 128 }
    ));
    assert_known_code(&err);
    assert!(!engine.has_component(id.index(), id.generation(), 128));
    engine
        .add_component(id.index(), id.generation(), 127, &[4, 3, 2, 1])
        .expect("existing type");
    assert_eq!(
        engine.get_component_raw(id.index(), id.generation(), 127),
        vec![4, 3, 2, 1]
    );
    assert_eq!(engine.count_entities(), 1);
}

#[test]
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

    engine.set_entity_parent(2, u32::MAX, false).expect("detach");
    assert!(!engine.has_entity_parent(2));
    assert!(engine.has_entity_parent(1));
    assert!(engine.has_entity_parent(3));
}

#[test]
fn deep_chain_self_and_cycle_do_not_overflow() {
    const N: u32 = 100_000;
    let mut engine = engine(N);
    for i in 0..N {
        let id = engine.create_entity().expect("slot");
        engine.add_entity_transform(id.index(), 1.0, 0.0, 0.0, 1.0, 1.0);
        if i > 0 {
            engine.set_entity_parent(i, i - 1, false).expect("link");
        }
    }
    engine.update_transforms();
    engine.bulk_destroy(&[N - 1]);

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
    let err = engine
        .sync_transforms_from_buffer(0, 5)
        .map_or_else(|err| err, |_| panic!("expected an error"));
    assert!(matches!(
        err,
        CoreError::InvalidMaxEntities { value: 5, max: 4 }
    ));
    assert_eq!(engine.count_entities(), 0);
}

fn slot_buffer() -> Vec<u8> {
    vec![0u8; TRANSFORM_STRIDE]
}

#[test]
fn sync_from_buffer_skips_registration_until_a_flagged_slot() {
    let mut engine = engine(2);
    let id = engine.create_entity().expect("slot");
    let mut slot = slot_buffer();
    let ptr = slot.as_mut_ptr() as usize;

    engine
        .sync_transforms_from_buffer(ptr, 1)
        .expect("unflagged sync");
    for type_id in 0..128u32 {
        engine
            .add_component(id.index(), id.generation(), type_id, &[1])
            .expect("user type");
    }
    assert!(!engine.has_component(id.index(), id.generation(), TRANSFORM_SAB_TYPE_ID));

    slot[FLAGS_OFFSET] = 1;
    let err = must_err(engine.sync_transforms_from_buffer(ptr, 1));
    assert!(matches!(
        err,
        CoreError::ComponentTypeLimitReached { max: 128 }
    ));
    assert!(!engine.has_component(id.index(), id.generation(), TRANSFORM_SAB_TYPE_ID));
}

#[test]
fn sync_from_buffer_writes_the_first_flagged_slot() {
    let mut engine = engine(2);
    let id = engine.create_entity().expect("slot");
    let mut slot = slot_buffer();
    slot[0..4].copy_from_slice(&1.5f32.to_le_bytes());
    slot[FLAGS_OFFSET] = 1;
    let ptr = slot.as_mut_ptr() as usize;

    engine
        .sync_transforms_from_buffer(ptr, 1)
        .expect("flagged sync");
    let raw = engine.get_component_raw(id.index(), id.generation(), TRANSFORM_SAB_TYPE_ID);
    assert!(raw.len() >= 4);
    let x = f32::from_le_bytes(raw[0..4].try_into().expect("f32"));
    assert_eq!(x, 1.5);
}
