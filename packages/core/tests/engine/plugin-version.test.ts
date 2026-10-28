/**
 * @file Tests for checkPluginApiVersion and GWEN_PLUGIN_API_VERSION.
 */

import { describe, it, expect } from "vitest";
import { checkPluginApiVersion, GWEN_PLUGIN_API_VERSION } from "../../src/engine/engine-types";

const ADVICE = "recompile the plugin against the current gwen-wasm-utils / ABI version.";

function abiMessage(moduleName: string, shown: string): string {
  const what = `Plugin "${moduleName}" declares ABI version ${shown}, expected 2001000.`;
  const fix = __GWEN_DEV__ ? `\nFix: ${ADVICE}` : "";
  return `[checkPluginApiVersion()] ${what}${fix}\nSee https://gwenjs.github.io/gwen/api/errors#core-wasm-module-abi-mismatch (CORE:WASM_MODULE_ABI_MISMATCH)`;
}

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
    expect(readField(caught, "expected")).toBe(2_001_000);
    expect(readField(caught, "actual")).toBeNull();
    expect(readField(caught, "composable")).toBe("checkPluginApiVersion");
    expect(readField(caught, "hint")).toBe(__GWEN_DEV__ ? ADVICE : undefined);
    expect(caught.message.split("\n")[0]).not.toContain("Fix:");
    expect(caught.message).toBe(abiMessage("bare", "none declared"));
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
    expect(readField(caught, "composable")).toBe("checkPluginApiVersion");
    expect(readField(caught, "hint")).toBe(__GWEN_DEV__ ? ADVICE : undefined);
    expect(caught.message.split("\n")[0]).not.toContain("Fix:");
    expect(caught.message).toContain("none declared");
    expect(caught.message).toContain("bad-export");
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
    expect(caught.message).toContain('Plugin "text-version"');
    expect(caught.message).toContain("none declared");
  });

  it("throws GwenWasmAbiError naming 2001000 and 2000001", () => {
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
    expect(readField(caught, "expected")).toBe(2_001_000);
    expect(readField(caught, "actual")).toBe(2_000_001);
    expect(readField(caught, "composable")).toBe("checkPluginApiVersion");
    expect(readField(caught, "hint")).toBe(__GWEN_DEV__ ? ADVICE : undefined);
    expect(caught.message.split("\n")[0]).not.toContain("Fix:");
    expect(caught.message).toBe(abiMessage("next", "2000001"));
  });

  it("returns undefined when the export equals the current version", () => {
    const exports: WebAssembly.Exports = {
      gwen_plugin_api_version: () => GWEN_PLUGIN_API_VERSION,
    };
    expect(checkPluginApiVersion(exports, "current")).toBeUndefined();
  });
});

function abiNumber(major: number, minor: number, patch: number): number {
  return major * 1_000_000 + minor * 1_000 + patch;
}

describe("GWEN_PLUGIN_API_VERSION", () => {
  it("is 2_001_000", () => {
    expect(GWEN_PLUGIN_API_VERSION).toBe(2_001_000);
  });

  it("uses encoding major * 1_000_000 + minor * 1_000 + patch", () => {
    expect(GWEN_PLUGIN_API_VERSION).toBe(abiNumber(2, 1, 0));
  });
});
