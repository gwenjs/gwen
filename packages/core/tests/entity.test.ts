import { describe, it, expect } from "vitest";
import { entityIndex } from "../src/engine/engine-api";
import type { EntityId } from "../src/engine/engine-api";
import { createEntityId } from "../src/engine/engine-api";

describe("entityIndex", () => {
  it("returns correct index for generation 0", () => {
    // entityId = (0n << 32n) | 5n = 5n
    const id = 5n as EntityId;
    expect(entityIndex(id)).toBe(5);
  });

  it("does not corrupt index when generation is large (>= 2^21)", () => {
    // generation = 2^21 = 2097152, index = 7
    // id = (2097152n << 32n) | 7n
    const generation = 2097152;
    const index = 7;
    const id = createEntityId(index, generation);
    expect(entityIndex(id)).toBe(7);
  });

  it("handles max u32 index (0xffffffff)", () => {
    const id = 0xffffffffn as EntityId;
    expect(entityIndex(id)).toBe(0xffffffff);
  });
});
