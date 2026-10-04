import { describe, expect, it } from "vitest";

import { createRealEngine } from "./harness.js";

describe("real WASM engine", () => {
  it("queries three entities on the light variant", async () => {
    const { engine, bridge } = await createRealEngine({
      variant: "light",
      maxEntities: 64,
    });

    const typeId = bridge.registerComponentType();
    for (let i = 0; i < 3; i += 1) {
      const id = bridge.createEntity();
      bridge.addComponent(id.index, id.generation, typeId, new Uint8Array(4));
    }

    expect(bridge.queryEntities([typeId])).toHaveLength(3);
    expect(bridge.isActive()).toBe(true);
    expect(engine.variant).toBe("light");
  });
});
