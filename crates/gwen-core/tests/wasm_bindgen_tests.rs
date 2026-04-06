/// wasm-bindgen integration tests
///
/// These tests exercise the public JS-facing API (`bindings.rs`) as it
/// would be called from JavaScript.  They are compiled to WASM and run
/// inside a headless browser (or Node.js) via `wasm-pack test`.
///
/// Run with:
///   wasm-pack test --node crates/gwen-core
///
/// Each test corresponds to a distinct concern of the JS API surface.
use wasm_bindgen_test::*;

// Run all tests in Node.js (no browser required in CI)
wasm_bindgen_test_configure!(run_in_node_experimental);

use gwen_core::bindings::{Engine, JsEntityId};

// ─── Helpers ─────────────────────────────────────────────────────────────────

fn make_engine() -> Engine {
    Engine::new(100)
}

// ─── Entity lifecycle ─────────────────────────────────────────────────────────

#[wasm_bindgen_test]
fn wasm_create_entity_returns_valid_id() {
    let mut engine = make_engine();
    let id: JsEntityId = engine.create_entity();
    // First entity always gets index 0, generation 0
    assert_eq!(id.index(), 0);
    assert_eq!(id.generation(), 0);
}

#[wasm_bindgen_test]
fn wasm_multiple_entities_get_sequential_indices() {
    let mut engine = make_engine();
    let a = engine.create_entity();
    let b = engine.create_entity();
    let c = engine.create_entity();
    assert_eq!(a.index(), 0);
    assert_eq!(b.index(), 1);
    assert_eq!(c.index(), 2);
}

#[wasm_bindgen_test]
fn wasm_count_entities() {
    let mut engine = make_engine();
    assert_eq!(engine.count_entities(), 0);
    engine.create_entity();
    engine.create_entity();
    assert_eq!(engine.count_entities(), 2);
}

#[wasm_bindgen_test]
fn wasm_is_alive_true_for_live_entity() {
    let mut engine = make_engine();
    let id = engine.create_entity();
    assert!(engine.is_alive(id.index(), id.generation()));
}

#[wasm_bindgen_test]
fn wasm_delete_entity_returns_true() {
    let mut engine = make_engine();
    let id = engine.create_entity();
    assert!(engine.delete_entity(id.index(), id.generation()));
}

#[wasm_bindgen_test]
fn wasm_is_alive_false_after_delete() {
    let mut engine = make_engine();
    let id = engine.create_entity();
    engine.delete_entity(id.index(), id.generation());
    assert!(!engine.is_alive(id.index(), id.generation()));
}

#[wasm_bindgen_test]
fn wasm_delete_same_entity_twice_returns_false() {
    let mut engine = make_engine();
    let id = engine.create_entity();
    assert!(engine.delete_entity(id.index(), id.generation()));
    assert!(!engine.delete_entity(id.index(), id.generation()));
}

// ─── Stale-ID protection ──────────────────────────────────────────────────────

#[wasm_bindgen_test]
fn wasm_stale_id_rejected_after_slot_reuse() {
    let mut engine = make_engine();

    // Create and delete entity at slot 0, generation 0
    let old_id = engine.create_entity();
    engine.delete_entity(old_id.index(), old_id.generation());

    // Slot 0 is now reused — new entity gets generation 1
    let new_id = engine.create_entity();
    assert_eq!(new_id.index(), 0);
    assert_eq!(new_id.generation(), 1);

    // The OLD handle (index=0, generation=0) must now be rejected
    assert!(!engine.is_alive(old_id.index(), old_id.generation()));
    // But the NEW handle must be accepted
    assert!(engine.is_alive(new_id.index(), new_id.generation()));
}

#[wasm_bindgen_test]
fn wasm_delete_with_wrong_generation_rejected() {
    let mut engine = make_engine();
    let id = engine.create_entity();
    // Pass a wrong generation — must be rejected without deleting
    let deleted = engine.delete_entity(id.index(), id.generation() + 1);
    assert!(!deleted);
    // Entity should still be alive
    assert!(engine.is_alive(id.index(), id.generation()));
}

// ─── Component API ────────────────────────────────────────────────────────────

#[wasm_bindgen_test]
fn wasm_register_component_type_returns_sequential_ids() {
    let mut engine = make_engine();
    let t0 = engine.register_component_type();
    let t1 = engine.register_component_type();
    assert!(t1 > t0); // IDs are sequential
}

#[wasm_bindgen_test]
fn wasm_add_component_and_has_component() {
    let mut engine = make_engine();
    let id = engine.create_entity();
    let type_id = engine.register_component_type();

    // Add 4 raw bytes (one u32)
    let data: &[u8] = &[42u8, 0, 0, 0];
    assert!(engine.add_component(id.index(), id.generation(), type_id, data));
    assert!(engine.has_component(id.index(), id.generation(), type_id));
}

#[wasm_bindgen_test]
fn wasm_add_component_stale_id_rejected() {
    let mut engine = make_engine();
    let id = engine.create_entity();
    let type_id = engine.register_component_type();
    engine.delete_entity(id.index(), id.generation());

    // Stale handle — should refuse to add component
    let data: &[u8] = &[1u8, 0, 0, 0];
    assert!(!engine.add_component(id.index(), id.generation(), type_id, data));
}

#[wasm_bindgen_test]
fn wasm_get_component_raw_returns_bytes() {
    let mut engine = make_engine();
    let id = engine.create_entity();
    let type_id = engine.register_component_type();

    let value: u32 = 0xDEAD_BEEF;
    let data = value.to_le_bytes();
    engine.add_component(id.index(), id.generation(), type_id, &data[..]);

    let raw = engine.get_component_raw(id.index(), id.generation(), type_id);
    assert_eq!(raw.len(), 4);
    assert_eq!(u32::from_le_bytes([raw[0], raw[1], raw[2], raw[3]]), value);
}

#[wasm_bindgen_test]
fn wasm_get_component_raw_empty_for_missing() {
    let mut engine = make_engine();
    let id = engine.create_entity();
    let type_id = engine.register_component_type();

    let raw = engine.get_component_raw(id.index(), id.generation(), type_id);
    assert!(raw.is_empty());
}

#[wasm_bindgen_test]
fn wasm_remove_component() {
    let mut engine = make_engine();
    let id = engine.create_entity();
    let type_id = engine.register_component_type();
    let data: &[u8] = &[1u8, 0, 0, 0];
    engine.add_component(id.index(), id.generation(), type_id, &data);

    assert!(engine.remove_component(id.index(), id.generation(), type_id));
    assert!(!engine.has_component(id.index(), id.generation(), type_id));
}

// ─── Query API ────────────────────────────────────────────────────────────────

#[wasm_bindgen_test]
fn wasm_query_entities_returns_correct_set() {
    let mut engine = make_engine();
    let t0 = engine.register_component_type();
    let t1 = engine.register_component_type();

    let e0 = engine.create_entity();
    let e1 = engine.create_entity();
    let e2 = engine.create_entity();

    // e0: t0 + t1
    engine.update_entity_archetype(e0.index(), &[t0, t1]);
    // e1: t0 only
    engine.update_entity_archetype(e1.index(), &[t0]);
    // e2: t1 only
    engine.update_entity_archetype(e2.index(), &[t1]);

    let results_t0 = engine.query_entities(&[t0]);
    assert_eq!(results_t0.len(), 2); // e0 and e1

    let results_t1 = engine.query_entities(&[t1]);
    assert_eq!(results_t1.len(), 2); // e0 and e2

    let results_both = engine.query_entities(&[t0, t1]);
    assert_eq!(results_both.len(), 1); // e0 only
}

#[wasm_bindgen_test]
fn wasm_query_empty_when_no_entities() {
    let mut engine = make_engine();
    let t0 = engine.register_component_type();
    let results = engine.query_entities(&[t0]);
    assert!(results.is_empty());
}

// ─── Game loop API ────────────────────────────────────────────────────────────

#[wasm_bindgen_test]
fn wasm_tick_increments_frame_count() {
    let mut engine = make_engine();
    assert_eq!(engine.frame_count(), 0);
    engine.tick(16.0); // 16ms
    assert_eq!(engine.frame_count(), 1);
    engine.tick(16.0);
    assert_eq!(engine.frame_count(), 2);
}

#[wasm_bindgen_test]
fn wasm_delta_time_is_in_seconds() {
    let mut engine = make_engine();
    engine.tick(16.0); // 16ms → 0.016s
    assert!((engine.delta_time() - 0.016).abs() < 0.001);
}

#[wasm_bindgen_test]
fn wasm_total_time_accumulates() {
    let mut engine = make_engine();
    // Use 100ms steps (the max clamp value) × 10 = 1.0s total
    for _ in 0..10 {
        engine.tick(100.0);
    }
    assert!((engine.total_time() - 1.0).abs() < 0.01);
}

// ─── Stats ────────────────────────────────────────────────────────────────────

#[wasm_bindgen_test]
fn wasm_stats_is_valid_json_string() {
    let mut engine = make_engine();
    engine.create_entity();
    engine.tick(16.0);
    let stats = engine.stats();
    // Should contain known fields
    assert!(stats.contains("entities"));
    assert!(stats.contains("frame"));
    assert!(stats.contains("elapsed"));
}
