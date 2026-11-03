import { describe, expect, it } from "vitest";

import { defineActor, definePrefab } from "../../src/actor/index.js";
import { defineComponent, Types } from "../../src/index.js";
import { defineSystem, onUpdate, useComponent, useQuery } from "../../src/system/index.js";
import { createRealEngine } from "./harness.js";

const Pos = defineComponent({
  name: "BothFormsPos",
  schema: { x: Types.f32 },
  defaults: { x: 0 },
});

describe("real WASM useComponent in both forms", () => {
  it("an actor write through useComponent(def) is read by a system through useComponent(id, def)", async () => {
    expect(typeof useComponent).toBe("function");
    const handle = await createRealEngine({ variant: "light", maxEntities: 32 });
    try {
      const { engine } = handle;
      const prefab = definePrefab([{ def: Pos, defaults: { x: 0 } }]);
      const Writer = defineActor("both-forms-writer", prefab, () => {
        const own = useComponent(Pos);
        onUpdate(() => {
          own.x = 5;
        });
      });
      const Idle = defineActor("both-forms-idle", prefab, () => {});
      await engine.use(Writer._plugin);
      await engine.use(Idle._plugin);
      const writerId = Writer._plugin.spawn();
      const idleId = Idle._plugin.spawn();

      const seen = new Map<bigint, number>();
      const Reader = defineSystem("both-forms-reader", () => {
        const query = useQuery([Pos]);
        onUpdate(() => {
          for (const chunk of query) {
            for (let row = 0; row < chunk.count; row++) {
              const id = chunk.entityId(row);
              seen.set(id, useComponent(id, Pos).x);
            }
          }
        });
      });
      await engine.use(Reader());
      await handle.advance(2, 1 / 60);

      expect(seen.get(writerId)).toBe(5);
      expect(seen.get(idleId)).toBe(0);
    } finally {
      await handle.dispose();
    }
  });
});
