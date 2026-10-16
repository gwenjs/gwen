import { describe, expect, it } from "vitest";

import { measureAllocations } from "./allocation.js";
import { createRealEngine } from "./harness.js";

describe("chunk column allocation", () => {
  it("toggles one row without allocating after warm-up", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 8 });
    try {
      const { bridge } = handle;
      const typeId = bridge.registerComponent(new Uint8Array([0]));
      const id = bridge.createEntity();
      const data = new Uint8Array([1, 0, 0, 0]);
      const toggle = (): void => {
        bridge.addComponent(id.index, id.generation, typeId, data);
        bridge.removeComponent(id.index, id.generation, typeId);
      };
      for (let index = 0; index < 1000; index += 1) toggle();
      const memory = bridge.getLinearMemory();
      if (memory === null) throw new Error("light wasm did not export memory");
      const bytes = memory.buffer.byteLength;
      // The helper's heap floor is a few KB, so 1000 ops cannot show < 1 byte.
      const ops = 8_000;
      const report = await measureAllocations(
        () => {
          for (let index = 0; index < ops; index += 1) toggle();
        },
        { warmup: 4, ops },
      );
      expect(report.bytesPerOp).toBeLessThan(1);
      expect(report.gcCount).toBe(0);
      expect(memory.buffer.byteLength).toBe(bytes);
    } finally {
      await handle.dispose();
    }
  });
});
