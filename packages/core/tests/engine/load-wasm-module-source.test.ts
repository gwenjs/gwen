/**
 * `loadWasmModule` accepts exactly one of `url`, `bytes`, or `module`.
 * The fetch stub throws, so a passing load cannot have downloaded a binary.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GwenError } from "@gwenjs/schema";

import { CoreErrorCodes } from "../../src/engine/engine-errors.js";
import { createRealEngine } from "../../src/testing/create-real-engine.js";

declare module "../../src/engine/engine-types.js" {
  interface GwenWasmModules {
    b: WebAssembly.Exports;
    m: WebAssembly.Exports;
    z: WebAssembly.Exports;
    t: WebAssembly.Exports;
    i: WebAssembly.Exports;
  }
}

// (func (export "gwen_plugin_api_version") (result i32) (i32.const 2001000))
const EMPTY_WASM = Uint8Array.from(
  Buffer.from(
    "0061736d010000000105016000017f03020100071b01176777656e5f706c7567696e5f6170695f76657273696f6e00000a0901070041e890fa000b",
    "hex",
  ),
);

const originalFetch = globalThis.fetch;

describe("loadWasmModule source", () => {
  beforeEach(() => {
    globalThis.fetch = () => {
      throw new Error("fetch called");
    };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("bytes load a module without fetch", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 16 });
    try {
      const loaded = await handle.engine.loadWasmModule({ name: "b", bytes: EMPTY_WASM });
      expect(typeof loaded.exports.gwen_plugin_api_version).toBe("function");
      expect(handle.engine.getWasmModule("b")).toBe(loaded);
    } finally {
      await handle.dispose();
    }
  });

  it("module loads without fetch and is instantiated as an Instance", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 16 });
    try {
      const loaded = await handle.engine.loadWasmModule({
        name: "m",
        module: new WebAssembly.Module(EMPTY_WASM),
      });
      const version = loaded.exports.gwen_plugin_api_version;
      expect(typeof version).toBe("function");
      if (typeof version !== "function")
        throw new Error("gwen_plugin_api_version is not a function");
      const returned: unknown = Reflect.apply(version, undefined, []);
      expect(returned).toBe(2_001_000);
      expect(handle.engine.getWasmModule("m")).toBe(loaded);
    } finally {
      await handle.dispose();
    }
  });

  it("zero sources reject with CORE:WASM_LOAD_ERROR naming url, bytes and module", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 16 });
    try {
      let caught: unknown;
      try {
        await handle.engine.loadWasmModule({ name: "z" });
      } catch (error: unknown) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(GwenError);
      if (!(caught instanceof GwenError)) throw caught;
      expect(caught.code).toBe(CoreErrorCodes.WASM_LOAD_ERROR);
      expect(caught.message).toContain("needs exactly one of url, bytes or module; got 0.");

      let missing: unknown;
      try {
        handle.engine.getWasmModule("z");
      } catch (error: unknown) {
        missing = error;
      }
      expect(missing).toBeInstanceOf(GwenError);
      if (!(missing instanceof GwenError)) throw missing;
      expect(missing.code).toBe(CoreErrorCodes.WASM_MODULE_NOT_FOUND);
    } finally {
      await handle.dispose();
    }
  });

  it("two sources reject with CORE:WASM_LOAD_ERROR", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 16 });
    try {
      let caught: unknown;
      try {
        await handle.engine.loadWasmModule({
          name: "t",
          url: "https://example.invalid/t.wasm",
          bytes: EMPTY_WASM,
        });
      } catch (error: unknown) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(GwenError);
      if (!(caught instanceof GwenError)) throw caught;
      expect(caught.code).toBe(CoreErrorCodes.WASM_LOAD_ERROR);
      expect(caught.message).toContain("got 2.");

      let missing: unknown;
      try {
        handle.engine.getWasmModule("t");
      } catch (error: unknown) {
        missing = error;
      }
      expect(missing).toBeInstanceOf(GwenError);
      if (!(missing instanceof GwenError)) throw missing;
      expect(missing.code).toBe(CoreErrorCodes.WASM_MODULE_NOT_FOUND);
    } finally {
      await handle.dispose();
    }
  });

  it("invalid bytes reject with CORE:WASM_LOAD_ERROR, not a CompileError", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 16 });
    try {
      let caught: unknown;
      try {
        await handle.engine.loadWasmModule({ name: "i", bytes: new Uint8Array([0, 1, 2]) });
      } catch (error: unknown) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(GwenError);
      if (!(caught instanceof GwenError)) throw caught;
      expect(caught).not.toBeInstanceOf(WebAssembly.CompileError);
      expect(caught.code).toBe(CoreErrorCodes.WASM_LOAD_ERROR);
      expect(caught.message).toContain("bytes (3 bytes)");
    } finally {
      await handle.dispose();
    }
  });
});
