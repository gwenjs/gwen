import { describe, expect, it } from "vitest";
import { GwenError } from "@gwenjs/schema";

import {
  CoreErrorCodes,
  createEngine,
  defineComponent,
  Types,
  type GwenEngine,
} from "../../src/index";
import { defineActor, defineActorPool, definePrefab } from "../../src/actor/index";
import { defineSystem, onUpdate, useQuery } from "../../src/system/index";

// interim destroy-during-loop: passes on the base, added with the fix

const Position = defineComponent({
  name: "QueryChunkPos",
  schema: { x: Types.f32, y: Types.f32 },
  defaults: { x: 0, y: 0 },
});

const PoolPos = defineComponent({
  name: "QueryChunkPoolPos",
  schema: { x: Types.f32 },
  defaults: { x: 0 },
});

const Speed = defineComponent({
  name: "QueryChunkSpeed",
  schema: { v: Types.f32 },
  defaults: { v: 0 },
});

async function withEngine(run: (engine: GwenEngine) => Promise<void>): Promise<void> {
  const engine = await createEngine({ maxEntities: 32 });
  try {
    await run(engine);
  } finally {
    await engine.stop();
  }
}

describe("useQuery chunks", () => {
  it("chunk count is the awake row count", async () => {
    await withEngine(async (engine) => {
      const id = engine.createEntity();
      engine.addComponent(id, Position, { x: 3, y: 4 });
      const query = engine.run(() => useQuery([Position]));

      let count: number | undefined;
      for (const chunk of query) {
        count = (chunk as { count?: number }).count;
      }

      expect(count).toBe(1);
    });
  });

  it("a field write is a typed-array store", async () => {
    await withEngine(async (engine) => {
      const id = engine.createEntity();
      engine.addComponent(id, Position, { x: 3, y: 4 });
      const query = engine.run(() => useQuery([Position]));

      let column: unknown;
      for (const chunk of query) {
        const cols = chunk.get(Position) as { x?: unknown };
        column = cols.x;
      }

      expect(column).toBeInstanceOf(Float32Array);
    });
  });

  it("a column write is visible to the next system and to getComponent", async () => {
    await withEngine(async (engine) => {
      const id = engine.createEntity();
      engine.addComponent(id, Position, { x: 1, y: 4 });

      await engine.use(
        defineSystem("query-chunk-writer", () => {
          const query = useQuery([Position]);
          onUpdate(() => {
            for (const chunk of query) {
              const cols = chunk.get(Position) as { x?: unknown };
              if (cols.x instanceof Float32Array) cols.x[0] = 9;
            }
          });
        })(),
      );
      let seen: number | undefined;
      await engine.use(
        defineSystem("query-chunk-reader", () => {
          onUpdate(() => {
            seen = engine.getComponent(id, Position)?.x;
          });
        })(),
      );

      await engine.startExternal();
      await engine.advance(0.016);

      expect(seen).toBe(9);
    });
  });

  it("each() still returns the component value", async () => {
    await withEngine(async (engine) => {
      const id = engine.createEntity();
      engine.addComponent(id, Position, { x: 3, y: 4 });
      const query = engine.run(() => useQuery([Position]));
      const each = (
        query as { each?: () => Iterable<{ get(def: typeof Position): { x: number } }> }
      ).each;

      expect(typeof each).toBe("function");
      if (typeof each !== "function") return;

      let x: number | undefined;
      for (const row of each()) x = row.get(Position).x;
      expect(x).toBe(3);
    });
  });

  it("Query.count is the awake total", async () => {
    await withEngine(async (engine) => {
      const first = engine.createEntity();
      const second = engine.createEntity();
      engine.addComponent(first, Position, { x: 1, y: 0 });
      engine.addComponent(second, Position, { x: 2, y: 0 });
      const query = engine.run(() => useQuery([Position]));

      expect((query as { count?: number }).count).toBe(2);
    });
  });

  it("entityId(row) is the packed id", async () => {
    await withEngine(async (engine) => {
      const id = engine.createEntity();
      engine.addComponent(id, Position, { x: 3, y: 4 });
      const query = engine.run(() => useQuery([Position]));

      let found: bigint | undefined;
      for (const chunk of query) {
        const entityId = (chunk as { entityId?: (row: number) => bigint }).entityId;
        expect(typeof entityId).toBe("function");
        if (typeof entityId !== "function") return;
        found = entityId(0);
      }

      expect(found).toBe(id);
    });
  });

  it("entityId outside the row range throws CORE:QUERY_INVALID", async () => {
    await withEngine(async (engine) => {
      const id = engine.createEntity();
      engine.addComponent(id, Position, { x: 3, y: 4 });
      const query = engine.run(() => useQuery([Position]));

      let caught: unknown;
      for (const chunk of query) {
        const view = chunk as { count?: number; entityId?: (row: number) => bigint };
        expect(typeof view.entityId).toBe("function");
        if (typeof view.entityId !== "function" || typeof view.count !== "number") return;
        try {
          view.entityId(view.count);
        } catch (error: unknown) {
          caught = error;
        }
      }

      expect(caught).toBeInstanceOf(GwenError);
      expect(caught).toMatchObject({ code: CoreErrorCodes.QUERY_INVALID });
    });
  });

  it("a chunk kept while the iterator advances throws CORE:QUERY_INVALID", async () => {
    await withEngine(async (engine) => {
      const positionOnly = engine.createEntity();
      engine.addComponent(positionOnly, Position, { x: 1, y: 0 });
      const withSpeed = engine.createEntity();
      engine.addComponent(withSpeed, Position, { x: 2, y: 0 });
      engine.addComponent(withSpeed, Speed, { v: 3 });
      const query = engine.run(() => useQuery([Position]));
      const iterator = query[Symbol.iterator]();
      const first = iterator.next();
      expect(first.done).toBe(false);
      if (first.done !== false) return;
      const kept = first.value;
      const second = iterator.next();

      expect(second.done).toBe(false);
      if (second.done !== false) return;
      let caughtGet: unknown;
      try {
        kept.get(Position);
      } catch (error: unknown) {
        caughtGet = error;
      }
      let caughtId: unknown;
      try {
        kept.entityId(0);
      } catch (error: unknown) {
        caughtId = error;
      }

      expect(caughtGet).toBeInstanceOf(GwenError);
      expect(caughtGet).toMatchObject({ code: CoreErrorCodes.QUERY_INVALID });
      expect(caughtId).toBeInstanceOf(GwenError);
      expect(caughtId).toMatchObject({ code: CoreErrorCodes.QUERY_INVALID });
      expect(
        second.value.entityId(0) === positionOnly || second.value.entityId(0) === withSpeed,
      ).toBe(true);
    });
  });

  it("a chunk used after its loop step throws CORE:QUERY_INVALID", async () => {
    await withEngine(async (engine) => {
      const id = engine.createEntity();
      engine.addComponent(id, Position, { x: 3, y: 4 });
      const query = engine.run(() => useQuery([Position]));

      let held: { count?: number; get?: (def: typeof Position) => unknown } | undefined;
      for (const chunk of query) {
        held = chunk;
      }

      expect(held).toMatchObject({ count: expect.any(Number) });
      if (typeof held?.count !== "number" || typeof held.get !== "function") return;

      let caught: unknown;
      try {
        held.get(Position);
      } catch (error: unknown) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(GwenError);
      expect(caught).toMatchObject({ code: CoreErrorCodes.QUERY_INVALID });
    });
  });

  it("use after engine.stop throws CORE:QUERY_INVALID", async () => {
    await withEngine(async (engine) => {
      const id = engine.createEntity();
      engine.addComponent(id, Position, { x: 3, y: 4 });

      let query: Iterable<unknown> | undefined;
      await engine.use(
        defineSystem("query-chunk-stop", () => {
          query = useQuery([Position]);
        })(),
      );
      await engine.startExternal();
      await engine.stop();

      const live = query;
      if (live === undefined) throw new Error("query was not captured");

      let caught: unknown;
      expect(() => {
        try {
          for (const _chunk of live) {
            void _chunk;
          }
        } catch (error: unknown) {
          caught = error;
          throw error;
        }
      }).toThrow(GwenError);
      expect(caught).toMatchObject({ code: CoreErrorCodes.QUERY_INVALID });
    });
  });

  it("use after system teardown throws CORE:QUERY_INVALID", async () => {
    await withEngine(async (engine) => {
      const id = engine.createEntity();
      engine.addComponent(id, Position, { x: 3, y: 4 });

      let query: Iterable<unknown> | undefined;
      const plugin = defineSystem("query-chunk-teardown", () => {
        query = useQuery([Position]);
      })();
      await engine.use(plugin);
      if (plugin.teardown === undefined) throw new Error("system plugin has no teardown");
      plugin.teardown();

      const live = query;
      if (live === undefined) throw new Error("query was not captured");

      let caught: unknown;
      expect(() => {
        for (const _chunk of live) {
          void _chunk;
        }
      }).toThrow(GwenError);
      try {
        for (const _chunk of live) {
          void _chunk;
        }
      } catch (error: unknown) {
        caught = error;
      }
      expect(caught).toMatchObject({ code: CoreErrorCodes.QUERY_INVALID });
    });
  });

  it("two engines keep separate column writes", async () => {
    const engineA = await createEngine({ maxEntities: 8 });
    const engineB = await createEngine({ maxEntities: 8 });
    try {
      const idA = engineA.createEntity();
      const idB = engineB.createEntity();
      engineA.addComponent(idA, Position, { x: 1, y: 0 });
      engineB.addComponent(idB, Position, { x: 2, y: 0 });

      let columnA: unknown;
      let columnB: unknown;
      for (const chunk of engineA.run(() => useQuery([Position]))) {
        columnA = (chunk.get(Position) as { x?: unknown }).x;
      }
      for (const chunk of engineB.run(() => useQuery([Position]))) {
        columnB = (chunk.get(Position) as { x?: unknown }).x;
      }

      expect(columnA).toBeInstanceOf(Float32Array);
      expect(columnB).toBeInstanceOf(Float32Array);
      if (!(columnA instanceof Float32Array) || !(columnB instanceof Float32Array)) return;

      columnA[0] = 7;
      columnB[0] = 8;
      expect(engineA.getComponent(idA, Position)?.x).toBe(7);
      expect(engineB.getComponent(idB, Position)?.x).toBe(8);
    } finally {
      await engineA.stop();
      await engineB.stop();
    }
  });

  it("a released pool actor is outside the chunk and returns after acquire", async () => {
    await withEngine(async (engine) => {
      const prefab = definePrefab([{ def: PoolPos, defaults: { x: 1 } }]);
      const Actor = defineActor("query-chunk-pool", prefab, () => {});
      await engine.use(Actor._plugin);
      const pool = defineActorPool(Actor, { size: 2 });
      await engine.use(pool.plugin);

      const id = pool.acquire();
      pool.release(id);
      await engine.advance(0.016);

      const released = engine.run(() => useQuery([PoolPos])) as { count?: number };
      expect(released.count).toBe(0);

      expect(pool.acquire()).toBe(id);
      const restored = engine.run(() => useQuery([PoolPos])) as { count?: number };
      expect(restored.count).toBe(1);
    });
  });

  it("two queries on one entity read their own column", async () => {
    await withEngine(async (engine) => {
      const id = engine.createEntity();
      engine.addComponent(id, PoolPos, { x: 1 });
      engine.addComponent(id, Speed, { v: 2 });

      const positions = engine.run(() => useQuery([PoolPos]));
      const speeds = engine.run(() => useQuery([Speed]));

      let x: unknown;
      let v: unknown;
      for (const chunk of positions) {
        x = (chunk.get(PoolPos) as { x?: unknown }).x;
      }
      for (const chunk of speeds) {
        v = (chunk.get(Speed) as { v?: unknown }).v;
      }

      expect(x).toBeInstanceOf(Float32Array);
      expect(v).toBeInstanceOf(Float32Array);
      if (!(x instanceof Float32Array) || !(v instanceof Float32Array)) return;
      expect(x).not.toBe(v);
      expect(x[0]).toBe(1);
      expect(v[0]).toBe(2);

      x[0] = 5;
      v[0] = 6;
      expect(engine.getComponent(id, PoolPos)?.x).toBe(5);
      expect(engine.getComponent(id, Speed)?.v).toBe(6);
    });
  });
});
