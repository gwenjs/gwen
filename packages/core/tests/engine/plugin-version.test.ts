/**
 * @file Tests for checkPluginApiVersion and GWEN_PLUGIN_API_VERSION.
 */

import { describe, it, expect } from "vitest";
import { checkPluginApiVersion, GWEN_PLUGIN_API_VERSION } from "../../src/engine/engine-types";

const FIX = "Fix: recompile the plugin against the current gwen-wasm-utils / ABI version.";

function readField(value: object, key: string): unknown {
  return Reflect.get(value, key);
}

describe("checkPluginApiVersion", () => {
  it("throws GwenWasmAbiError with actual null when the export is absent", () => {
    const exports: WebAssembly.Exports = {};
    let caught: unknown;
    try {
      checkPluginApiVersion(exports, "bare");
    } catch (error: unknown) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    if (!(caught instanceof Error)) return;
    expect(caught.name).toBe("GwenWasmAbiError");
    expect(readField(caught, "code")).toBe("CORE:WASM_MODULE_ABI_MISMATCH");
    expect(readField(caught, "module")).toBe("bare");
    expect(readField(caught, "expected")).toBe(2_000_000);
    expect(readField(caught, "actual")).toBeNull();
    expect(caught.message).toBe(
      `[GWEN] loadWasmModule("bare"): plugin ABI version none declared does not match 2000000. ${FIX}`,
    );
  });

  it("throws GwenWasmAbiError with actual null when the export is not a function", () => {
    const exports: WebAssembly.Exports = {};
    Object.defineProperty(exports, "gwen_plugin_api_version", { value: "not a function" });
    let caught: unknown;
    try {
      checkPluginApiVersion(exports, "bad-export");
    } catch (error: unknown) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    if (!(caught instanceof Error)) return;
    expect(caught.name).toBe("GwenWasmAbiError");
    expect(readField(caught, "code")).toBe("CORE:WASM_MODULE_ABI_MISMATCH");
    expect(readField(caught, "actual")).toBeNull();
    expect(caught.message).toContain("none declared");
    expect(caught.message).toContain("bad-export");
    expect(caught.message).toContain(FIX);
  });

  it("throws GwenWasmAbiError with actual null when the export returns a non-number", () => {
    const exports: WebAssembly.Exports = {
      gwen_plugin_api_version: () => "nope",
    };
    let caught: unknown;
    try {
      checkPluginApiVersion(exports, "text-version");
    } catch (error: unknown) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    if (!(caught instanceof Error)) return;
    expect(readField(caught, "code")).toBe("CORE:WASM_MODULE_ABI_MISMATCH");
    expect(readField(caught, "actual")).toBeNull();
    expect(caught.message).toContain('loadWasmModule("text-version")');
    expect(caught.message).toContain("none declared");
  });

  it("throws GwenWasmAbiError naming 2000000 and 2000001", () => {
    const exports: WebAssembly.Exports = {
      gwen_plugin_api_version: () => 2_000_001,
    };
    let caught: unknown;
    try {
      checkPluginApiVersion(exports, "next");
    } catch (error: unknown) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    if (!(caught instanceof Error)) return;
    expect(caught.name).toBe("GwenWasmAbiError");
    expect(readField(caught, "code")).toBe("CORE:WASM_MODULE_ABI_MISMATCH");
    expect(readField(caught, "module")).toBe("next");
    expect(readField(caught, "expected")).toBe(2_000_000);
    expect(readField(caught, "actual")).toBe(2_000_001);
    expect(caught.message).toBe(
      `[GWEN] loadWasmModule("next"): plugin ABI version 2000001 does not match 2000000. ${FIX}`,
    );
  });

  it("returns undefined when the export equals the current version", () => {
    const exports: WebAssembly.Exports = {
      gwen_plugin_api_version: () => GWEN_PLUGIN_API_VERSION,
    };
    expect(checkPluginApiVersion(exports, "current")).toBeUndefined();
  });
});

describe("GWEN_PLUGIN_API_VERSION", () => {
  it("is 2_000_000", () => {
    expect(GWEN_PLUGIN_API_VERSION).toBe(2_000_000);
  });

  it("uses encoding major * 1_000_000 + minor * 1_000 + patch", () => {
    // v2.0.0 = 2*1_000_000 + 0*1_000 + 0 = 2_000_000
    // oxlint-disable-next-line erasing-op
    expect(GWEN_PLUGIN_API_VERSION).toBe(2 * 1_000_000 + 0 * 1_000 + 0);
  });
});
