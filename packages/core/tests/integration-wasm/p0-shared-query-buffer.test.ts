import { describe, expect, it } from "vitest";

import type { WasmBridgeImpl } from "../../src/engine/wasm-bridge.js";
import { createRealEngine } from "./harness.js";

function liveQuerySlots(bridge: WasmBridgeImpl, count: number): Uint32Array {
  const memory = bridge.getLinearMemory();
  if (memory === null) {
    throw new Error("wasm memory unavailable");
  }
  const ptr = bridge.engine().get_query_result_ptr();
  return new Uint32Array(memory.buffer, ptr, count);
}

describe("P0 shared query buffer", () => {
  it("D8 two engines: a buffer query view stays private to its engine", async () => {
    const first = await createRealEngine({ variant: "light", maxEntities: 32 });
    const second = await createRealEngine({ variant: "light", maxEntities: 32 });
    const typeA = first.bridge.registerComponentType();
    second.bridge.registerComponentType();
    const typeB = second.bridge.registerComponentType();

    const slotsA: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const id = first.bridge.createEntity();
      first.bridge.addComponent(id.index, id.generation, typeA, new Uint8Array(4));
      slotsA.push(id.index);
    }

    // Padding so the single match on the second engine is not index 0.
    second.bridge.createEntity();
    second.bridge.createEntity();
    const matchB = second.bridge.createEntity();
    second.bridge.addComponent(matchB.index, matchB.generation, typeB, new Uint8Array(4));

    const countA = first.bridge.queryEntitiesRaw([typeA]);
    expect(countA).toBe(slotsA.length);
    const viewA = liveQuerySlots(first.bridge, countA);

    const countB = second.bridge.queryEntitiesRaw([typeB]);
    expect(countB).toBe(1);
    expect(Array.from(viewA)).toEqual(slotsA);
  });
});
