import { describe, expect, it } from "vitest";

import { createRealEngine } from "./harness.js";

describe("real WASM memory growth", () => {
  it("keeps forEachQueryResultRaw correct after the buffer grows", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 32 });
    try {
      const { bridge } = handle;
      const memory = bridge.getLinearMemory();
      if (memory === null) {
        throw new Error("wasm memory unavailable");
      }

      // The first call only records the current buffer.
      expect(bridge.checkMemoryGrow()).toBe(false);
      const before = memory.buffer.byteLength;

      let after = before;
      let bytes = 1 << 20;
      while (after <= before && bytes <= 64 * 1024 * 1024) {
        const ptr = bridge.allocSharedBuffer(bytes);
        expect(ptr).not.toBe(0);
        const grown = bridge.getLinearMemory();
        if (grown === null) {
          throw new Error("wasm memory unavailable after alloc");
        }
        after = grown.buffer.byteLength;
        bytes *= 2;
      }

      expect(after).toBeGreaterThan(before);
      expect(bridge.checkMemoryGrow()).toBe(true);

      const typeId = bridge.registerComponentType();
      const expected: number[] = [];
      for (let n = 0; n < 5; n += 1) {
        const id = bridge.createEntity();
        bridge.addComponent(id.index, id.generation, typeId, new Uint8Array(4));
        expected.push(id.index);
      }

      const found: number[] = [];
      bridge.forEachQueryResultRaw([typeId], (index) => {
        found.push(index);
      });
      expect(found).toEqual(expected);
    } finally {
      await handle.dispose();
    }
  });
});
