import { describe, expect, it } from "vitest";

import { unpackEntityId } from "../../src/index.js";
import type { WasmBridgeImpl } from "../../src/engine/wasm-bridge.js";
import { createRealEngine, type RealEngineHandle } from "./harness.js";

function sortedIndices(values: Iterable<number>): number[] {
  return Array.from(values).sort((left, right) => left - right);
}

function rawIndices(bridge: WasmBridgeImpl, typeId: number): number[] {
  const count = bridge.queryEntitiesRaw([typeId]);
  const memory = bridge.getLinearMemory();
  if (memory === null) {
    throw new Error("wasm memory unavailable");
  }
  const ptr = bridge.engine().get_query_result_ptr();
  const view = new Uint32Array(memory.buffer, ptr, count);
  return Array.from(view);
}

function forEachIndices(bridge: WasmBridgeImpl, typeId: number): number[] {
  const found: number[] = [];
  bridge.forEachQueryResultRaw([typeId], (index) => {
    found.push(index);
  });
  return found;
}

describe("real WASM queries", () => {
  it("queryEntities, queryEntitiesRaw and forEachQueryResultRaw match the model", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 64 });
    try {
      const { bridge } = handle;
      const typeA = bridge.registerComponentType();
      const typeB = bridge.registerComponentType();
      const withA: number[] = [];
      const withBoth: number[] = [];

      for (let n = 0; n < 12; n += 1) {
        const id = bridge.createEntity();
        if (n % 2 === 0) {
          bridge.addComponent(id.index, id.generation, typeA, new Uint8Array(4));
          withA.push(id.index);
        }
        if (n % 3 === 0) {
          bridge.addComponent(id.index, id.generation, typeB, new Uint8Array(4));
          if (n % 2 === 0) withBoth.push(id.index);
        }
      }

      const fromPacked = sortedIndices(
        bridge.queryEntities([typeA]).map((id) => unpackEntityId(id).index),
      );
      expect(fromPacked).toEqual(sortedIndices(withA));
      expect(sortedIndices(rawIndices(bridge, typeA))).toEqual(sortedIndices(withA));
      expect(sortedIndices(forEachIndices(bridge, typeA))).toEqual(sortedIndices(withA));

      const bothPacked = sortedIndices(
        bridge.queryEntities([typeA, typeB]).map((id) => unpackEntityId(id).index),
      );
      expect(bothPacked).toEqual(sortedIndices(withBoth));
    } finally {
      await handle.dispose();
    }
  });

  it("does not truncate matches above 10_000", async () => {
    const spawned = 10_001;
    const handle = await createRealEngine({ variant: "light", maxEntities: spawned });
    try {
      const { bridge } = handle;
      const typeId = bridge.registerComponentType();
      const expected: number[] = [];
      for (let n = 0; n < spawned; n += 1) {
        const id = bridge.createEntity();
        bridge.addComponent(id.index, id.generation, typeId, new Uint8Array(4));
        expected.push(id.index);
      }

      expect(bridge.queryEntities([typeId])).toHaveLength(spawned);
      expect(bridge.queryEntitiesRaw([typeId])).toBe(spawned);
      expect(forEachIndices(bridge, typeId)).toEqual(expected);
    } finally {
      await handle.dispose();
    }
  }, 60_000);

  it("two engines never share result buffers", async () => {
    let first: RealEngineHandle | undefined;
    let second: RealEngineHandle | undefined;
    try {
      first = await createRealEngine({ variant: "light", maxEntities: 32 });
      second = await createRealEngine({ variant: "light", maxEntities: 32 });
      const typeA = first.bridge.registerComponentType();
      second.bridge.registerComponentType();
      const typeB = second.bridge.registerComponentType();

      const slotsA: number[] = [];
      for (let n = 0; n < 3; n += 1) {
        const id = first.bridge.createEntity();
        first.bridge.addComponent(id.index, id.generation, typeA, new Uint8Array(4));
        slotsA.push(id.index);
      }

      second.bridge.createEntity();
      second.bridge.createEntity();
      const matchB = second.bridge.createEntity();
      second.bridge.addComponent(matchB.index, matchB.generation, typeB, new Uint8Array(4));

      const countA = first.bridge.queryEntitiesRaw([typeA]);
      const viewA = rawIndices(first.bridge, typeA);
      expect(countA).toBe(slotsA.length);

      const countB = second.bridge.queryEntitiesRaw([typeB]);
      expect(countB).toBe(1);
      expect(viewA).toEqual(slotsA);
      expect(rawIndices(first.bridge, typeA)).toEqual(slotsA);
    } finally {
      await first?.dispose();
      await second?.dispose();
    }
  });

  it("a query that matched nothing includes the entity after the component is added", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 8 });
    try {
      const { bridge } = handle;
      const typeA = bridge.registerComponentType();
      const typeB = bridge.registerComponentType();
      const created = bridge.createEntity();
      const bytes = new Uint8Array(4);

      // {A,B} stays behind and {B} does not. The empty query is cached on {A,B}.
      // Adding B alone builds a new archetype, which the old per-archetype drop misses.
      expect(bridge.addComponent(created.index, created.generation, typeA, bytes)).toBe(true);
      expect(bridge.addComponent(created.index, created.generation, typeB, bytes)).toBe(true);
      expect(bridge.removeComponent(created.index, created.generation, typeB)).toBe(true);
      expect(bridge.removeComponent(created.index, created.generation, typeA)).toBe(true);
      expect(bridge.queryEntities([typeB])).toEqual([]);

      expect(bridge.addComponent(created.index, created.generation, typeB, bytes)).toBe(true);
      expect(bridge.queryEntities([typeB])).toHaveLength(1);
    } finally {
      await handle.dispose();
    }
  });
});
