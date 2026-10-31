/**
 * Headless Node boot (#89). Real WASM, no DOM.
 * Bytes and a compiled module never go through `fetch`.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

import { GwenError } from "@gwenjs/schema";
import { afterEach, beforeAll, beforeEach, expect, it } from "vitest";

import { createEngine, setupGwen } from "../../src/engine/engine-factory.js";
import type { GwenEngine } from "../../src/engine/engine-types.js";
import { WasmBridgeImpl } from "../../src/engine/wasm-bridge.js";
import type {
  CoreVariant,
  GwenCoreGlueFactoryModule,
  InitWasmOptions,
} from "../../src/engine/wasm-bridge-types.js";

const VARIANTS = ["light", "physics2d", "physics3d"] as const;
const SOURCE_NAMES = ["glue", "jsUrl", "wasmBytes", "wasmModule", "wasmUrl"] as const;
const BINARY_PAIRS = [
  ["wasmBytes", "wasmModule"],
  ["wasmUrl", "wasmBytes"],
  ["wasmUrl", "wasmModule"],
] as const;

const COMPILE_HINT = "On a runtime that forbids code generation, pass a precompiled wasmModule.";

const realFetch = globalThis.fetch;
let fetchCount = 0;

function wasmFile(variant: CoreVariant): Buffer {
  const wasmPath = fileURLToPath(
    new URL(`../../wasm/${variant}/gwen_core_bg.wasm`, import.meta.url),
  );
  return readFileSync(wasmPath);
}

function variantBytes(variant: CoreVariant): Uint8Array<ArrayBuffer> {
  const file = wasmFile(variant);
  const bytes = new Uint8Array(new ArrayBuffer(file.byteLength));
  bytes.set(file);
  return bytes;
}

function dataUrl(variant: CoreVariant): string {
  return `data:application/wasm;base64,${wasmFile(variant).toString("base64")}`;
}

function lightJsUrl(): string {
  const jsPath = fileURLToPath(new URL("../../wasm/light/gwen_core_factory.js", import.meta.url));
  return pathToFileURL(jsPath).href;
}

function isGlueModule(value: unknown): value is GwenCoreGlueFactoryModule {
  if (typeof value !== "object" || value === null) return false;
  if (!("createGlue" in value) || typeof value.createGlue !== "function") return false;
  if (!("CONTRACT" in value) || typeof value.CONTRACT !== "object" || value.CONTRACT === null) {
    return false;
  }
  return "wasmUrl" in value && value.wasmUrl instanceof URL;
}

async function loadGlue(variant: CoreVariant): Promise<GwenCoreGlueFactoryModule> {
  const value: unknown =
    variant === "light"
      ? await import("@gwenjs/core/wasm/light/factory")
      : variant === "physics2d"
        ? await import("@gwenjs/core/wasm/physics2d/factory")
        : await import("@gwenjs/core/wasm/physics3d/factory");
  if (!isGlueModule(value)) {
    throw new Error("factory module is missing createGlue, CONTRACT, or wasmUrl");
  }
  return value;
}

function settled<T>(promise: Promise<T>): Promise<{ v: T } | { err: unknown }> {
  return promise.then(
    (v) => ({ v }),
    (err) => ({ err }),
  );
}

function asGwenError(error: unknown): GwenError {
  expect(error).toBeInstanceOf(GwenError);
  if (!(error instanceof GwenError)) throw new Error("expected GwenError");
  return error;
}

function expectSourceNames(error: GwenError): void {
  for (const name of SOURCE_NAMES) {
    expect(error.message).toContain(name);
  }
}

async function stopEngine(engine: GwenEngine | undefined): Promise<void> {
  await engine?.stop();
}

beforeAll(() => {
  expect([typeof window, typeof document, typeof location]).toEqual([
    "undefined",
    "undefined",
    "undefined",
  ]);
  expect(typeof globalThis.Worker).toBe("undefined");
});

beforeEach(() => {
  fetchCount = 0;
  globalThis.fetch = function countingFetch(): Promise<Response> {
    fetchCount += 1;
    throw new Error("fetch called");
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

async function bootTenTicks(
  variant: CoreVariant,
  source: { wasmBytes: Uint8Array<ArrayBuffer> } | { wasmModule: WebAssembly.Module },
): Promise<void> {
  const glue = await loadGlue(variant);
  let engine: GwenEngine | undefined;
  try {
    const booted = await settled(
      setupGwen({
        variant,
        glue,
        wasmInstance: "isolated",
        maxEntities: 256,
        ...source,
      }),
    );
    expect("v" in booted).toBe(true);
    if (!("v" in booted)) return;
    const running = booted.v;
    engine = running;
    let created = 0;
    await running.use({
      name: "tick-entities",
      setup() {
        running.hooks.hook("engine:tick", () => {
          running.createEntity();
          created += 1;
        });
      },
    });
    await running.startExternal();
    for (let step = 0; step < 10; step += 1) {
      await running.advance(1 / 60);
    }
    expect(running.frameCount).toBe(10);
    expect(created).toBe(10);
    const bridge = running.tryInject("wasm:bridge");
    expect(bridge).toBeDefined();
    if (bridge === undefined) return;
    expect(bridge.countEntities()).toBe(created);
  } finally {
    await stopEngine(engine);
  }
}

it.each(VARIANTS)(
  "%s boots from bytes with no DOM and advances ten ticks",
  async (variant) => {
    await bootTenTicks(variant, { wasmBytes: variantBytes(variant) });
  },
  60_000,
);

it.each(VARIANTS)(
  "%s boots from a compiled module with no DOM",
  async (variant) => {
    const wasmModule = await WebAssembly.compile(variantBytes(variant));
    await bootTenTicks(variant, { wasmModule });
  },
  60_000,
);

it("setupGwen with no source in Node rejects naming every accepted source", async () => {
  const rejected = await settled(setupGwen());
  if ("v" in rejected) {
    try {
      expect("err" in rejected).toBe(true);
    } finally {
      await stopEngine(rejected.v);
    }
    return;
  }
  const error = asGwenError(rejected.err);
  expect(error.code).toBe("CORE:WASM_LOAD_ERROR");
  expectSourceNames(error);
});

it("glue without a binary source in Node rejects with the missing-source error and never fetches", async () => {
  const glue = await loadGlue("light");
  let engine: GwenEngine | undefined;
  let bridge: WasmBridgeImpl | undefined;
  try {
    const rejected = await settled(setupGwen({ variant: "light", glue, maxEntities: 32 }));
    if ("v" in rejected) {
      engine = rejected.v;
      expect("err" in rejected).toBe(true);
      return;
    }
    expect(fetchCount).toBe(0);
    const error = asGwenError(rejected.err);
    expect(error.code).toBe("CORE:WASM_LOAD_ERROR");
    expectSourceNames(error);

    fetchCount = 0;
    bridge = new WasmBridgeImpl();
    const fetched = await settled(
      bridge.init("light", { glue, wasmUrl: "file:///nonexistent/gwen_core_bg.wasm" }),
    );
    expect("err" in fetched).toBe(true);
    if (!("err" in fetched)) return;
    expect(fetchCount).toBe(1);
    const fetchedError = asGwenError(fetched.err);
    expect(fetchedError.message).not.toContain("No WASM source");
  } finally {
    bridge?.dispose();
    await stopEngine(engine);
  }
});

function pairOptions(
  left: "wasmBytes" | "wasmUrl",
  right: "wasmBytes" | "wasmModule",
  glue: GwenCoreGlueFactoryModule,
  bytes: Uint8Array<ArrayBuffer>,
  wasmModule: WebAssembly.Module,
  wasmUrl: string,
): InitWasmOptions {
  if (left === "wasmBytes" && right === "wasmModule") {
    return { glue, wasmBytes: bytes, wasmModule, maxEntities: 32 };
  }
  if (left === "wasmUrl" && right === "wasmBytes") {
    return { glue, wasmUrl, wasmBytes: bytes, maxEntities: 32 };
  }
  if (left === "wasmUrl" && right === "wasmModule") {
    return { glue, wasmUrl, wasmModule, maxEntities: 32 };
  }
  throw new Error(`unexpected binary pair ${left} + ${right}`);
}

it.each(BINARY_PAIRS)(
  "two binary sources reject with CORE:WASM_LOAD_ERROR",
  async (left, right) => {
    const glue = await loadGlue("light");
    const bytes = variantBytes("light");
    const wasmModule = await WebAssembly.compile(bytes);
    const bridge = new WasmBridgeImpl();
    try {
      const rejected = await settled(
        bridge.init("light", pairOptions(left, right, glue, bytes, wasmModule, dataUrl("light"))),
      );
      expect(fetchCount).toBe(0);
      expect("err" in rejected).toBe(true);
      if (!("err" in rejected)) return;
      const error = asGwenError(rejected.err);
      expect(error.code).toBe("CORE:WASM_LOAD_ERROR");
      expect(error.message).toContain(left);
      expect(error.message).toContain(right);
    } finally {
      bridge.dispose();
    }
  },
  60_000,
);

it("bad bytes reject with CORE:WASM_LOAD_ERROR and the same bridge then initialises with good bytes", async () => {
  const bridge = new WasmBridgeImpl();
  const glue = await loadGlue("light");
  const badSets = [new Uint8Array([0, 97, 115, 109]), new Uint8Array()];
  try {
    for (const wasmBytes of badSets) {
      const rejected = await settled(bridge.init("light", { glue, wasmBytes, maxEntities: 32 }));
      expect("err" in rejected).toBe(true);
      if (!("err" in rejected)) return;
      const error = asGwenError(rejected.err);
      expect(error.code).toBe("CORE:WASM_LOAD_ERROR");
      expect(error.cause).toBeInstanceOf(WebAssembly.CompileError);
      expect(error.hint).toBe(__GWEN_DEV__ ? COMPILE_HINT : undefined);
    }
    const booted = await settled(
      bridge.init("light", { glue, wasmBytes: variantBytes("light"), maxEntities: 32 }),
    );
    expect("v" in booted).toBe(true);
    expect(bridge.isActive()).toBe(true);
  } finally {
    bridge.dispose();
  }
}, 60_000);

it("one Module serves two isolated engines with separate counts", async () => {
  const wasmModule = await WebAssembly.compile(variantBytes("light"));
  const glue = await loadGlue("light");
  let first: GwenEngine | undefined;
  let second: GwenEngine | undefined;
  try {
    const bootedA = await settled(
      setupGwen({
        variant: "light",
        glue,
        wasmModule,
        wasmInstance: "isolated",
        maxEntities: 64,
      }),
    );
    expect("v" in bootedA).toBe(true);
    if (!("v" in bootedA)) return;
    first = bootedA.v;
    for (let index = 0; index < 5; index += 1) first.createEntity();
    const bootedB = await settled(
      setupGwen({
        variant: "light",
        glue,
        wasmModule,
        wasmInstance: "isolated",
        maxEntities: 64,
      }),
    );
    expect("v" in bootedB).toBe(true);
    if (!("v" in bootedB)) return;
    second = bootedB.v;
    const bridgeA = first.tryInject("wasm:bridge");
    const bridgeB = second.tryInject("wasm:bridge");
    expect(bridgeA).toBeDefined();
    expect(bridgeB).toBeDefined();
    if (bridgeA === undefined || bridgeB === undefined) return;
    expect(bridgeA.countEntities()).toBe(5);
    expect(bridgeB.countEntities()).toBe(0);
    const memoryA = bridgeA.getLinearMemory();
    const memoryB = bridgeB.getLinearMemory();
    expect(memoryA).not.toBeNull();
    expect(memoryB).not.toBeNull();
    expect(memoryA).not.toBe(memoryB);
  } finally {
    await stopEngine(first);
    await stopEngine(second);
  }
}, 60_000);

it("two shared engines on one Module share one memory", async () => {
  const wasmModule = await WebAssembly.compile(variantBytes("light"));
  const glue = await loadGlue("light");
  let first: GwenEngine | undefined;
  let second: GwenEngine | undefined;
  try {
    const bootedA = await settled(
      setupGwen({ variant: "light", glue, wasmModule, wasmInstance: "shared", maxEntities: 64 }),
    );
    expect("v" in bootedA).toBe(true);
    if (!("v" in bootedA)) return;
    first = bootedA.v;
    const bootedB = await settled(
      setupGwen({ variant: "light", glue, wasmModule, wasmInstance: "shared", maxEntities: 64 }),
    );
    expect("v" in bootedB).toBe(true);
    if (!("v" in bootedB)) return;
    second = bootedB.v;
    const bridgeA = first.tryInject("wasm:bridge");
    const bridgeB = second.tryInject("wasm:bridge");
    expect(bridgeA).toBeDefined();
    expect(bridgeB).toBeDefined();
    if (bridgeA === undefined || bridgeB === undefined) return;
    const memoryA = bridgeA.getLinearMemory();
    const memoryB = bridgeB.getLinearMemory();
    expect(memoryA).not.toBeNull();
    expect(memoryB).not.toBeNull();
    expect(memoryA).toBe(memoryB);
  } finally {
    await stopEngine(first);
    await stopEngine(second);
  }
}, 60_000);

it("init with wasmBytes on an active bridge rejects with CORE:WASM_LOAD_ERROR", async () => {
  const bridge = new WasmBridgeImpl();
  try {
    const first = await settled(
      bridge.init("light", { jsUrl: lightJsUrl(), wasmUrl: dataUrl("light"), maxEntities: 32 }),
    );
    expect("v" in first).toBe(true);
    if (!("v" in first)) return;
    const second = await settled(bridge.init("light", { wasmBytes: variantBytes("light") }));
    expect("err" in second).toBe(true);
    if (!("err" in second)) return;
    const error = asGwenError(second.err);
    expect(error.code).toBe("CORE:WASM_LOAD_ERROR");
    expect(error.message).toContain("already initialised");

    const wasmModule = await WebAssembly.compile(variantBytes("light"));
    const withModule = await settled(bridge.init("light", { wasmModule }));
    expect("err" in withModule).toBe(true);
    if (!("err" in withModule)) return;
    const moduleError = asGwenError(withModule.err);
    expect(moduleError.code).toBe("CORE:WASM_LOAD_ERROR");
    expect(moduleError.message).toContain("already initialised");
  } finally {
    bridge.dispose();
  }
}, 60_000);

it("the light factory with the physics2d bytes rejects with CORE:WASM_GLUE_MISMATCH before any instance", async () => {
  const bridge = new WasmBridgeImpl();
  const glue = await loadGlue("light");
  try {
    const rejected = await settled(
      bridge.init("light", { glue, wasmBytes: variantBytes("physics2d"), maxEntities: 32 }),
    );
    expect("err" in rejected).toBe(true);
    if (!("err" in rejected)) return;
    const error = asGwenError(rejected.err);
    expect(error.code).toBe("CORE:WASM_GLUE_MISMATCH");
    expect(bridge.isActive()).toBe(false);
  } finally {
    bridge.dispose();
  }
}, 60_000);

it("the package exports resolve each variant binary", () => {
  const cwd = fileURLToPath(new URL("../..", import.meta.url));
  for (const variant of VARIANTS) {
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `console.log(import.meta.resolve("@gwenjs/core/wasm/${variant}.wasm"))`,
      ],
      { cwd, encoding: "utf8" },
    );
    expect(result.status).toBe(0);
    const stdout = result.stdout ?? "";
    expect(stdout.trim().endsWith(`/wasm/${variant}/gwen_core_bg.wasm`)).toBe(true);
  }
});

it("createEngine without _bridge boots from wasmBytes in Node", async () => {
  const bad = await settled(
    createEngine({
      variant: "light",
      wasmBytes: new Uint8Array([0, 97, 115, 109]),
      maxEntities: 32,
    }),
  );
  if ("v" in bad) {
    try {
      expect("err" in bad).toBe(true);
    } finally {
      await stopEngine(bad.v);
    }
    return;
  }
  const error = asGwenError(bad.err);
  expect(error.code).toBe("CORE:WASM_LOAD_ERROR");
  expect(error.cause).toBeInstanceOf(WebAssembly.CompileError);

  let engine: GwenEngine | undefined;
  try {
    const good = await settled(
      createEngine({ variant: "light", wasmBytes: variantBytes("light"), maxEntities: 32 }),
    );
    expect("v" in good).toBe(true);
    if (!("v" in good)) return;
    engine = good.v;
    expect(fetchCount).toBe(0);
    await engine.startExternal();
    await engine.advance(1 / 60);
    expect(engine.frameCount).toBe(1);
  } finally {
    await stopEngine(engine);
  }

  const glue = await loadGlue("light");
  const wasmModule = await WebAssembly.compile(variantBytes("light"));
  let fromModule: GwenEngine | undefined;
  try {
    fetchCount = 0;
    const booted = await settled(createEngine({ variant: "light", glue, wasmModule }));
    expect("v" in booted).toBe(true);
    if (!("v" in booted)) return;
    fromModule = booted.v;
    expect(fetchCount).toBe(0);
    await fromModule.startExternal();
    await fromModule.advance(1 / 60);
    expect(fromModule.frameCount).toBe(1);
  } finally {
    await stopEngine(fromModule);
  }
}, 60_000);
