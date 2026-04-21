/**
 * _resetWasmBridge() — globalThis glue cache eviction.
 *
 * Verifies that _resetWasmBridge() clears any __gwenGlue_* keys that
 * loadWasmGlue() would have set on globalThis, so tests start clean.
 *
 * engine.stop() — WASM module and glue cache cleanup.
 *
 * Verifies that engine.stop() clears _wasmModules and corresponding
 * globalThis glue keys so that next init can reload fresh.
 */

import { describe, it, expect, afterEach } from "vitest";
import { _resetWasmBridge } from "../../src/testing";
import { createEngine } from "../../src/engine/gwen-engine";

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

describe("engine.stop() — WASM module and glue cache cleanup", () => {
  afterEach(() => {
    const ctx = globalThis as Record<string, unknown>;
    for (const key of Object.keys(ctx)) {
      if (key.startsWith("__gwenGlue_")) delete ctx[key];
    }
  });

  it("clears _wasmModules map on stop()", async () => {
    const engine = await createEngine();

    // Access private _wasmModules via type assertion for testing
    const wasmModules = (engine as any)._wasmModules as Map<string, unknown>;

    // Add a mock entry to the map (simulating a loaded WASM module)
    wasmModules.set("test_module", {
      handle: { name: "test_module", exports: {}, memory: undefined },
      step: undefined,
    });

    expect(wasmModules.size).toBe(1);

    // Stop the engine
    await engine.stop();

    // Verify _wasmModules was cleared
    expect(wasmModules.size).toBe(0);
  });

  it("deletes globalThis glue cache keys on stop()", async () => {
    const engine = await createEngine();
    const wasmModules = (engine as any)._wasmModules as Map<string, unknown>;
    const ctx = globalThis as Record<string, unknown>;

    // Add mock entries with a glue key
    const glueKey = "__gwenGlue_test_module_";
    ctx[glueKey] = { mock: true };
    wasmModules.set("test_module", {
      handle: { name: "test_module", exports: {}, memory: undefined },
      step: undefined,
    });

    expect(ctx[glueKey]).toBeDefined();

    // Stop the engine
    await engine.stop();

    // Verify glue key was deleted
    expect(ctx[glueKey]).toBeUndefined();
  });
});
