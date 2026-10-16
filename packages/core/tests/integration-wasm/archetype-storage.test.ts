import { describe, expect, it } from "vitest";

import { chunkLaneViews, componentStaging } from "../../src/engine/chunk-lanes.js";
import { CoreErrorCodes, GwenWasmError } from "../../src/engine/engine-errors.js";
import { createRealEngine } from "./harness.js";

function floatAt(bytes: Uint8Array): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getFloat32(0, true);
}

describe("chunk columns through the bridge", () => {
  it("reads 1 from the lane after a staged write", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 8 });
    try {
      const { engine, bridge } = handle;
      const typeId = bridge.registerComponent(new Uint8Array([0]));
      const id = bridge.createEntity();
      const staging = componentStaging(engine, () => bridge.componentStagingPtr());
      staging.setFloat32(0, 1, true);
      expect(bridge.writeComponentStaged(id.index, id.generation, typeId)).toBe(true);
      const query = bridge.registerQuery(new Uint32Array([typeId]));
      const chunks = chunkLaneViews(engine, bridge.queryChunks(query), [0]);
      const lane = chunks[0]?.lanes[0];
      expect(lane).toBeInstanceOf(Float32Array);
      expect(lane?.[0]).toBe(1);
      expect(lane?.length).toBe(chunks[0]?.count);
    } finally {
      await handle.dispose();
    }
  });

  it("keeps a vec2 lane over wasm memory and shows a view write in a staged read", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 8 });
    try {
      const { engine, bridge } = handle;
      const typeId = bridge.registerComponent(new Uint8Array([0, 0]));
      const id = bridge.createEntity();
      const staging = componentStaging(engine, () => bridge.componentStagingPtr());
      staging.setFloat32(0, 1, true);
      staging.setFloat32(4, 2, true);
      expect(bridge.writeComponentStaged(id.index, id.generation, typeId)).toBe(true);
      const query = bridge.registerQuery(new Uint32Array([typeId]));
      const chunks = chunkLaneViews(engine, bridge.queryChunks(query), [0, 0]);
      const lane = chunks[0]?.lanes[0];
      expect(lane).toBeInstanceOf(Float32Array);
      expect(lane?.length).toBe(chunks[0]?.count);
      expect(lane?.[0]).toBe(1);
      if (!(lane instanceof Float32Array)) {
        throw new Error("expected Float32Array");
      }
      const memory = bridge.getLinearMemory();
      expect(memory).not.toBeNull();
      expect(lane.buffer).toBe(memory?.buffer);
      lane[0] = 9;
      expect(bridge.readComponentStaged(id.index, id.generation, typeId)).toBe(true);
      expect(staging.getFloat32(0, true)).toBe(9);
      expect(staging.getFloat32(4, true)).toBe(2);
    } finally {
      await handle.dispose();
    }
  });

  it("matches a chunk walk to per-entity reads", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 8 });
    try {
      const { engine, bridge } = handle;
      const typeId = bridge.registerComponent(new Uint8Array([0]));
      const first = bridge.createEntity();
      const second = bridge.createEntity();
      const staging = componentStaging(engine, () => bridge.componentStagingPtr());
      staging.setFloat32(0, 3, true);
      expect(bridge.writeComponentStaged(first.index, first.generation, typeId)).toBe(true);
      staging.setFloat32(0, 4, true);
      expect(bridge.writeComponentStaged(second.index, second.generation, typeId)).toBe(true);
      const query = bridge.registerQuery(new Uint32Array([typeId]));
      const ptr = bridge.queryChunks(query);
      const chunks = chunkLaneViews(engine, ptr, [0]);
      const lane = chunks[0]?.lanes[0];
      const memory = bridge.getLinearMemory();
      if (!(lane instanceof Float32Array) || memory === null) {
        throw new Error("expected a lane view");
      }
      const table = new Uint32Array(memory.buffer, ptr);
      const count = chunks[0]?.count ?? 0;
      const indexes = new Uint32Array(memory.buffer, table[6] ?? 0, count);
      const generations = new Uint32Array(memory.buffer, table[7] ?? 0, count);
      const fromChunk: number[] = [];
      const fromEntity: number[] = [];
      for (let row = 0; row < count; row += 1) {
        fromChunk.push(lane[row] ?? 0);
        fromEntity.push(
          floatAt(bridge.getComponentRaw(indexes[row] ?? 0, generations[row] ?? 0, typeId)),
        );
      }
      expect(fromChunk).toEqual(fromEntity);
      expect(fromChunk).toEqual([3, 4]);
    } finally {
      await handle.dispose();
    }
  });

  it("bumps storage generation only on a structural change", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 8 });
    try {
      const { bridge } = handle;
      const typeId = bridge.registerComponent(new Uint8Array([0]));
      const id = bridge.createEntity();
      const before = bridge.storageGeneration();
      expect(
        bridge.addComponent(id.index, id.generation, typeId, new Uint8Array([1, 0, 0, 0])),
      ).toBe(true);
      const afterAdd = bridge.storageGeneration();
      expect(afterAdd).toBe(before + 1);
      expect(
        bridge.addComponent(id.index, id.generation, typeId, new Uint8Array([2, 0, 0, 0])),
      ).toBe(true);
      expect(bridge.storageGeneration()).toBe(afterAdd);
      expect(bridge.removeComponent(id.index, id.generation, typeId)).toBe(true);
      expect(bridge.storageGeneration()).toBe(afterAdd + 1);
    } finally {
      await handle.dispose();
    }
  });

  it("rebuilds lane arrays after memory.grow with the same values", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 8 });
    try {
      const { engine, bridge } = handle;
      const typeId = bridge.registerComponent(new Uint8Array([0]));
      const id = bridge.createEntity();
      const staging = componentStaging(engine, () => bridge.componentStagingPtr());
      staging.setFloat32(0, 1, true);
      expect(bridge.writeComponentStaged(id.index, id.generation, typeId)).toBe(true);
      const query = bridge.registerQuery(new Uint32Array([typeId]));
      const ptr = bridge.queryChunks(query);
      const before = chunkLaneViews(engine, ptr, [0])[0]?.lanes[0];
      if (!(before instanceof Float32Array)) throw new Error("expected a lane view");
      const value = before[0];
      const memory = bridge.getLinearMemory();
      if (memory === null) throw new Error("light wasm did not export memory");
      memory.grow(1);
      const after = chunkLaneViews(engine, ptr, [0])[0]?.lanes[0];
      expect(after).toBeInstanceOf(Float32Array);
      expect(after?.[0]).toBe(value);
      expect(after?.buffer).toBe(memory.buffer);
      expect(before.buffer.byteLength).toBe(0);
    } finally {
      await handle.dispose();
    }
  });

  it("refuses the 129th type and still reads the first", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 4 });
    try {
      const { engine, bridge } = handle;
      const lanes = new Uint8Array([0]);
      let firstId = 0;
      for (let index = 0; index < 128; index += 1) {
        const typeId = bridge.registerComponent(lanes);
        if (index === 0) firstId = typeId;
      }
      let caught: unknown;
      try {
        bridge.registerComponent(lanes);
      } catch (error: unknown) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(GwenWasmError);
      if (!(caught instanceof GwenWasmError)) throw new Error("expected GwenWasmError");
      expect(caught.code).toBe(CoreErrorCodes.COMPONENT_TYPE_LIMIT_REACHED);
      const id = bridge.createEntity();
      const staging = componentStaging(engine, () => bridge.componentStagingPtr());
      staging.setFloat32(0, 1, true);
      expect(bridge.writeComponentStaged(id.index, id.generation, firstId)).toBe(true);
      expect(floatAt(bridge.getComponentRaw(id.index, id.generation, firstId))).toBe(1);
      expect(bridge.countEntities()).toBe(1);
    } finally {
      await handle.dispose();
    }
  });

  it("drops the awake count after a dormancy toggle and the lane length matches", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 8 });
    try {
      const { engine, bridge } = handle;
      const typeId = bridge.registerComponent(new Uint8Array([0]));
      const first = bridge.createEntity();
      const second = bridge.createEntity();
      const staging = componentStaging(engine, () => bridge.componentStagingPtr());
      staging.setFloat32(0, 3, true);
      expect(bridge.writeComponentStaged(first.index, first.generation, typeId)).toBe(true);
      staging.setFloat32(0, 4, true);
      expect(bridge.writeComponentStaged(second.index, second.generation, typeId)).toBe(true);
      const query = bridge.registerQuery(new Uint32Array([typeId]));
      const before = chunkLaneViews(engine, bridge.queryChunks(query), [0]);
      expect(before[0]?.count).toBe(2);
      expect(bridge.setEntityDormant(second.index, second.generation, true)).toBe(true);
      const ptr = bridge.queryChunks(query);
      const after = chunkLaneViews(engine, ptr, [0]);
      const memory = bridge.getLinearMemory();
      if (memory === null) throw new Error("light wasm did not export memory");
      const table = new Uint32Array(memory.buffer, ptr, 8);
      expect(table[5]).toBe(1);
      expect(after[0]?.count).toBe(table[5]);
      expect(after[0]?.lanes[0]?.length).toBe(table[5]);
    } finally {
      await handle.dispose();
    }
  });
});
