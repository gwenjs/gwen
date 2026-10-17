import { describe, expect, it } from "vitest";

import type { EntityId } from "../../src/engine/engine-api";
import { setEntityDormant } from "../../src/engine/engine-internals";
import { defineComponent, Types } from "../../src/schema.js";
import { useQuery } from "../../src/system/runtime/define-system.js";
import { measureAllocations } from "./allocation.js";
import { createRealEngine } from "./harness.js";

const DeferPos = defineComponent({
  name: "P65DeferPos",
  schema: { x: Types.f32 },
  defaults: { x: 0 },
});

const ROWS = 48;

describe("deferred structural ops", () => {
  it("a dormancy toggle stays queued and then allocates under 1 byte per op", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 64 });
    try {
      const { engine } = handle;
      const ids: EntityId[] = [];
      for (let index = 0; index < ROWS; index += 1) {
        const id = engine.createEntity();
        engine.addComponent(id, DeferPos, { x: index });
        ids.push(id);
      }
      const query = engine.run(() => useQuery([DeferPos]));

      let nested = 0;
      for (const chunk of query) {
        for (let row = 0; row < chunk.count; row += 1) {
          setEntityDormant(engine, chunk.entityId(row), true);
        }
        for (const inner of query) nested += inner.count;
      }
      expect(nested).toBe(ROWS);

      let awake = 0;
      for (const chunk of query) awake += chunk.count;
      expect(awake).toBe(0);
      for (const id of ids) setEntityDormant(engine, id, false);

      const passes = 256;
      const report = await measureAllocations(
        () => {
          for (let pass = 0; pass < passes; pass += 1) {
            for (const chunk of query) {
              if (chunk.count === 0) continue;
              for (let row = 0; row < ids.length; row += 1) {
                const id = ids[row];
                if (id === undefined) continue;
                setEntityDormant(engine, id, true);
              }
            }
            for (let row = 0; row < ids.length; row += 1) {
              const id = ids[row];
              if (id === undefined) continue;
              setEntityDormant(engine, id, false);
            }
          }
        },
        { warmup: 8, ops: ROWS * 2 * passes },
      );

      expect(report.gcCount).toBe(0);
      expect(report.bytesPerOp).toBeLessThan(1);
    } finally {
      await handle.dispose();
    }
  }, 60_000);
});
