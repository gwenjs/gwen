import { describe, expect, it } from "vitest";

import { createRealEngine } from "./harness.js";

describe("P0 query cap", () => {
  it("D5 query cap: queryEntitiesRaw returns every match, not 10_000", async () => {
    const handle = await createRealEngine({
      variant: "light",
      maxEntities: 20_000,
    });
    try {
      const { bridge } = handle;
      const typeId = bridge.registerComponentType();
      const spawned = 15_000;
      for (let i = 0; i < spawned; i += 1) {
        const id = bridge.createEntity();
        bridge.addComponent(id.index, id.generation, typeId, new Uint8Array(4));
      }

      expect(bridge.queryEntitiesRaw([typeId])).toBe(spawned);
    } finally {
      await handle.dispose();
    }
  }, 60_000);
});
