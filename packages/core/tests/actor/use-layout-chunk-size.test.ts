import { stubComponent } from "../helpers/stub-component";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEngine } from "../../src/engine/engine-factory";
import type { GwenEngine } from "../../src/engine/engine-types";
import { entityIndex } from "../../src/engine/engine-api";
import { defineLayout } from "../../src/actor/runtime/define-layout";
import { useLayout } from "../../src/actor/runtime/use-layout";
import { definePrefab } from "../../src/actor/runtime/define-prefab";
import { defineActor } from "../../src/actor/runtime/define-actor";
import { placeActor, placeGroup, placePrefab } from "../../src/actor/runtime/place";
import type { PlaceHandle } from "../../src/actor/runtime/types";
import { WasmBridgeImpl } from "../../src/engine/wasm-bridge";
import { GwenComposableError } from "../../src/engine/engine-errors";
import { createMockWasmEngine, mockEntitySurface } from "../helpers/mock-wasm-engine";

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

const engines: GwenEngine[] = [];

/** One real engine on its own mock WASM bridge, stopped in `afterEach`. */
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
  while (engines.length > 0) {
    await engines.pop()?.stop();
  }
});

const FRAME = 1 / 60;

/** A layout of `count` groups keyed `g0..g{count-1}`. */
function groupsLayout(count: number) {
  return defineLayout(() => {
    const refs: Record<string, PlaceHandle<void>> = {};
    for (let i = 0; i < count; i++) refs[`g${i}`] = placeGroup({ at: [i, 0] });
    return refs;
  });
}

/** Tracks whether a promise has settled, without awaiting it. */
function track(promise: Promise<void>) {
  const state = { settled: false };
  void promise.then(() => {
    state.settled = true;
  });
  return state;
}

/** Let promise reactions queued by a frame run. */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe("useLayout chunkSize — progressive spawn", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
  });

  it("m > n: n alive after frame 1, all m after ceil(m/n) frames, load() resolves only then", async () => {
    const engine = await newEngine();
    const base = engine.getStats().entityCount;
    await engine.run(async () => {
      const handle = useLayout(groupsLayout(10), { lazy: true, chunkSize: 3 });
      const loading = handle.load();
      const done = track(loading);
      await flush();
      expect(engine.getStats().entityCount - base).toBe(0);

      const alive: number[] = [];
      for (let frame = 1; frame <= 4; frame++) {
        await engine.advance(FRAME);
        await flush();
        alive.push(engine.getStats().entityCount - base);
        if (frame < 4) expect(done.settled).toBe(false);
      }
      expect(alive).toEqual([3, 6, 9, 10]);
      expect(done.settled).toBe(true);
      await loading;
      expect(handle.active).toBe(true);
      await handle.dispose();
    });
  });

  it.each([
    { name: "chunkSize == m", m: 6, n: 6, frames: 1 },
    { name: "chunkSize == m + 1", m: 6, n: 7, frames: 1 },
    { name: "chunkSize == 1", m: 4, n: 1, frames: 4 },
  ])("boundary $name: all alive after $frames frame(s), not before", async ({ m, n, frames }) => {
    const engine = await newEngine();
    const base = engine.getStats().entityCount;
    await engine.run(async () => {
      const handle = useLayout(groupsLayout(m), { lazy: true, chunkSize: n });
      const loading = handle.load();
      const done = track(loading);
      await flush();
      for (let frame = 1; frame <= frames; frame++) {
        expect(done.settled).toBe(false);
        expect(engine.getStats().entityCount - base).toBe((frame - 1) * n);
        await engine.advance(FRAME);
        await flush();
        expect(engine.getStats().entityCount - base).toBe(Math.min(m, frame * n));
      }
      expect(done.settled).toBe(true);
      await loading;
      await handle.dispose();
    });
  });

  it.each([
    { value: 0, text: "0" },
    { value: -2, text: "-2" },
    { value: 1.5, text: "1.5" },
    { value: Number.NaN, text: "NaN" },
    { value: Number.POSITIVE_INFINITY, text: "Infinity" },
  ])(
    "rejects chunkSize $text at useLayout() with a code and a message naming it",
    async ({ value, text }) => {
      const engine = await newEngine();
      await engine.run(async () => {
        let caught: unknown;
        try {
          useLayout(groupsLayout(2), { lazy: true, chunkSize: value });
        } catch (error: unknown) {
          caught = error;
        }
        expect(caught).toBeInstanceOf(GwenComposableError);
        expect(caught).toMatchObject({
          code: "COMPOSABLE:INVALID_CHUNK_SIZE",
          message: expect.stringContaining(text),
        });
      });
    },
  );

  it("refs have the same shape and order as the one-pass load, and are {} before load() resolves", async () => {
    const Actor = defineActor(SimplePrefab, () => ({ ping: () => "pong" }));
    const build = () =>
      defineLayout(() => {
        const group = placeGroup({ at: [1, 1] });
        const hero = placeActor(Actor, { at: [2, 2], parent: group });
        const tile = placePrefab(SimplePrefab, { at: [3, 3], parent: group });
        const extra = placeGroup({});
        return { group, hero, tile, extra };
      });

    const onePassEngine = await newEngine();
    await onePassEngine.use(Actor._plugin);
    let onePass: { keys: string[]; indexes: number[]; api: string } | undefined;
    await onePassEngine.run(async () => {
      const handle = useLayout(build());
      await handle.load();
      onePass = {
        keys: Object.keys(handle.refs),
        indexes: Object.values(handle.refs).map((ref) => entityIndex(ref.entityId)),
        api: handle.refs.hero.api.ping(),
      };
    });

    const engine = await newEngine();
    await engine.use(Actor._plugin);
    await engine.run(async () => {
      const handle = useLayout(build(), { lazy: true, chunkSize: 1 });
      const loading = handle.load();
      expect(handle.refs).toEqual({});
      await engine.advance(FRAME);
      await flush();
      expect(Object.keys(handle.refs)).toEqual([]);
      for (let frame = 2; frame <= 4; frame++) await engine.advance(FRAME);
      await loading;
      expect(Object.keys(handle.refs)).toEqual(onePass?.keys);
      expect(Object.values(handle.refs).map((ref) => entityIndex(ref.entityId))).toEqual(
        onePass?.indexes,
      );
      expect(handle.refs.hero.api.ping()).toBe(onePass?.api);
    });
  });

  it.each(["entityId", "api"] as const)(
    "reading %s of a handle inside the factory fails with a coded error",
    async (read) => {
      const Actor = defineActor(SimplePrefab, () => ({}));
      const engine = await newEngine();
      await engine.use(Actor._plugin);
      await engine.run(async () => {
        const layout = defineLayout(() => {
          const hero = placeActor(Actor, {});
          void hero[read];
          return { hero };
        });
        const handle = useLayout(layout, { lazy: true, chunkSize: 2 });
        const error = await handle.load().then(
          () => undefined,
          (rejection: unknown) => rejection,
        );
        expect(error).toBeInstanceOf(GwenComposableError);
        expect(error).toMatchObject({ code: "COMPOSABLE:LAYOUT_HANDLE_NOT_SPAWNED" });
        expect(handle.active).toBe(false);
      });
    },
  );

  it("a parent placed after its child fails the load with the coded error, never an undefined id", async () => {
    const engine = await newEngine();
    await engine.run(async () => {
      const layout = defineLayout(() => {
        const slot: { late?: PlaceHandle<void> } = {};
        const early = placeGroup({
          get parent(): PlaceHandle<void> {
            if (slot.late === undefined) throw new Error("late handle not set");
            return slot.late;
          },
        });
        const late = placeGroup({});
        slot.late = late;
        return { early, late };
      });
      const handle = useLayout(layout, { lazy: true, chunkSize: 1 });
      const loading = handle.load();
      const outcome = loading.then(
        () => undefined,
        (rejection: unknown) => rejection,
      );
      await engine.advance(FRAME);
      await engine.advance(FRAME);
      const error = await outcome;
      expect(error).toBeInstanceOf(GwenComposableError);
      expect(error).toMatchObject({ code: "COMPOSABLE:LAYOUT_HANDLE_NOT_SPAWNED" });
      expect(handle.active).toBe(false);
    });
  });

  it("dispose() during a progressive load stops further spawns, destroys what exists, and load() resolves inactive", async () => {
    const engine = await newEngine();
    const base = engine.getStats().entityCount;
    await engine.run(async () => {
      const handle = useLayout(groupsLayout(10), { lazy: true, chunkSize: 3 });
      const loading = handle.load();
      const done = track(loading);
      await engine.advance(FRAME);
      await flush();
      expect(engine.getStats().entityCount - base).toBe(3);

      await handle.dispose();
      expect(engine.getStats().entityCount - base).toBe(0);
      await loading;
      expect(done.settled).toBe(true);
      expect(handle.active).toBe(false);
      expect(handle.refs).toEqual({});

      for (let frame = 0; frame < 5; frame++) await engine.advance(FRAME);
      expect(engine.getStats().entityCount - base).toBe(0);
      expect(handle.active).toBe(false);
    });
  });

  it("a second load() while loading returns the pending promise and does not spawn twice", async () => {
    const engine = await newEngine();
    const base = engine.getStats().entityCount;
    await engine.run(async () => {
      let factoryRuns = 0;
      const layout = defineLayout(() => {
        factoryRuns += 1;
        return groupsLayout(4)._factory();
      });
      const handle = useLayout(layout, { lazy: true, chunkSize: 2 });
      const first = handle.load();
      const second = handle.load();
      expect(second).toBe(first);
      await engine.advance(FRAME);
      await engine.advance(FRAME);
      await first;
      expect(engine.getStats().entityCount - base).toBe(4);
      expect(factoryRuns).toBe(1);
      await handle.load();
      expect(engine.getStats().entityCount - base).toBe(4);
      await handle.dispose();
    });
  });

  it("without chunkSize, load() still spawns everything in one pass while a chunked layout waits for frames", async () => {
    const engine = await newEngine();
    const base = engine.getStats().entityCount;
    await engine.run(async () => {
      const chunked = useLayout(groupsLayout(3), { lazy: true, chunkSize: 1 });
      const chunkedLoading = chunked.load();
      const onePass = useLayout(groupsLayout(10), { lazy: true });
      await onePass.load();
      await flush();
      expect(engine.getStats().entityCount - base).toBe(10);
      expect(Object.keys(onePass.refs)).toEqual(Array.from({ length: 10 }, (_, i) => `g${i}`));
      const indexes = Object.values(onePass.refs).map((ref) => entityIndex(ref.entityId));
      const first = indexes[0] ?? -1;
      expect(indexes).toEqual(Array.from({ length: 10 }, (_, i) => first + i));
      expect(chunked.active).toBe(false);

      for (let frame = 0; frame < 3; frame++) await engine.advance(FRAME);
      await chunkedLoading;
      expect(engine.getStats().entityCount - base).toBe(13);
      await onePass.dispose();
      await chunked.dispose();
    });
  });

  it("passing chunkSize does not log the old console.warn", async () => {
    const engine = await newEngine();
    await engine.run(async () => {
      const handle = useLayout(groupsLayout(2), { lazy: true, chunkSize: 1 });
      const loading = handle.load();
      await engine.advance(FRAME);
      await engine.advance(FRAME);
      await loading;
      expect(warn).not.toHaveBeenCalled();
      await handle.dispose();
    });
  });

  it("two layouts with different chunkSize progress independently", async () => {
    const engine = await newEngine();
    const base = engine.getStats().entityCount;
    await engine.run(async () => {
      const a = useLayout(groupsLayout(4), { lazy: true, chunkSize: 2 });
      const b = useLayout(groupsLayout(9), { lazy: true, chunkSize: 3 });
      const aDone = track(a.load());
      const bDone = track(b.load());
      const totals: number[] = [];
      const settled: Array<[boolean, boolean]> = [];
      for (let frame = 1; frame <= 3; frame++) {
        await engine.advance(FRAME);
        await flush();
        totals.push(engine.getStats().entityCount - base);
        settled.push([aDone.settled, bDone.settled]);
      }
      expect(totals).toEqual([5, 10, 13]);
      expect(settled).toEqual([
        [false, false],
        [true, false],
        [true, true],
      ]);
      await a.dispose();
      expect(engine.getStats().entityCount - base).toBe(9);
      await b.dispose();
    });
  });
  it("an empty progressive load can be disposed and loaded again: the factory runs again and spawns by chunks", async () => {
    const engine = await newEngine();
    const base = engine.getStats().entityCount;
    await engine.run(async () => {
      let runs = 0;
      const layout = defineLayout(() => {
        runs += 1;
        const refs: Record<string, PlaceHandle<void>> = {};
        if (runs > 1) for (let i = 0; i < 3; i++) refs[`g${i}`] = placeGroup({ at: [i, 0] });
        return refs;
      });
      const handle = useLayout(layout, { lazy: true, chunkSize: 2 });
      await handle.load();
      expect(handle.active).toBe(true);
      await handle.dispose();
      expect(handle.active).toBe(false);

      const reloading = handle.load();
      const done = track(reloading);
      await flush();
      expect(runs).toBe(2);
      expect(engine.getStats().entityCount - base).toBe(0);
      await engine.advance(FRAME);
      await flush();
      expect(engine.getStats().entityCount - base).toBe(2);
      expect(done.settled).toBe(false);
      await engine.advance(FRAME);
      await reloading;
      expect(engine.getStats().entityCount - base).toBe(3);
      expect(handle.active).toBe(true);
      await handle.dispose();
    });
  });

  it("engine.stop() during a progressive load settles load() with the layout inactive and stops spawning", async () => {
    const engine = await newEngine();
    const base = engine.getStats().entityCount;
    let handle: ReturnType<typeof useLayout<Record<string, PlaceHandle<void>>>> | undefined;
    await engine.run(async () => {
      handle = useLayout(groupsLayout(10), { lazy: true, chunkSize: 3 });
    });
    const loading = handle?.load();
    expect(loading).toBeDefined();
    if (!loading || !handle) return;
    const done = track(loading);
    await engine.advance(FRAME);
    await flush();
    expect(engine.getStats().entityCount - base).toBe(3);
    expect(done.settled).toBe(false);

    await engine.stop();
    await flush();
    expect(done.settled).toBe(true);
    await loading;
    expect(handle.active).toBe(false);
    expect(handle.refs).toEqual({});
  });
});
