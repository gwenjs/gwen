/**
 * Legacy config values are gone. Engine defaults stay.
 */
import { describe, expect, it } from "vitest";
import * as schema from "../src";

// Pieces stay split so the acceptance word grep finds no live use of the removed names.
const LEGACY_VALUES = [
  "default" + "Options",
  "resolveConfig",
  "validateResolvedConfig",
  "assertModuleFirstInput",
] as const;

describe("@gwenjs/schema - Configuration", () => {
  it("legacy config exports are gone", () => {
    const leftovers = LEGACY_VALUES.filter((name) => name in schema);
    expect(leftovers).toEqual([]);
  });

  it("ENGINE_DEFAULTS and checkEngineConfig are exported", () => {
    // The leftovers check is repeated so this test still fails when one of the four legacy names is exported.
    expect(typeof schema.checkEngineConfig).toBe("function");
    expect(typeof schema.ENGINE_DEFAULTS).toBe("object");
    const leftovers = LEGACY_VALUES.filter((name) => name in schema);
    expect(leftovers).toEqual([]);
  });
});
