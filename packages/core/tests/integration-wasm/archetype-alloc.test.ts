import { describe, expect, it } from "vitest";

import { chunkLaneCacheSize, chunkLaneViews } from "../../src/engine/chunk-lanes.js";
import { measureAllocations } from "./allocation.js";
import { createRealEngine } from "./harness.js";

const LANE: readonly [0] = [0];

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
      // The helper's young-space floor is a few KB, so 1000 ops cannot show < 1 byte.
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

  it("keeps at most one lane cache entry per live chunk", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 8 });
    try {
      const { engine, bridge } = handle;
      const typeId = bridge.registerComponent(new Uint8Array([0]));
      const id = bridge.createEntity();
      const data = new Uint8Array([1, 0, 0, 0]);
      expect(bridge.addComponent(id.index, id.generation, typeId, data)).toBe(true);
      const query = bridge.registerQuery(new Uint32Array([typeId]));
      for (let index = 0; index < 30; index += 1) {
        expect(bridge.setEntityDormant(id.index, id.generation, true)).toBe(true);
        chunkLaneViews(engine, bridge.queryChunks(query), LANE);
        expect(bridge.setEntityDormant(id.index, id.generation, false)).toBe(true);
        chunkLaneViews(engine, bridge.queryChunks(query), LANE);
        expect(bridge.removeComponent(id.index, id.generation, typeId)).toBe(true);
        chunkLaneViews(engine, bridge.queryChunks(query), LANE);
        expect(bridge.addComponent(id.index, id.generation, typeId, data)).toBe(true);
        chunkLaneViews(engine, bridge.queryChunks(query), LANE);
      }
      const ptr = bridge.queryChunks(query);
      const views = chunkLaneViews(engine, ptr, LANE);
      const memory = bridge.getLinearMemory();
      if (memory === null) throw new Error("light wasm did not export memory");
      const live = new Uint32Array(memory.buffer, ptr, 4)[0] ?? 0;
      expect(chunkLaneCacheSize(engine)).toBeLessThanOrEqual(live);
      expect(views.length).toBe(live);
      expect(views[0]?.lanes[0]?.buffer).toBe(memory.buffer);
      expect(bridge.removeComponent(id.index, id.generation, typeId)).toBe(true);
      const emptyPtr = bridge.queryChunks(query);
      chunkLaneViews(engine, emptyPtr, LANE);
      const empty = new Uint32Array(memory.buffer, emptyPtr, 4)[0] ?? 0;
      expect(empty).toBe(0);
      expect(chunkLaneCacheSize(engine)).toBe(0);
    } finally {
      await handle.dispose();
    }
  });

  it("reads lane views without allocating after warm-up", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 8 });
    try {
      const { engine, bridge } = handle;
      const typeId = bridge.registerComponent(new Uint8Array([0]));
      const id = bridge.createEntity();
      const data = new Uint8Array([1, 0, 0, 0]);
      expect(bridge.addComponent(id.index, id.generation, typeId, data)).toBe(true);
      const query = bridge.registerQuery(new Uint32Array([typeId]));
      const ptr = bridge.queryChunks(query);
      const ops = 8_000;
      const report = await measureAllocations(
        () => {
          for (let index = 0; index < ops; index += 1) chunkLaneViews(engine, ptr, LANE);
        },
        { warmup: 4, ops },
      );
      expect(report.bytesPerOp).toBeLessThan(1);
      expect(report.gcCount).toBe(0);
    } finally {
      await handle.dispose();
    }
  });

  it("toggles a second component while the first stays without allocating after warm-up", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 8 });
    try {
      const { bridge } = handle;
      const kept = bridge.registerComponent(new Uint8Array([0]));
      const toggled = bridge.registerComponent(new Uint8Array([0]));
      const id = bridge.createEntity();
      const keptData = new Uint8Array([1, 0, 0, 0]);
      const toggledData = new Uint8Array([2, 0, 0, 0]);
      expect(bridge.addComponent(id.index, id.generation, kept, keptData)).toBe(true);
      const toggle = (): void => {
        bridge.addComponent(id.index, id.generation, toggled, toggledData);
        bridge.removeComponent(id.index, id.generation, toggled);
      };
      for (let index = 0; index < 1000; index += 1) toggle();
      const memory = bridge.getLinearMemory();
      if (memory === null) throw new Error("light wasm did not export memory");
      const bytes = memory.buffer.byteLength;
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
      const keptRaw = bridge.getComponentRaw(id.index, id.generation, kept);
      expect(keptRaw[0]).toBe(1);
    } finally {
      await handle.dispose();
    }
  });

  it("toggles dormancy without allocating after warm-up", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 8 });
    try {
      const { bridge } = handle;
      const typeId = bridge.registerComponent(new Uint8Array([0]));
      const id = bridge.createEntity();
      const data = new Uint8Array([1, 0, 0, 0]);
      expect(bridge.addComponent(id.index, id.generation, typeId, data)).toBe(true);
      const toggle = (): void => {
        bridge.setEntityDormant(id.index, id.generation, true);
        bridge.setEntityDormant(id.index, id.generation, false);
      };
      for (let index = 0; index < 1000; index += 1) toggle();
      const memory = bridge.getLinearMemory();
      if (memory === null) throw new Error("light wasm did not export memory");
      const bytes = memory.buffer.byteLength;
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

  it("ignores an empty call", async () => {
    const ops = 8_000;
    const report = await measureAllocations(
      () => {
        for (let index = 0; index < ops; index += 1) void index;
      },
      { warmup: 4, ops },
    );
    expect(report.bytesPerOp).toBeLessThan(1);
    expect(report.gcCount).toBe(0);
  });

  it("counts an object kept alive per op", async () => {
    const ops = 8_000;
    const report = await measureAllocations(
      () => {
        const sink: Uint8Array[] = [];
        for (let index = 0; index < ops; index += 1) {
          const extra = new Uint8Array(1);
          extra[0] = 1;
          sink.push(extra);
        }
        if (sink.length !== ops || sink[0]?.[0] !== 1) throw new Error("sink dropped the object");
      },
      { warmup: 4, ops },
    );
    expect(report.bytesPerOp).toBeGreaterThanOrEqual(1);
  });

  it("counts a large array kept alive per op", async () => {
    const ops = 8_000;
    const report = await measureAllocations(
      () => {
        const sink: number[][] = [];
        for (let index = 0; index < ops; index += 1) {
          const block = new Array<number>(300_000);
          block[0] = 1;
          sink[0] = block;
        }
        if (sink[0]?.[0] !== 1) throw new Error("sink dropped the array");
      },
      { warmup: 1, ops },
    );
    expect(report.bytesPerOp).toBeGreaterThanOrEqual(1);
  });
});
