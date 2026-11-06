/**
 * Prefix rule for the main entry.
 * `LAYER_ERROR_CODES` is data, so it is not an allow entry: a non-function name is stale.
 */

import { describe, expect, it } from "vitest";
import { runComposableSurfaceSuite } from "@gwenjs/plugin-conformance";
import * as api from "../src/index.js";

const ALLOW: Readonly<Record<string, string>> = {
  readCollisionEvents: "pure buffer reader; it takes a DataView and does not touch an engine",
  clearEngineContacts: "engine is an argument; the clear prefix is not a composable prefix",
};

/** Reason kept beside the suite. Passing this name in `allow` would be reported stale. */
const DATA: Readonly<Record<string, string>> = {
  LAYER_ERROR_CODES:
    "pure data; the caller maps these codes onto a dimension package, and they carry no PHYSICS prefix",
};

describe("physics-core entry", () => {
  it("readCollisionEvents is a function", () => {
    expect(typeof api.readCollisionEvents).toBe("function");
  });

  it("clearEngineContacts is a function", () => {
    expect(typeof api.clearEngineContacts).toBe("function");
  });

  it("LAYER_ERROR_CODES is data", () => {
    expect(typeof api.LAYER_ERROR_CODES).toBe("object");
    expect(api.LAYER_ERROR_CODES.LAYER_LIMIT).toBe("LAYER_LIMIT");
    expect(api.LAYER_ERROR_CODES.LAYER_UNKNOWN).toBe("LAYER_UNKNOWN");
    expect(api.LAYER_ERROR_CODES.LAYER_BIT_RANGE).toBe("LAYER_BIT_RANGE");
    expect(DATA.LAYER_ERROR_CODES.length).toBeGreaterThan(0);
  });
});

runComposableSurfaceSuite(api, { allow: Object.keys(ALLOW) });
