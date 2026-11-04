import { stubComponent } from "../helpers/stub-component";
import { describe, it, expect } from "vitest";
import { defineActor } from "../../src/actor/runtime/define-actor";
import { useActor } from "../../src/actor/runtime/use-actor";
import { definePrefab } from "../../src/actor/runtime/define-prefab";
import { createEngine } from "../../src/node";

const Position = stubComponent("PositionApiShapes");
const SimplePrefab = definePrefab([{ def: Position, defaults: { x: 0, y: 0 } }]);

describe("ActorHandle Proxy — public API shapes", () => {
  it("reads a property of a function public API in place", async () => {
    const engine = await createEngine();
    try {
      const Actor = defineActor("FunctionApi", SimplePrefab, () => {
        const api = () => "called";
        return Object.assign(api, { level: 3 });
      });
      await engine.use(Actor._plugin);
      Actor._plugin.spawn?.();
      let level: unknown;
      engine.run(() => {
        const handle = useActor(Actor);
        level = Reflect.get(handle, "level");
      });
      expect(level).toBe(3);
    } finally {
      await engine.stop();
    }
  });

  it("reads a property of a primitive public API", async () => {
    const engine = await createEngine();
    try {
      const Actor = defineActor("StringApi", SimplePrefab, () => "hello");
      await engine.use(Actor._plugin);
      Actor._plugin.spawn?.();
      let length: unknown;
      engine.run(() => {
        const handle = useActor(Actor);
        length = Reflect.get(handle, "length");
      });
      expect(length).toBe(5);
    } finally {
      await engine.stop();
    }
  });
});
