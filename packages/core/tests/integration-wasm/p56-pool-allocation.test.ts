import { describe, expect, it } from "vitest";

import { defineActor, defineActorPool, definePrefab } from "../../src/actor/index.js";
import { defineComponent, Types } from "../../src/index.js";
import type { EntityId } from "../../src/types/entity.js";
import { defineSystem, onUpdate, useQuery } from "../../src/system/runtime/define-system.js";
import { measureAllocations } from "./allocation.js";
import { createRealEngine } from "./harness.js";

const Static = defineComponent({
  name: "P56Static",
  schema: { v: Types.u32 },
});

const Bullet = defineComponent({
  name: "P56Bullet",
  schema: { n: Types.u32 },
});

describe("pool acquire/release allocation (#56)", () => {
  it("acquires and releases 10000 pooled actors with no heap growth", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 32_768 });
    let stateAfterDispose = "";
    try {
      const { engine, bridge } = handle;
      const memory = bridge.getLinearMemory();
      if (!memory) throw new Error("linear memory missing");

      for (let i = 0; i < 1_000; i += 1) {
        const id = engine.createEntity();
        engine.addComponent(id, Static, { v: 1 });
      }
      let seen = 0;
      await engine.use(
        defineSystem("p56-static", () => {
          const query = useQuery([Static]);
          onUpdate(() => {
            seen = 0;
            for (const _entity of query) seen += 1;
          });
        })(),
      );

      const prefab = definePrefab([{ def: Bullet, defaults: { n: 1 } }]);
      const Actor = defineActor("p56-bullet", prefab, () => {});
      await engine.use(Actor._plugin);
      const pool = defineActorPool(Actor, { size: 20_000 });
      await engine.use(pool.plugin);

      const cycle = 10_000;
      const ops = cycle * 2;
      const held: EntityId[] = new Array(cycle);
      const fill = (): void => {
        for (let i = 0; i < cycle; i += 1) held[i] = pool.acquire();
      };
      const drop = (): void => {
        for (let i = 0; i < cycle; i += 1) pool.release(held[i]!);
      };

      for (let warm = 0; warm < 2; warm += 1) {
        fill();
        drop();
        await handle.advance(1, 1 / 60);
      }

      const sampleId = held[0]!;
      const hadBullet = engine.hasComponent(sampleId, Bullet);
      const bytesBefore = memory.buffer.byteLength;

      // The spec asks for two warm-up cycles. After two, the third cycle has no
      // new-space growth over an empty frame, but V8 can still install
      // optimized code (code, trusted and old space) inside the measured run.
      // That lands at 1-2 bytes/op when the suite runs in parallel, so the
      // helper repeats the measured frame six more times before the counted run.
      const baseline = await measureAllocations(() => handle.advance(1, 1 / 60), {
        warmup: 1,
        ops,
      });
      const measured = await measureAllocations(
        async () => {
          fill();
          drop();
          await handle.advance(1, 1 / 60);
        },
        { warmup: 6, ops },
      );

      const memoryAfter = bridge.getLinearMemory();
      if (!memoryAfter) throw new Error("linear memory missing");
      const allocatedBytes = measured.allocatedBytes - baseline.allocatedBytes;
      const retainedBytes = measured.retainedBytes - baseline.retainedBytes;
      expect(seen).toBe(1_000);
      expect(engine.hasComponent(sampleId, Bullet)).toBe(hadBullet);
      expect(measured.gcCount).toBe(0);
      expect(allocatedBytes / ops).toBeLessThan(1);
      expect(retainedBytes / ops).toBeLessThan(1);
      expect(memoryAfter.buffer.byteLength).toBe(bytesBefore);
    } finally {
      await handle.dispose();
      stateAfterDispose = handle.engine.state;
    }
    expect(stateAfterDispose).toBe("stopped");
  });
});
