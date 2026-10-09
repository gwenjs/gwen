/**
 * Glue cache is shared by WASM variant.
 *
 * Resetting one bridge, or stopping one engine, must leave `__gwenGlue_*`
 * keys in place for any other engine on the same variant.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { WasmBridgeImpl } from "../../src/internal";
import { createEngine } from "../../src/engine/gwen-engine";
import { CoreErrorCodes } from "../../src/engine/engine-errors.js";

declare module "../../src/engine/engine-types.js" {
  interface GwenWasmModules {
    test_module: WebAssembly.Exports;
  }
}

const MINIMAL_WASM = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

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
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    const ctx = globalThis as Record<string, unknown>;
    for (const key of Object.keys(ctx)) {
      if (key.startsWith("__gwenGlue_")) delete ctx[key];
    }
  });

  function engineWithWasmFetch(): Promise<Awaited<ReturnType<typeof createEngine>>> {
    vi.stubGlobal("fetch", () =>
      Promise.resolve({
        ok: true,
        status: 200,
        statusText: "OK",
        arrayBuffer: () =>
          Promise.resolve(
            MINIMAL_WASM.buffer.slice(
              MINIMAL_WASM.byteOffset,
              MINIMAL_WASM.byteOffset + MINIMAL_WASM.byteLength,
            ),
          ),
      }),
    );
    const bridge = new WasmBridgeImpl();
    vi.spyOn(bridge, "isActive").mockReturnValue(true);
    return createEngine({ _bridge: bridge });
  }

  it("clears _wasmModules map on stop()", async () => {
    const engine = await engineWithWasmFetch();
    await engine.loadWasmModule({ name: "test_module", url: "http://x/test_module.wasm" });
    expect(engine.getWasmModule("test_module").name).toBe("test_module");

    await engine.stop();

    let caught: unknown;
    expect(() => {
      try {
        engine.getWasmModule("test_module");
      } catch (error) {
        caught = error;
        throw error;
      }
    }).toThrow(/test_module/);
    expect(caught).toMatchObject({ code: CoreErrorCodes.WASM_MODULE_NOT_FOUND });
  });

  it("keeps globalThis glue cache keys on stop()", async () => {
    const engine = await engineWithWasmFetch();
    const name = "test_module";
    try {
      await engine.loadWasmModule({ name, url: "http://x/test_module.wasm" });
      const ctx = globalThis as Record<string, unknown>;
      const glueKey = `__gwenGlue_${name}_`;
      ctx[glueKey] = { mock: true };

      await engine.stop();

      expect(ctx[glueKey]).toEqual({ mock: true });
    } finally {
      await engine.stop();
    }
  });
});
