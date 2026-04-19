import { describe, it, expect, beforeEach } from "vitest";
import { createEngine } from "../../src/engine/gwen-engine";
import { defineLayout } from "../../src/actor/runtime/define-layout";
import { useLayout } from "../../src/actor/runtime/use-layout";
import { definePrefab } from "../../src/actor/runtime/define-prefab";
import { defineActor } from "../../src/actor/runtime/define-actor";
import { placeActor, placeGroup } from "../../src/actor/runtime/place";
import { WasmBridgeImpl } from "../../src/engine/wasm-bridge";
import type { WasmEngine } from "../../src/engine/wasm-bridge";

function makePlacementMock(): WasmEngine {
  return {
    add_entity_transform: () => {},
    set_entity_parent: () => {},
    set_entity_local_position: () => {},
    bulk_destroy: () => {},
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

let bridge: WasmBridgeImpl;

beforeEach(() => {
  bridge = new WasmBridgeImpl();
  bridge._injectMock(makePlacementMock());
});

const Pos = { __name__: "Position" };
const SimplePrefab = definePrefab([{ def: Pos, defaults: { x: 0, y: 0 } }]);

describe("useLayout — lazy mode", () => {
  it("load() makes active true and provides refs", async () => {
    const engine = await createEngine({ _bridge: bridge });
    const Actor = defineActor(SimplePrefab, () => ({}));
    await engine.use(Actor._plugin);

    await engine.run(async () => {
      const Layout = defineLayout(() => {
        const a = placeActor(Actor, { at: [0, 0] });
        return { a };
      });
      const handle = useLayout(Layout, { lazy: true });
      expect(handle.active).toBe(false);
      await handle.load();
      expect(handle.active).toBe(true);
      expect(typeof handle.refs.a.entityId).toBe("bigint");
    });
  });

  it("dispose() makes active false", async () => {
    const engine = await createEngine({ _bridge: bridge });
    const Actor = defineActor(SimplePrefab, () => ({}));
    await engine.use(Actor._plugin);

    await engine.run(async () => {
      const Layout = defineLayout(() => ({ a: placeActor(Actor, {}) }));
      const handle = useLayout(Layout, { lazy: true });
      await handle.load();
      await handle.dispose();
      expect(handle.active).toBe(false);
    });
  });

  it("dispose() is idempotent — safe to call twice", async () => {
    const engine = await createEngine({ _bridge: bridge });
    await engine.run(async () => {
      const Layout = defineLayout(() => ({ g: placeGroup({ at: [0, 0] }) }));
      const handle = useLayout(Layout, { lazy: true });
      await handle.load();
      await handle.dispose();
      await expect(handle.dispose()).resolves.toBeUndefined();
    });
  });

  it("two instances of the same layout definition are independent", async () => {
    const engine = await createEngine({ _bridge: bridge });
    const Actor = defineActor(SimplePrefab, () => ({}));
    await engine.use(Actor._plugin);

    await engine.run(async () => {
      const Layout = defineLayout(() => ({ a: placeActor(Actor, {}) }));
      const h1 = useLayout(Layout, { lazy: true });
      const h2 = useLayout(Layout, { lazy: true });
      await h1.load();
      await h2.load();
      expect(h1.refs.a.entityId).not.toBe(h2.refs.a.entityId);
      await h1.dispose();
      expect(h2.active).toBe(true);
    });
  });
});
