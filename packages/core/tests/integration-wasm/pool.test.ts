import { describe, expect, it } from "vitest";

import { defineActor, definePrefab } from "../../src/actor/index.js";
import { defineActorPool } from "../../src/actor/runtime/pool/define-actor-pool.js";
import { PoolExhaustedError } from "../../src/actor/runtime/pool/errors.js";
import { defineComponent, Types } from "../../src/index.js";
import { createRealEngine } from "./harness.js";

const Marker = defineComponent({
  name: "PoolMarker",
  schema: { v: Types.u32 },
});

function activeIds(engine: {
  createLiveQuery(components: readonly [typeof Marker]): Iterable<{ id: bigint }>;
}): bigint[] {
  const ids: bigint[] = [];
  for (const entity of engine.createLiveQuery([Marker])) ids.push(entity.id);
  return ids;
}

describe("real WASM actor pool", () => {
  it("acquire is alive, a flushed release leaves queries, and overflow throws", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 32 });
    try {
      const { engine } = handle;
      const prefab = definePrefab([{ def: Marker, defaults: { v: 1 } }]);
      const Actor = defineActor("pool-probe", prefab, () => {});
      await engine.use(Actor._plugin);
      const pool = defineActorPool(Actor, { size: 2 });
      await engine.use(pool.plugin);

      const id = pool.acquire();
      expect(engine.isAlive(id)).toBe(true);
      expect(engine.hasComponent(id, Marker)).toBe(true);
      expect(activeIds(engine)).toContain(id);

      pool.release(id);
      await handle.advance(1, 1 / 60);

      expect(engine.isAlive(id)).toBe(true);
      expect(engine.hasComponent(id, Marker)).toBe(true);
      expect(activeIds(engine)).not.toContain(id);

      pool.acquire();
      pool.acquire();
      expect(() => pool.acquire()).toThrow(PoolExhaustedError);
    } finally {
      await handle.dispose();
      expect(handle.engine.state).toBe("stopped");
    }
  });
});
