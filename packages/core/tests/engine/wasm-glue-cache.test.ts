/**
 * _resetWasmBridge() — globalThis glue cache eviction.
 *
 * Verifies that _resetWasmBridge() clears any __gwenGlue_* keys that
 * loadWasmGlue() would have set on globalThis, so tests start clean.
 */

import { describe, it, expect, afterEach } from "vitest";
import { _resetWasmBridge } from "../../src/engine/wasm-bridge";

describe("_resetWasmBridge — globalThis glue cache eviction", () => {
  afterEach(() => {
    // Belt-and-suspenders: clean up any leftover keys from the test itself.
    const ctx = globalThis as Record<string, unknown>;
    for (const key of Object.keys(ctx)) {
      if (key.startsWith("__gwenGlue_")) delete ctx[key];
    }
    _resetWasmBridge();
  });

  it("removes __gwenGlue_ module cache keys set by loadWasmGlue", () => {
    const ctx = globalThis as Record<string, unknown>;
    // Simulate what loadWasmGlue() writes after a successful load.
    ctx["__gwenGlue_https___cdn_example_com_gwen_js"] = { version: "mock" };

    _resetWasmBridge();

    expect(ctx["__gwenGlue_https___cdn_example_com_gwen_js"]).toBeUndefined();
  });

  it("removes __resolve callback keys left by the blob script path", () => {
    const ctx = globalThis as Record<string, unknown>;
    // Simulate what the main-thread blob path writes before the script runs.
    ctx["__gwenGlue_https___cdn_example_com_gwen_js__resolve"] = () => {};

    _resetWasmBridge();

    expect(ctx["__gwenGlue_https___cdn_example_com_gwen_js__resolve"]).toBeUndefined();
  });
});
