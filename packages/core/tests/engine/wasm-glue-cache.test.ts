/**
 * `engine.stop()` drops community WASM modules loaded on that engine.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { WasmBridgeImpl } from "../../src/internal";
import { createEngine } from "../../src/engine/engine-factory";
import { CoreErrorCodes } from "../../src/engine/engine-errors.js";

declare module "../../src/engine/engine-types.js" {
  interface GwenWasmModules {
    test_module: WebAssembly.Exports;
  }
}

const MINIMAL_WASM = Uint8Array.from(
  Buffer.from(
    "0061736d010000000105016000017f03020100071b01176777656e5f706c7567696e5f6170695f76657273696f6e00000a0901070041e890fa000b",
    "hex",
  ),
);

describe("engine.stop() — WASM module and glue cache cleanup", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
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
});
