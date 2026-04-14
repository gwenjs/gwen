/**
 * @file Tests for place.ts — layout placement composables.
 *
 * Tests the layout context guard (_withLayoutContext, _isInLayoutContext)
 * and the three placement composables (placeGroup, placeActor, placePrefab).
 *
 * A minimal WASM bridge mock is injected via `_injectMockWasmEngine` so that
 * `getPlacementBridge()` succeeds without a real WASM binary. The mock records
 * calls to placement methods so tests can assert on transform application.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { PlaceHandle } from "../../src/actor/types";
import { definePrefab } from "../../src/actor/defines/define-prefab";
import { defineActor } from "../../src/actor/defines/define-actor";
import { createEngine } from "../../src/engine/gwen-engine";
import { _injectMockWasmEngine, _resetWasmBridge } from "../../src/engine/wasm-bridge";
import type { WasmEngine } from "../../src/engine/wasm-bridge";
import {
  _withLayoutContext,
  _isInLayoutContext,
  placeGroup,
  placeActor,
  placePrefab,
} from "../../src/actor/place";

// ─── Mock WASM bridge ─────────────────────────────────────────────────────────

/**
 * Minimal WasmEngine mock for placement tests.
 * Provides no-op implementations of all required methods plus the placement
 * methods used by getPlacementBridge() (add_entity_transform, set_entity_parent,
 * set_entity_local_position, bulk_destroy).
 */
function makePlacementMock() {
  return {
    // Placement methods (cast to PlacementBridge by getPlacementBridge)
    add_entity_transform: () => {},
    set_entity_parent: () => {},
    set_entity_local_position: () => {},
    bulk_destroy: () => {},
    // Minimal WasmEngineBase stubs
    create_entity: () => 0n,
    delete_entity: () => true,
    is_alive: () => true,
    count_entities: () => 0,
    register_component_type: () => 0,
    add_component: () => true,
    remove_component: () => true,
    has_component: () => false,
    get_component_raw: () => new Uint8Array(0),
    update_entity_archetype: () => {},
    remove_entity_from_query: () => {},
    query_entities: () => new Uint32Array(0),
    query_entities_to_buffer: () => 0,
    get_query_result_ptr: () => 0,
    get_entity_generation: () => 0,
    tick: () => {},
    alloc_shared_buffer: () => 0,
    free_shared_buffer: () => {},
    query_read_bulk: () => {},
    query_write_bulk: () => {},
    update_transforms: () => {},
    bulk_destroy_entities: () => {},
  } as unknown as WasmEngine;
}

beforeEach(() => {
  _injectMockWasmEngine(makePlacementMock());
});

afterEach(() => {
  _resetWasmBridge();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

const Position = { __name__: "Position" };
const SimplePrefab = definePrefab([{ def: Position, defaults: { x: 0, y: 0 } }]);

describe("layout context guard", () => {
  it("_isInLayoutContext returns false outside a layout", () => {
    expect(_isInLayoutContext()).toBe(false);
  });

  it("_isInLayoutContext returns true inside _withLayoutContext", () => {
    let inside = false;
    _withLayoutContext(() => {
      inside = _isInLayoutContext();
    });
    expect(inside).toBe(true);
  });

  it("placeGroup throws when called outside a layout context", () => {
    expect(() => placeGroup({ at: [0, 0] })).toThrow(/placeGroup.*defineLayout/);
  });

  it("placeActor throws when called outside a layout context", () => {
    const Actor = defineActor(SimplePrefab, () => {});
    expect(() => placeActor(Actor, { at: [0, 0] })).toThrow(/placeActor.*defineLayout/);
  });

  it("placePrefab throws when called outside a layout context", () => {
    expect(() => placePrefab(SimplePrefab, { at: [0, 0] })).toThrow(/placePrefab.*defineLayout/);
  });
});

describe("placeGroup", () => {
  it("returns a PlaceHandle with a valid entityId inside layout context", async () => {
    const engine = await createEngine();
    let handle: ReturnType<typeof placeGroup> | undefined;

    await engine.run(async () => {
      _withLayoutContext(() => {
        handle = placeGroup({ at: [10, 20] });
      });
    });

    expect(typeof handle!.entityId).toBe("bigint");
    expect(handle!.api).toBeUndefined();
  });

  it("places entity at specified position", async () => {
    const engine = await createEngine();
    let handle: ReturnType<typeof placeGroup> | undefined;

    await engine.run(async () => {
      _withLayoutContext(() => {
        handle = placeGroup({ at: [5, 10] });
      });
    });

    expect(handle).toBeDefined();
    expect(typeof handle!.entityId).toBe("bigint");
  });
});

describe("placeActor", () => {
  it("spawns an actor entity and returns a PlaceHandle with api", async () => {
    const engine = await createEngine();
    const Actor = defineActor(SimplePrefab, () => ({ greet: () => "hello" }));
    await engine.use(Actor._plugin);
    let handle: PlaceHandle<{ greet(): string }> | undefined;

    await engine.run(async () => {
      _withLayoutContext(() => {
        handle = placeActor(Actor, { at: [5, 10] });
      });
    });

    expect(typeof handle!.entityId).toBe("bigint");
    expect(handle!.api.greet()).toBe("hello");
  });

  it("tracks spawned actor in instances", async () => {
    const engine = await createEngine();
    const Actor = defineActor(SimplePrefab, () => ({}));
    await engine.use(Actor._plugin);
    let handle: ReturnType<typeof placeActor> | undefined;

    await engine.run(async () => {
      _withLayoutContext(() => {
        handle = placeActor(Actor, { at: [0, 0] });
      });
    });

    expect(Actor._instances.has(handle!.entityId)).toBe(true);
  });
});

describe("placePrefab", () => {
  it("creates an entity with prefab components", async () => {
    const engine = await createEngine();
    let handle: ReturnType<typeof placePrefab> | undefined;

    await engine.run(async () => {
      _withLayoutContext(() => {
        handle = placePrefab(SimplePrefab, { at: [0, 0] });
      });
    });

    expect(typeof handle!.entityId).toBe("bigint");
    expect(handle!.api).toBeUndefined();
  });
});

describe("PlaceHandle methods", () => {
  it("moveTo updates entity position", async () => {
    const engine = await createEngine();
    let handle: ReturnType<typeof placeGroup> | undefined;

    await engine.run(async () => {
      _withLayoutContext(() => {
        handle = placeGroup({ at: [0, 0] });
      });
    });

    expect(() => handle!.moveTo([10, 20])).not.toThrow();
    expect(() => handle!.moveTo([10, 20, 30])).not.toThrow();
  });

  it("despawn removes entity", async () => {
    const engine = await createEngine();
    let handle: ReturnType<typeof placeGroup> | undefined;

    await engine.run(async () => {
      _withLayoutContext(() => {
        handle = placeGroup({ at: [0, 0] });
      });
    });

    expect(() => handle!.despawn()).not.toThrow();
  });
});

describe("_withLayoutContext captures entities", () => {
  it("returns entities list from context", async () => {
    const engine = await createEngine();
    let result: ReturnType<typeof _withLayoutContext> | undefined;

    await engine.run(async () => {
      result = _withLayoutContext(() => {
        placeGroup({ at: [0, 0] });
        placeGroup({ at: [10, 10] });
      });
    });

    expect(result!.entities).toHaveLength(2);
    expect(result!.entities.every((e) => typeof e === "bigint")).toBe(true);
  });

  it("returns result from factory", () => {
    const result = _withLayoutContext(() => ({ foo: "bar" }));
    expect(result.result).toEqual({ foo: "bar" });
  });

  it("restores previous context after execution", () => {
    expect(_isInLayoutContext()).toBe(false);
    _withLayoutContext(() => {
      expect(_isInLayoutContext()).toBe(true);
    });
    expect(_isInLayoutContext()).toBe(false);
  });
});
