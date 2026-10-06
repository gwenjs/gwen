/**
 * Glue cache is shared by WASM variant.
 *
 * Resetting one bridge, or stopping one engine, must leave `__gwenGlue_*`
 * keys in place for any other engine on the same variant.
 */

import { describe, it, expect, afterEach } from "vitest";
import { WasmBridgeImpl } from "../../src/internal";
import { createEngine } from "../../src/engine/gwen-engine";

describe("WasmBridgeImpl._reset keeps the shared glue cache", () => {
  afterEach(() => {
    const ctx = globalThis as Record<string, unknown>;
    for (const key of Object.keys(ctx)) {
      if (key.startsWith("__gwenGlue_")) delete ctx[key];
    }
  });

  it("keeps __gwenGlue_ module cache keys", () => {
    const ctx = globalThis as Record<string, unknown>;
    ctx["__gwenGlue_https___cdn_example_com_gwen_js"] = { version: "mock" };

    new WasmBridgeImpl()._reset();

    expect(ctx["__gwenGlue_https___cdn_example_com_gwen_js"]).toEqual({ version: "mock" });
  });

  it("keeps __resolve callback keys left by the blob script path", () => {
    const ctx = globalThis as Record<string, unknown>;
    const resolve = () => {};
    ctx["__gwenGlue_https___cdn_example_com_gwen_js__resolve"] = resolve;

    new WasmBridgeImpl()._reset();

    expect(ctx["__gwenGlue_https___cdn_example_com_gwen_js__resolve"]).toBe(resolve);
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

  it("keeps globalThis glue cache keys on stop()", async () => {
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

    expect(ctx[glueKey]).toEqual({ mock: true });
  });
});
