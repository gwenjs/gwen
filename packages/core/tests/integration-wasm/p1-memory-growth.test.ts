import { describe, expect, it } from "vitest";

import { CoreErrorCodes, SharedMemoryManager } from "../../src/index.js";
import { createRealEngine } from "./harness.js";

describe("memory growth", () => {
  it("keeps a query view and a shared region live after grow", async () => {
    const { engine, bridge } = await createRealEngine({ variant: "light", maxEntities: 32 });
    try {
      const typeId = bridge.engine().register_component_type();
      const id = bridge.createEntity();
      bridge.addComponent(id.index, id.generation, typeId, new Uint8Array([7, 0, 0, 0]));
      expect(bridge.queryEntitiesRaw([typeId])).toBe(1);

      const wasm = bridge.engine();
      const query = engine.memory.view({
        name: "test:query",
        type: "u32",
        ptr: () => wasm.get_query_result_ptr(),
        length: () => 1,
      });
      const before = query.array;
      const slot = before[0];

      const shared = SharedMemoryManager.create(bridge, 8);
      const region = shared.allocateRegion("demo", 16);
      const regionView = engine.memory.view({
        name: "demo:region",
        type: "u8",
        ptr: () => region.ptr,
        length: () => 16,
      });
      regionView.array[0] = 42;

      const memory = bridge.getLinearMemory();
      if (memory === null) throw new Error("light wasm did not export memory");
      memory.grow(1);

      expect(before.byteLength).toBe(0);
      expect(query.array[0]).toBe(slot);
      expect(regionView.array[0]).toBe(42);
      shared.dispose(bridge);
    } finally {
      await engine.stop();
    }
  });

  it("fires engine:memory-grow before engine:after-update in the same frame", async () => {
    const { engine, bridge, advance } = await createRealEngine({
      variant: "light",
      maxEntities: 16,
    });
    try {
      const order: string[] = [];
      engine.hooks.hook("engine:update", () => {
        order.push("update");
        const memory = bridge.getLinearMemory();
        if (memory === null) throw new Error("light wasm did not export memory");
        memory.grow(1);
      });
      engine.hooks.hook("engine:memory-grow", (info) => {
        order.push(`grow:${info.epoch}`);
      });
      engine.hooks.hook("engine:after-update", () => {
        order.push("after");
      });

      await advance(1, 1 / 60);

      const growAt = order.indexOf("grow:1");
      expect(growAt).toBeGreaterThan(order.indexOf("update"));
      expect(growAt).toBeLessThan(order.indexOf("after"));
      expect(engine.memory.epoch).toBe(1);
    } finally {
      await engine.stop();
    }
  });

  it("bumps the epoch when Rust grows memory and warns in dev", async () => {
    const seen: Array<{ code: string; context?: { view?: string } }> = [];
    const { engine, bridge, advance } = await createRealEngine({
      variant: "light",
      maxEntities: 256,
    });
    try {
      engine.errors.on((event) => {
        seen.push(event);
      });
      const memory = bridge.getLinearMemory();
      if (memory === null) throw new Error("light wasm did not export memory");
      const started = memory.buffer.byteLength;
      const typeId = bridge.engine().register_component_type();
      const view = engine.memory.view({
        name: "test:spawn",
        type: "u8",
        ptr: () => 0,
        length: () => 4,
      });
      view.array[0] = 1;

      let grew = false;
      for (let i = 0; i < 256 && !grew; i += 1) {
        const id = bridge.createEntity();
        bridge.addComponent(id.index, id.generation, typeId, new Uint8Array(4096));
        grew = memory.buffer.byteLength !== started;
      }
      expect(grew).toBe(true);

      await advance(1, 1 / 60);

      expect(engine.memory.epoch).toBe(1);
      expect(view.array[0]).toBe(1);
      const warning = seen.find((event) => event.code === CoreErrorCodes.MEMORY_VIEW_DETACHED);
      expect(warning?.context?.view).toBe("test:spawn");
    } finally {
      await engine.stop();
    }
  });
});
