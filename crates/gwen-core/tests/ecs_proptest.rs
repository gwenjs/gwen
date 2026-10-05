//! ECS property test.
//!
//! `wasm-pack test` compiles every file under `tests/` for wasm32.
//! This target is native-only: `proptest` is not a wasm32 dependency, and
//! `Engine::create_entity`'s `JsError` path panics off wasm. Live entities
//! stay below `max_entities`. The limit itself is checked on `EntityManager`.

#![cfg(not(target_arch = "wasm32"))]

use gwen_core::bindings::Engine;
use gwen_core::ecs::{EcsError, EntityManager};
use proptest::prelude::*;
use proptest::test_runner::{Config, FileFailurePersistence};

const MAX_LIVE: u32 = 16;
const ENGINE_CAP: u32 = 32;
const TYPE_COUNT: usize = 4;

#[derive(Clone, Debug)]
enum Op {
    Create,
    Delete(u8),
    DeleteStale(u8),
    AddComponent(u8, u8),
    RemoveComponent(u8, u8),
    Query(u8),
}

fn op_strategy() -> impl Strategy<Value = Op> {
    prop_oneof![
        Just(Op::Create),
        any::<u8>().prop_map(Op::Delete),
        any::<u8>().prop_map(Op::DeleteStale),
        (any::<u8>(), any::<u8>()).prop_map(|(slot, ty)| Op::AddComponent(slot, ty)),
        (any::<u8>(), any::<u8>()).prop_map(|(slot, ty)| Op::RemoveComponent(slot, ty)),
        any::<u8>().prop_map(Op::Query),
    ]
}

struct Slot {
    generation: u32,
    alive: bool,
    components: [bool; TYPE_COUNT],
}

struct Model {
    slots: Vec<Slot>,
    free: Vec<u32>,
    live: u32,
    type_ids: [u32; TYPE_COUNT],
}

impl Model {
    fn can_create(&self) -> bool {
        !self.free.is_empty() || (self.slots.len() as u32) < MAX_LIVE
    }

    fn slot_index(&self, raw: u8) -> Option<u32> {
        if self.slots.is_empty() {
            return None;
        }
        Some(u32::from(raw) % self.slots.len() as u32)
    }
}

fn fresh_engine() -> (Engine, Model) {
    let mut engine = Engine::new(ENGINE_CAP);
    let mut type_ids = [0u32; TYPE_COUNT];
    for (i, slot) in type_ids.iter_mut().enumerate() {
        *slot = engine.register_component_type();
        assert_eq!(*slot, i as u32);
    }

    // Assign a registry bit for every type, then leave the world empty.
    // A query for a type that was never registered has an empty mask and
    // matches every archetype, which is not the brute-force filter.
    let id = engine
        .create_entity()
        .expect("registrar below max_entities");
    let index = id.index();
    let generation = id.generation();
    assert_eq!(index, 0);
    assert_eq!(generation, 0);
    for &type_id in &type_ids {
        assert!(engine.add_component(index, generation, type_id, &[1]));
    }
    for &type_id in &type_ids {
        assert!(engine.remove_component(index, generation, type_id));
    }
    assert!(engine.delete_entity(index, generation));

    let model = Model {
        slots: vec![Slot {
            generation: 0,
            alive: false,
            components: [false; TYPE_COUNT],
        }],
        free: vec![0],
        live: 0,
        type_ids,
    };
    (engine, model)
}

fn assert_invariants(engine: &mut Engine, model: &Model) {
    assert_eq!(engine.count_entities(), model.live, "live count drifted");

    for (index, slot) in model.slots.iter().enumerate() {
        let index = index as u32;
        assert_eq!(
            engine.is_alive(index, slot.generation),
            slot.alive,
            "liveness mismatch at {index}",
        );
        let stale = slot.generation.wrapping_add(1);
        assert!(
            !engine.is_alive(index, stale),
            "stale generation accepted at {index}",
        );
        if !slot.alive {
            assert!(
                !engine.delete_entity(index, slot.generation),
                "stale delete accepted at {index}",
            );
            assert!(
                !engine.add_component(index, slot.generation, model.type_ids[0], &[1]),
                "stale add accepted at {index}",
            );
        }
    }

    for ty in 0..TYPE_COUNT {
        assert_query(engine, model, &[ty]);
    }
    assert_query(engine, model, &[0, 1]);
}

fn assert_query(engine: &mut Engine, model: &Model, types: &[usize]) {
    let type_ids: Vec<u32> = types.iter().map(|&ty| model.type_ids[ty]).collect();
    let mut actual = engine.query_entities(&type_ids);
    actual.sort_unstable();

    let mut expected: Vec<u32> = model
        .slots
        .iter()
        .enumerate()
        .filter(|(_, slot)| slot.alive && types.iter().all(|&ty| slot.components[ty]))
        .map(|(index, _)| index as u32)
        .collect();
    expected.sort_unstable();

    assert_eq!(actual, expected, "query {types:?} diverged from the model");
}

fn apply(engine: &mut Engine, model: &mut Model, op: Op) {
    match op {
        Op::Create => {
            if !model.can_create() {
                return;
            }
            let id = engine
                .create_entity()
                .expect("live count stays below max_entities");
            if let Some(index) = model.free.pop() {
                let slot = &mut model.slots[index as usize];
                slot.generation = slot.generation.wrapping_add(1);
                slot.alive = true;
                slot.components = [false; TYPE_COUNT];
                assert_eq!(id.index(), index);
                assert_eq!(id.generation(), slot.generation);
            } else {
                let index = model.slots.len() as u32;
                model.slots.push(Slot {
                    generation: 0,
                    alive: true,
                    components: [false; TYPE_COUNT],
                });
                assert_eq!(id.index(), index);
                assert_eq!(id.generation(), 0);
            }
            model.live += 1;
        }
        Op::Delete(raw) => {
            let Some(index) = model.slot_index(raw) else {
                return;
            };
            let slot = &mut model.slots[index as usize];
            let deleted = engine.delete_entity(index, slot.generation);
            if slot.alive {
                assert!(deleted, "live entity was not deleted");
                slot.alive = false;
                slot.components = [false; TYPE_COUNT];
                model.free.push(index);
                model.live -= 1;
            } else {
                assert!(!deleted, "delete of a dead id returned true");
            }
        }
        Op::DeleteStale(raw) => {
            let Some(index) = model.slot_index(raw) else {
                return;
            };
            let stale = model.slots[index as usize].generation.wrapping_add(1);
            assert!(!engine.delete_entity(index, stale));
            assert!(!engine.is_alive(index, stale));
            assert!(!engine.add_component(index, stale, model.type_ids[0], &[1]));
        }
        Op::AddComponent(raw, ty_raw) => {
            let Some(index) = model.slot_index(raw) else {
                return;
            };
            let ty = usize::from(ty_raw) % TYPE_COUNT;
            let slot = &mut model.slots[index as usize];
            let added =
                engine.add_component(index, slot.generation, model.type_ids[ty], &[1, 2, 3, 4]);
            if slot.alive {
                assert!(added, "add on a live id returned false");
                slot.components[ty] = true;
            } else {
                assert!(!added, "add on a stale id returned true");
            }
        }
        Op::RemoveComponent(raw, ty_raw) => {
            let Some(index) = model.slot_index(raw) else {
                return;
            };
            let ty = usize::from(ty_raw) % TYPE_COUNT;
            let slot = &mut model.slots[index as usize];
            let removed = engine.remove_component(index, slot.generation, model.type_ids[ty]);
            if slot.alive && slot.components[ty] {
                assert!(removed, "remove of a present component returned false");
                slot.components[ty] = false;
            } else {
                assert!(!removed, "remove of a missing component returned true");
            }
        }
        Op::Query(mask) => {
            let mut types = Vec::new();
            for ty in 0..TYPE_COUNT {
                if mask & (1 << ty) != 0 {
                    types.push(ty);
                }
            }
            if types.is_empty() {
                types.push(0);
            }
            assert_query(engine, model, &types);
        }
    }
}

proptest! {
    #![proptest_config(Config {
        // `cargo test` runs with the crate directory as cwd, so this path is
        // relative to crates/gwen-core. SourceParallel never finds src/lib.rs.
        failure_persistence: Some(Box::new(FileFailurePersistence::Direct(
            "tests/proptest-regressions/ecs_proptest.txt",
        ))),
        ..Config::default()
    })]

    #[test]
    fn ecs_invariants_hold(ops in prop::collection::vec(op_strategy(), 1..48)) {
        let (mut engine, mut model) = fresh_engine();
        assert_invariants(&mut engine, &model);
        for op in ops {
            apply(&mut engine, &mut model, op);
            assert_invariants(&mut engine, &model);
        }
    }
}

#[test]
fn entity_limit_is_rejected_at_the_ecs_level() {
    let mut entities = EntityManager::new(2);
    entities.create_entity().expect("first slot");
    entities.create_entity().expect("second slot");
    let error = entities
        .create_entity()
        .expect_err("third slot is over the limit");
    assert!(matches!(error, EcsError::EntityLimitReached { max: 2 }));
    assert_eq!(entities.count_entities(), 2);
}
