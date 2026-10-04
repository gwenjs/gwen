import { describe, expect, it } from "vitest";

import { createRealEngine } from "./harness.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isEntityLimitError(value: unknown): value is Error {
  if (!(value instanceof Error)) return false;
  if (isRecord(value) && value["code"] === "ENTITY_LIMIT_REACHED") return true;
  return /limit/i.test(value.message);
}

describe("P0 entity quota", () => {
  it.fails("D7 entity quota: the extra create is a recoverable limit error", async () => {
    const maxEntities = 4;
    const { bridge } = await createRealEngine({
      variant: "light",
      maxEntities,
    });

    let caught: unknown;
    try {
      for (let n = 0; n < maxEntities + 1; n += 1) {
        bridge.createEntity();
      }
    } catch (error: unknown) {
      caught = error;
    }

    expect(isEntityLimitError(caught)).toBe(true);
    expect(bridge.countEntities()).toBe(maxEntities);
    expect(bridge.isAlive(0, 0)).toBe(true);
  });
});
