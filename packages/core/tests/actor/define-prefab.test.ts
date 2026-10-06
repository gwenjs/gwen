import { stubComponent, stubHealth } from "../helpers/stub-component";
import { describe, it, expect } from "vitest";
import { definePrefab } from "../../src/actor/runtime/define-prefab";

// Minimal component-like objects for testing (no real ECS needed)
const Position = stubComponent("Position");
const Health = stubHealth("Health");

describe("definePrefab", () => {
  it("returns a PrefabDefinition with the given components", () => {
    const prefab = definePrefab([
      { def: Position, defaults: { x: 0, y: 0 } },
      { def: Health, defaults: { hp: 100 } },
    ]);

    expect(prefab.components).toHaveLength(2);
    const first = prefab.components[0];
    const second = prefab.components[1];
    if (first === undefined || second === undefined) throw new Error("missing prefab slot");
    expect(first.def).toBe(Position);
    expect(first.defaults).toEqual({ x: 0, y: 0 });
    expect(second.def).toBe(Health);
  });

  it('sets __prefabName__ to "anonymous" by default', () => {
    const prefab = definePrefab([]);
    expect(prefab.__prefabName__).toBe("anonymous");
  });

  it("accepts an empty components array", () => {
    const prefab = definePrefab([]);
    expect(prefab.components).toHaveLength(0);
  });

  it("does not mutate the input array", () => {
    const input = [{ def: Position, defaults: {} }];
    definePrefab(input);
    expect(input).toHaveLength(1);
  });

  it("returns a frozen object (immutable)", () => {
    const prefab = definePrefab([]);
    expect(Object.isFrozen(prefab)).toBe(true);
  });
});
