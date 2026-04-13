import { describe, it, expect } from "vitest";
import { definePrefab, defineActor } from "../../src/actor/index";
import { createEngine } from "../../src/engine/gwen-engine";

const Hp = { __name__: "Hp" };
const TestPrefab = definePrefab([{ def: Hp, defaults: { value: 100 } }]);

describe("ActorInstance pool fields", () => {
  it("instance has _isDormant=false, _release=[], _reset=[] after spawn", async () => {
    const engine = await createEngine();
    const Actor = defineActor(TestPrefab, () => {});
    await engine.use(Actor._plugin);

    const id = Actor._plugin.spawn!();
    const inst = Actor._instances.get(id)!;

    expect(inst._isDormant).toBe(false);
    expect(inst._release).toEqual([]);
    expect(inst._reset).toEqual([]);
  });
});
