/**
 * Real WASM plugin ABI handshake.
 *
 * Bytes were assembled without wat2wasm (not installed) and proved by
 * `WebAssembly.instantiate` in Node before they were pasted here.
 *
 * Current (`CURRENT_HEX`). WAT:
 *
 * (module
 *   (func (export "gwen_plugin_api_version") (result i32)
 *     i32.const 2000000)
 *   (func (export "marker") (result i32)
 *     i32.const 7))
 *
 * Next (`NEXT_HEX`). WAT:
 *
 * (module
 *   (func (export "gwen_plugin_api_version") (result i32)
 *     i32.const 2000001))
 *
 * Import (`IMPORT_HEX`). WAT:
 *
 * (module
 *   (import "gwen" "abi_version" (func $abi (result i32)))
 *   (func (export "gwen_plugin_api_version") (result i32)
 *     i32.const 2000000)
 *   (func (export "read_abi") (result i32)
 *     (call $abi)))
 *
 * Absent (`EMPTY_HEX`) is `(module)`.
 */

import { describe, expect, it } from "vitest";
import { GWEN_PLUGIN_API_VERSION } from "../../src/engine/engine-types.js";
import { createRealEngine } from "./harness.js";

const FIX = "Fix: recompile the plugin against the current gwen-wasm-utils / ABI version.";

const CURRENT_HEX =
  "0061736d010000000105016000017f0303020000072402176777656e5f706c7567696e5f6170695f76657273696f6e0000066d61726b657200010a0e020700418089fa000b040041070b";
const NEXT_HEX =
  "0061736d010000000105016000017f03020100071b01176777656e5f706c7567696e5f6170695f76657273696f6e00000a09010700418189fa000b";
const IMPORT_HEX =
  "0061736d010000000105016000017f021401046777656e0b6162695f76657273696f6e00000303020000072602176777656e5f706c7567696e5f6170695f76657273696f6e000108726561645f61626900020a0e020700418089fa000b040010000b";
const EMPTY_HEX = "0061736d01000000";

interface VersionExports extends WebAssembly.Exports {
  gwen_plugin_api_version: () => number;
  marker: () => number;
}

interface AbiReadExports extends WebAssembly.Exports {
  gwen_plugin_api_version: () => number;
  read_abi: () => number;
}

function bytesFromHex(hex: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function wasmDataUrl(hex: string): string {
  return `data:application/wasm;base64,${Buffer.from(bytesFromHex(hex)).toString("base64")}`;
}

function failureOf(caught: unknown): {
  name: string;
  code: unknown;
  module: unknown;
  expected: unknown;
  actual: unknown;
  message: string;
} {
  if (!(caught instanceof Error)) {
    return {
      name: "",
      code: undefined,
      module: undefined,
      expected: undefined,
      actual: undefined,
      message: "",
    };
  }
  return {
    name: caught.name,
    code: Reflect.get(caught, "code"),
    module: Reflect.get(caught, "module"),
    expected: Reflect.get(caught, "expected"),
    actual: Reflect.get(caught, "actual"),
    message: caught.message,
  };
}

describe("plugin ABI handshake", () => {
  it("loads a module that returns 2_000_000 and steps it", async () => {
    const started = await createRealEngine({ variant: "light", maxEntities: 32 });
    try {
      expect(GWEN_PLUGIN_API_VERSION).toBe(2_000_000);
      let steps = 0;
      const handle = await started.engine.loadWasmModule<VersionExports>({
        name: "current",
        url: wasmDataUrl(CURRENT_HEX),
        step() {
          steps += 1;
        },
      });
      expect(handle.exports.gwen_plugin_api_version()).toBe(2_000_000);
      expect(handle.exports.marker()).toBe(7);
      const before = started.engine.frameCount;
      await started.advance(1, 1 / 60);
      expect(started.engine.frameCount).toBe(before + 1);
      expect(steps).toBe(1);
      expect(started.engine.state).not.toBe("faulted");
    } finally {
      await started.dispose();
    }
  });

  it("rejects 2_000_001, leaves the module unregistered, and still advances", async () => {
    const accepted = await createRealEngine({ variant: "light", maxEntities: 32 });
    const rejected = await createRealEngine({ variant: "light", maxEntities: 32 });
    try {
      const good = await accepted.engine.loadWasmModule<VersionExports>({
        name: "current",
        url: wasmDataUrl(CURRENT_HEX),
      });
      expect(good.exports.marker()).toBe(7);

      const seen: string[] = [];
      rejected.engine.errors.on((event) => {
        seen.push(event.code);
      });
      let caught: unknown;
      try {
        await rejected.engine.loadWasmModule({
          name: "next",
          url: wasmDataUrl(NEXT_HEX),
        });
      } catch (error: unknown) {
        caught = error;
      }
      const failure = failureOf(caught);
      expect(failure.name).toBe("GwenWasmAbiError");
      expect(failure.code).toBe("CORE:WASM_MODULE_ABI_MISMATCH");
      expect(failure.module).toBe("next");
      expect(failure.expected).toBe(2_000_000);
      expect(failure.actual).toBe(2_000_001);
      expect(failure.message).toBe(
        `[GWEN] loadWasmModule("next"): plugin ABI version 2000001 does not match 2000000. ${FIX}`,
      );
      expect(seen).not.toContain("CORE:WASM_MODULE_ABI_MISMATCH");
      expect(() => rejected.engine.getWasmModule("next")).toThrow(/next/);
      const before = rejected.engine.frameCount;
      await rejected.advance(1, 1 / 60);
      expect(rejected.engine.frameCount).toBe(before + 1);
      expect(rejected.engine.state).not.toBe("faulted");
    } finally {
      await accepted.dispose();
      await rejected.dispose();
    }
  });

  it("rejects a module with no version export and sets actual to null", async () => {
    const started = await createRealEngine({ variant: "light", maxEntities: 32 });
    try {
      let caught: unknown;
      try {
        await started.engine.loadWasmModule({
          name: "bare",
          url: wasmDataUrl(EMPTY_HEX),
        });
      } catch (error: unknown) {
        caught = error;
      }
      const failure = failureOf(caught);
      expect(failure.name).toBe("GwenWasmAbiError");
      expect(failure.code).toBe("CORE:WASM_MODULE_ABI_MISMATCH");
      expect(failure.actual).toBeNull();
      expect(failure.expected).toBe(2_000_000);
      expect(failure.message).toBe(
        `[GWEN] loadWasmModule("bare"): plugin ABI version none declared does not match 2000000. ${FIX}`,
      );
      expect(() => started.engine.getWasmModule("bare")).toThrow(/bare/);
      await started.advance(1, 1 / 60);
      expect(started.engine.state).not.toBe("faulted");
    } finally {
      await started.dispose();
    }
  });

  it("gives the module the current abi_version import", async () => {
    const started = await createRealEngine({ variant: "light", maxEntities: 32 });
    try {
      let read: number | undefined;
      try {
        const handle = await started.engine.loadWasmModule<AbiReadExports>({
          name: "reader",
          url: wasmDataUrl(IMPORT_HEX),
        });
        read = handle.exports.read_abi();
      } catch {
        read = undefined;
      }
      expect(read).toBe(2_000_000);
      expect(read).toBe(GWEN_PLUGIN_API_VERSION);
    } finally {
      await started.dispose();
    }
  });

  it("returns the existing handle when the same name is loaded again", async () => {
    const started = await createRealEngine({ variant: "light", maxEntities: 32 });
    try {
      const first = await started.engine
        .loadWasmModule<AbiReadExports>({
          name: "reader",
          url: wasmDataUrl(IMPORT_HEX),
        })
        .catch(() => undefined);
      expect(first?.exports.read_abi()).toBe(2_000_000);
      if (first === undefined) return;
      const second = await started.engine.loadWasmModule<AbiReadExports>({
        name: "reader",
        url: "data:application/wasm;base64,AAAA",
      });
      expect(second).toBe(first);
    } finally {
      await started.dispose();
    }
  });
});
