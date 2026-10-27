import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { CONTRACT as lightContract } from "@gwenjs/core/wasm/light/factory";
import { CONTRACT as physics2dContract } from "@gwenjs/core/wasm/physics2d/factory";
import { CONTRACT as physics3dContract } from "@gwenjs/core/wasm/physics3d/factory";
import { afterEach, beforeEach, expect, it } from "vitest";

import {
  checkGwenModule,
  GwenWasmMismatchError,
  type GlueContract,
} from "../../src/engine/wasm-contract.js";

const HINT = "Load the binary with the factory of the same build (pnpm build:wasm rebuilds both).";
const NO_BUILD = "<no gwen.build section>";
const NO_FINGERPRINT = "<no gwen.fingerprint section>";

const VARIANTS = [
  {
    name: "light",
    bytes: wasmBytes("../../wasm/light/gwen_core_bg.wasm"),
    contract: lightContract,
  },
  {
    name: "physics2d",
    bytes: wasmBytes("../../wasm/physics2d/gwen_core_bg.wasm"),
    contract: physics2dContract,
  },
  {
    name: "physics3d",
    bytes: wasmBytes("../../wasm/physics3d/gwen_core_bg.wasm"),
    contract: physics3dContract,
  },
] as const;

const fixtureBytes = wasmBytes("../fixtures/wasm/light-count-entities-f64/gwen_core_bg.wasm");

const originalInstantiate = WebAssembly.instantiate;
const OriginalInstance = WebAssembly.Instance;
const originalSections = WebAssembly.Module.customSections;

let instantiateCalls = 0;
let instanceCalls = 0;
let sectionReads = 0;

function wasmBytes(relativePath: string): Uint8Array<ArrayBuffer> {
  const wasmPath = fileURLToPath(new URL(relativePath, import.meta.url));
  const file = readFileSync(wasmPath);
  const bytes = new Uint8Array(file.byteLength);
  bytes.set(file);
  return bytes;
}

function compile(bytes: Uint8Array<ArrayBuffer>): WebAssembly.Module {
  return new WebAssembly.Module(bytes);
}

function sectionText(module: WebAssembly.Module, name: string): string[] {
  return WebAssembly.Module.customSections(module, name).map((section) =>
    new TextDecoder().decode(section),
  );
}

interface WasmSlice {
  readonly name: string;
  readonly start: number;
  readonly end: number;
}

function readLeb(bytes: Uint8Array, offset: number): { value: number; next: number } {
  let value = 0;
  let shift = 0;
  let pos = offset;
  for (;;) {
    const byte = bytes[pos];
    if (byte === undefined) throw new Error("wasm LEB128 ran past the binary");
    pos += 1;
    value += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) return { value, next: pos };
    shift += 7;
  }
}

/** Walk section id, LEB128 size, and custom-section name. Offsets are not guessed. */
function wasmSlices(bytes: Uint8Array): WasmSlice[] {
  if (
    bytes.length < 8 ||
    bytes[0] !== 0x00 ||
    bytes[1] !== 0x61 ||
    bytes[2] !== 0x73 ||
    bytes[3] !== 0x6d
  ) {
    throw new Error("not a wasm binary");
  }
  const slices: WasmSlice[] = [];
  let offset = 8;
  const decoder = new TextDecoder();
  while (offset < bytes.length) {
    const id = bytes[offset];
    if (id === undefined) break;
    const size = readLeb(bytes, offset + 1);
    const end = size.next + size.value;
    if (end > bytes.length) throw new Error("wasm section exceeds the binary");
    let name = "";
    if (id === 0) {
      const nameLen = readLeb(bytes, size.next);
      name = decoder.decode(bytes.subarray(nameLen.next, nameLen.next + nameLen.value));
    }
    slices.push({ name, start: offset, end });
    offset = end;
  }
  if (offset !== bytes.length) throw new Error("wasm section walk stopped early");
  return slices;
}

function repack(bytes: Uint8Array, slices: readonly WasmSlice[]): Uint8Array<ArrayBuffer> {
  let length = 8;
  for (const slice of slices) length += slice.end - slice.start;
  const out = new Uint8Array(length);
  out.set(bytes.subarray(0, 8), 0);
  let cursor = 8;
  for (const slice of slices) {
    out.set(bytes.subarray(slice.start, slice.end), cursor);
    cursor += slice.end - slice.start;
  }
  return out;
}

function withoutSection(bytes: Uint8Array, name: string): Uint8Array<ArrayBuffer> {
  return repack(
    bytes,
    wasmSlices(bytes).filter((slice) => slice.name !== name),
  );
}

function duplicateSection(bytes: Uint8Array, name: string): Uint8Array<ArrayBuffer> {
  const slices = wasmSlices(bytes);
  const found = slices.find((slice) => slice.name === name);
  if (found === undefined) throw new Error(`missing ${name}`);
  return repack(bytes, [...slices, found]);
}

function capture(module: WebAssembly.Module, contract: GlueContract): GwenWasmMismatchError {
  let caught: unknown;
  expect(() => {
    try {
      checkGwenModule(module, contract);
    } catch (error: unknown) {
      caught = error;
      throw error;
    }
  }).toThrow(GwenWasmMismatchError);
  if (!(caught instanceof GwenWasmMismatchError)) {
    throw new Error("checkGwenModule did not throw GwenWasmMismatchError");
  }
  return caught;
}

beforeEach(() => {
  instantiateCalls = 0;
  instanceCalls = 0;
  sectionReads = 0;
  WebAssembly.instantiate = new Proxy(originalInstantiate, {
    apply(target, thisArg, argArray) {
      instantiateCalls += 1;
      return Reflect.apply(target, thisArg, argArray);
    },
  });
  const Parent = OriginalInstance;
  class CountingInstance extends Parent {
    constructor(module: WebAssembly.Module, importObject?: WebAssembly.Imports) {
      instanceCalls += 1;
      if (importObject === undefined) {
        super(module);
        return;
      }
      super(module, importObject);
    }
  }
  WebAssembly.Instance = CountingInstance;
  const customSections = originalSections;
  WebAssembly.Module.customSections = (module, sectionName) => {
    sectionReads += 1;
    return customSections.call(WebAssembly.Module, module, sectionName);
  };
});

afterEach(() => {
  WebAssembly.instantiate = originalInstantiate;
  WebAssembly.Instance = OriginalInstance;
  WebAssembly.Module.customSections = originalSections;
});

it.each(VARIANTS)("$name contract accepts its own Module", ({ bytes, contract }) => {
  expect(() => checkGwenModule(compile(bytes), contract)).not.toThrow();
});

it("the light contract rejects the physics2d Module with reason build and both fingerprints in the message", () => {
  const error = capture(compile(VARIANTS[1].bytes), lightContract);
  expect(error.code).toBe("CORE:WASM_GLUE_MISMATCH");
  expect(error.reason).toBe("build");
  expect(error.expected).toBe(lightContract.buildId);
  expect(error.actual).toBe(physics2dContract.buildId);
  expect(error.message).toContain("variant=light");
  expect(error.message).toContain("variant=physics2d");
  expect(error.message).toContain(lightContract.buildId);
  expect(error.message).toContain(physics2dContract.buildId);
  expect(error.message).toContain(lightContract.fingerprint);
  expect(error.message).toContain(physics2dContract.fingerprint);
});

it("another light build with the same export names is rejected with reason build", () => {
  const module = compile(fixtureBytes);
  const exported = new Set(WebAssembly.Module.exports(module).map((item) => item.name));
  for (const name of lightContract.rawExports) {
    expect(exported.has(name)).toBe(true);
  }
  const error = capture(module, lightContract);
  const build = sectionText(module, "gwen.build");
  expect(build).toHaveLength(1);
  expect(error.reason).toBe("build");
  expect(error.expected).toBe(lightContract.buildId);
  expect(error.actual).toBe(build[0]);
});

it("a Module without gwen.build is rejected with actual <no gwen.build section>", () => {
  const module = compile(withoutSection(VARIANTS[0].bytes, "gwen.build"));
  expect(sectionText(module, "gwen.build")).toHaveLength(0);
  const error = capture(module, lightContract);
  expect(error.reason).toBe("build");
  expect(error.expected).toBe(lightContract.buildId);
  expect(error.actual).toBe(NO_BUILD);
});

it("no WebAssembly instance exists when the check rejects", () => {
  expect(() => checkGwenModule(compile(VARIANTS[1].bytes), lightContract)).toThrow(
    GwenWasmMismatchError,
  );
  expect(instantiateCalls).toBe(0);
  expect(instanceCalls).toBe(0);
});

it("the check reads the sections once per compiled Module", () => {
  const bytes = VARIANTS[0].bytes;
  const module = compile(bytes);
  const before = sectionReads;
  checkGwenModule(module, lightContract);
  const first = sectionReads - before;
  expect(first).toBeGreaterThan(0);
  checkGwenModule(module, lightContract);
  expect(sectionReads - before).toBe(first);
  const again = compile(bytes);
  const mid = sectionReads;
  checkGwenModule(again, lightContract);
  expect(sectionReads - mid).toBe(first);
});

it("a failed check is not cached", () => {
  const module = compile(VARIANTS[0].bytes);
  expect(() => checkGwenModule(module, physics2dContract)).toThrow(GwenWasmMismatchError);
  expect(() => checkGwenModule(module, lightContract)).not.toThrow();
  expect(() => checkGwenModule(module, physics2dContract)).toThrow(GwenWasmMismatchError);
});

it("reason exports names a raw export the Module lacks", () => {
  const missing = "not_a_gwen_export";
  const module = compile(VARIANTS[0].bytes);
  const exported = new Set(WebAssembly.Module.exports(module).map((item) => item.name));
  expect(exported.has(missing)).toBe(false);
  const error = capture(module, {
    ...lightContract,
    rawExports: [...lightContract.rawExports, missing],
  });
  expect(error.reason).toBe("exports");
  expect(error.expected).toBe(missing);
  expect(error.actual).toBe("<absent>");
});

it("reason imports names an import outside the contract", () => {
  const module = compile(VARIANTS[0].bytes);
  const removed = lightContract.imports[0];
  if (removed === undefined) throw new Error("light contract has no imports");
  const imported = WebAssembly.Module.imports(module).map((item) => item.name);
  expect(imported).toContain(removed);
  const error = capture(module, {
    ...lightContract,
    imports: lightContract.imports.filter((name) => name !== removed),
  });
  expect(error.reason).toBe("imports");
  expect(error.expected).toBe("<not in contract>");
  expect(error.actual).toBe(removed);
});

it("equal build ids with a different fingerprint give reason fingerprint", () => {
  const module = compile(VARIANTS[0].bytes);
  const fingerprint = `${lightContract.fingerprint};other`;
  const error = capture(module, { ...lightContract, fingerprint });
  const fromBinary = sectionText(module, "gwen.fingerprint");
  expect(fromBinary).toHaveLength(1);
  expect(error.reason).toBe("fingerprint");
  expect(error.expected).toBe(fingerprint);
  expect(error.actual).toBe(fromBinary[0]);
});

it("the glue mismatch hint is on only under __GWEN_DEV__", () => {
  const error = capture(compile(VARIANTS[1].bytes), lightContract);
  if (__GWEN_DEV__) {
    expect(error.hint).toBe(HINT);
    expect(error.message).toContain("Fix:");
    return;
  }
  expect(error.hint).toBeUndefined();
  expect(error.message).not.toContain("Fix:");
});

it("a second gwen.build section sets actual to <2 gwen.build sections>", () => {
  const module = compile(duplicateSection(VARIANTS[0].bytes, "gwen.build"));
  expect(sectionText(module, "gwen.build")).toHaveLength(2);
  const error = capture(module, lightContract);
  expect(error.reason).toBe("build");
  expect(error.actual).toBe("<2 gwen.build sections>");
});

it("a Module without gwen.fingerprint is rejected with actual <no gwen.fingerprint section>", () => {
  const module = compile(withoutSection(VARIANTS[0].bytes, "gwen.fingerprint"));
  expect(sectionText(module, "gwen.build")).toHaveLength(1);
  expect(sectionText(module, "gwen.fingerprint")).toHaveLength(0);
  const error = capture(module, lightContract);
  expect(error.reason).toBe("fingerprint");
  expect(error.actual).toBe(NO_FINGERPRINT);
});
