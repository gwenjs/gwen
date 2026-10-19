import { stubComponent } from "../helpers/stub-component";
import { afterEach, describe, expect, it } from "vitest";
import { createEngine } from "../../src/engine/engine-factory";
import type { GwenEngine } from "../../src/engine/engine-types";
import { defineLayout } from "../../src/actor/runtime/define-layout";
import { useLayout } from "../../src/actor/runtime/use-layout";
import { definePrefab } from "../../src/actor/runtime/define-prefab";
import { defineActor } from "../../src/actor/runtime/define-actor";
import { placeActor, placeGroup } from "../../src/actor/runtime/place";
import type { LayoutHandle, PlaceHandle } from "../../src/actor/runtime/types";
import { WasmBridgeImpl } from "../../src/engine/wasm-bridge";
import { createMockWasmEngine, mockEntitySurface } from "../helpers/mock-wasm-engine";

/** Makes the mock `bulk_destroy` throw: on every call (`all`) or only on call number `onCall`. */
const bulkDestroyFault = { all: false, onCall: 0, calls: 0 };

/** Placement mock whose entity table is real: `bulk_destroy` removes what `create_entity` added. */
function makePlacementMock() {
  const surface = mockEntitySurface();
  const live = new Set<number>();
  let next = 0;
  return {
    surface,
    engine: createMockWasmEngine({
      ...surface.exports,
      create_entity: () => {
        const index = next;
        next += 1;
        live.add(index);
        return { index, generation: 0 };
      },
      count_entities: () => live.size,
      is_alive: (index: number) => live.has(index),
      delete_entity: (index: number) => live.delete(index),
      add_entity_transform: () => {},
      set_entity_parent: () => {},
      set_entity_local_position: () => {},
      bulk_destroy: (indices: Uint32Array) => {
        bulkDestroyFault.calls += 1;
        if (bulkDestroyFault.all || bulkDestroyFault.calls === bulkDestroyFault.onCall) {
          throw new Error("bulk_destroy fault");
        }
        for (const index of indices) live.delete(index);
      },
      add_component: () => true,
      get_component_raw: () => new Uint8Array(0),
      update_entity_archetype: () => {},
      remove_entity_from_query: () => {},
      query_entities: () => new Uint32Array(0),
      query_entities_to_buffer: () => 0,
      get_query_result_ptr: () => 0,
      alloc_shared_buffer: () => 0,
      free_shared_buffer: () => {},
      query_read_bulk: () => {},
      query_write_bulk: () => {},
      update_transforms: () => {},
      bulk_destroy_entities: () => {},
    }),
  };
}

const Pos = stubComponent("Position");
const SimplePrefab = definePrefab([{ def: Pos, defaults: { x: 0, y: 0 } }]);
const FRAME = 1 / 60;
const engines: GwenEngine[] = [];

async function newEngine(): Promise<GwenEngine> {
  const bridge = new WasmBridgeImpl();
  const mock = makePlacementMock();
  bridge._injectMock(mock.engine);
  bridge._injectMockExports({ memory: mock.surface.memory });
  const engine = await createEngine({ _bridge: bridge });
  engines.push(engine);
  return engine;
}

afterEach(async () => {
  bulkDestroyFault.all = false;
  bulkDestroyFault.onCall = 0;
  bulkDestroyFault.calls = 0;
  while (engines.length > 0) await engines.pop()?.stop();
});

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

/** Records every event of the engine error bus. */
function recordErrors(engine: GwenEngine) {
  const events: Array<{ code: string; level: string; error?: unknown }> = [];
  engine.errors.on((event) => {
    events.push({ code: event.code, level: event.level, error: event.error });
  });
  return events;
}

function rejection(promise: Promise<void>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (error: unknown) => error,
  );
}

describe("useLayout failure paths", () => {
  it("a destroy that throws while cancelling inside a spawn does not escape the frame hook", async () => {
    const engine = await newEngine();
    const base = engine.getStats().entityCount;
    const events = recordErrors(engine);
    const slot: { self?: LayoutHandle<Record<string, PlaceHandle<unknown>>> } = {};
    let setups = 0;
    const Actor = defineActor(SimplePrefab, () => {
      setups += 1;
      if (setups === 2) void slot.self?.dispose();
      return {};
    });
    await engine.use(Actor._plugin);
    await engine.run(async () => {
      const layout = defineLayout(() => ({
        a: placeActor(Actor, {}),
        b: placeActor(Actor, {}),
        c: placeActor(Actor, {}),
      }));
      const self = useLayout(layout, { lazy: true, chunkSize: 5 });
      slot.self = self;
      const loading = self.load();
      // dispose() inside the second spawn destroys with call 1; the cleanup after the loop is call 2.
      bulkDestroyFault.onCall = 2;
      await engine.advance(FRAME);
      await loading;
      expect(events.map((event) => event.code)).toEqual(["COMPOSABLE:LAYOUT_DISPOSE_FAILED"]);
      expect(events[0]?.level).toBe("error");
      expect(self.active).toBe(false);
      expect(engine.getStats().entityCount - base).toBe(1);
    });
  });

  it("engine.stop() resolves and reports on the error bus when destroying a loading layout throws", async () => {
    const engine = await newEngine();
    const events = recordErrors(engine);
    let handle: LayoutHandle<Record<string, PlaceHandle<void>>> | undefined;
    await engine.run(async () => {
      const layout = defineLayout(() => ({
        a: placeGroup({}),
        b: placeGroup({}),
        c: placeGroup({}),
      }));
      handle = useLayout(layout, { lazy: true, chunkSize: 2 });
    });
    const loading = handle?.load();
    if (!loading) throw new Error("layout handle missing");
    await engine.advance(FRAME);
    bulkDestroyFault.all = true;
    await expect(engine.stop()).resolves.toBeUndefined();
    bulkDestroyFault.all = false;
    await loading;
    expect(engine.state).toBe("stopped");
    expect(events.map((event) => event.code)).toContain("COMPOSABLE:LAYOUT_DISPOSE_FAILED");
    expect(handle?.active).toBe(false);
  });

  it("a one-pass load whose factory throws destroys what it spawned, rejects with that error, and can load again", async () => {
    const engine = await newEngine();
    const base = engine.getStats().entityCount;
    await engine.run(async () => {
      let fail = true;
      const layout = defineLayout(() => {
        const a = placeGroup({});
        const b = placeGroup({});
        if (fail) throw new Error("factory boom");
        return { a, b };
      });
      const handle = useLayout(layout, { lazy: true });
      expect(await rejection(handle.load())).toMatchObject({ message: "factory boom" });
      expect(engine.getStats().entityCount - base).toBe(0);
      expect(handle.active).toBe(false);
      expect(handle.refs).toEqual({});

      fail = false;
      await handle.load();
      expect(handle.active).toBe(true);
      expect(engine.getStats().entityCount - base).toBe(2);
      await handle.dispose();
      expect(engine.getStats().entityCount - base).toBe(0);
    });
  });

  it("a one-pass load whose place call throws after createEntity leaves nothing alive", async () => {
    const engine = await newEngine();
    const base = engine.getStats().entityCount;
    await engine.run(async () => {
      const layout = defineLayout(() => ({
        ok: placeGroup({}),
        bad: placeGroup({
          get at(): [number, number] {
            throw new Error("bad at");
          },
        }),
      }));
      const handle = useLayout(layout, { lazy: true });
      expect(await rejection(handle.load())).toMatchObject({ message: "bad at" });
      expect(engine.getStats().entityCount - base).toBe(0);
    });
  });

  it("a one-pass load failure still rejects with the first error when destroying throws too", async () => {
    const engine = await newEngine();
    await engine.run(async () => {
      const layout = defineLayout(() => {
        placeGroup({});
        throw new Error("factory boom");
      });
      const handle = useLayout(layout, { lazy: true });
      bulkDestroyFault.all = true;
      const error = await rejection(handle.load());
      bulkDestroyFault.all = false;
      expect(error).toMatchObject({ message: "factory boom" });
      expect(handle.active).toBe(false);
      // The destroy was attempted (and failed): the spawned entity is not silently abandoned.
      expect(bulkDestroyFault.calls).toBe(1);
    });
  });

  it("lazy:false one-pass failure is reported on the engine error bus, not as an unhandled rejection", async () => {
    const engine = await newEngine();
    const base = engine.getStats().entityCount;
    const events = recordErrors(engine);
    await engine.run(async () => {
      const layout = defineLayout(() => {
        placeGroup({});
        throw new Error("factory boom");
      });
      const handle = useLayout(layout);
      await flush();
      expect(events.map((event) => event.code)).toEqual(["COMPOSABLE:LAYOUT_LOAD_FAILED"]);
      expect(events[0]?.level).toBe("error");
      expect(events[0]?.error).toMatchObject({ message: "factory boom" });
      expect(handle.active).toBe(false);
      expect(engine.getStats().entityCount - base).toBe(0);
    });
  });
});
