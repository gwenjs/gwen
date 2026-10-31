/**
 * Caller-supplied glue factory (#266). Real WASM, Node.
 * `glue` is the module from `@gwenjs/core/wasm/<variant>/factory`.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

import { GwenError } from "@gwenjs/schema";
import * as light from "@gwenjs/core/wasm/light/factory";
import * as physics2d from "@gwenjs/core/wasm/physics2d/factory";
import * as physics3d from "@gwenjs/core/wasm/physics3d/factory";
import { beforeAll, expect, it } from "vitest";

import { createEngine } from "../../src/engine/engine-factory.js";
import type { GwenEngine } from "../../src/engine/engine-types.js";
import { WasmBridgeImpl } from "../../src/engine/wasm-bridge.js";
import type { CoreVariant, GwenCoreGlueFactoryModule } from "../../src/engine/wasm-bridge-types.js";
import { GwenWasmMismatchError } from "../../src/engine/wasm-contract.js";

const VARIANTS = ["light", "physics2d", "physics3d"] as const;
const realFetch = globalThis.fetch;

const GLUE = {
  light,
  physics2d,
  physics3d,
} as const;

// physics2d Engine.physics_get_sensor_state returns Uint32Array
// (packages/core/wasm/physics2d/gwen_core.d.ts:372) while WasmEngine declares
// Int32Array (packages/core/src/engine/wasm-bridge-types.ts:491).
function isGlueModule(value: unknown): value is GwenCoreGlueFactoryModule {
  if (typeof value !== "object" || value === null) return false;
  if (!("createGlue" in value) || typeof value.createGlue !== "function") return false;
  if (!("CONTRACT" in value) || typeof value.CONTRACT !== "object" || value.CONTRACT === null) {
    return false;
  }
  return "wasmUrl" in value && value.wasmUrl instanceof URL;
}

function openGlue(value: unknown): GwenCoreGlueFactoryModule {
  if (!isGlueModule(value)) {
    throw new Error("factory module is missing createGlue, CONTRACT, or wasmUrl");
  }
  return value;
}

function dataUrl(variant: CoreVariant): string {
  const wasmPath = fileURLToPath(
    new URL(`../../wasm/${variant}/gwen_core_bg.wasm`, import.meta.url),
  );
  const bytes = readFileSync(wasmPath);
  return `data:application/wasm;base64,${bytes.toString("base64")}`;
}

function lightJsUrl(): string {
  const jsPath = fileURLToPath(new URL("../../wasm/light/gwen_core_factory.js", import.meta.url));
  return pathToFileURL(jsPath).href;
}

function asGwenError(error: unknown): GwenError {
  expect(error).toBeInstanceOf(GwenError);
  if (!(error instanceof GwenError)) throw new Error("expected GwenError");
  return error;
}

function asMismatch(error: unknown): GwenWasmMismatchError {
  expect(error).toBeInstanceOf(GwenWasmMismatchError);
  if (!(error instanceof GwenWasmMismatchError)) throw new Error("expected GwenWasmMismatchError");
  return error;
}

async function settled(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
    return "ok";
  } catch (error: unknown) {
    return error;
  }
}

// JSON.parse is the only way to pass an ill-typed value without a cast, directive-free.
/** `JSON.parse` so the value is not annotated. A real factory has a function and a URL. */
function glueWithNullContract() {
  const glue = JSON.parse("{}");
  glue.createGlue = function createGlue(): undefined {
    return undefined;
  };
  glue.CONTRACT = null;
  glue.wasmUrl = new URL("https://example.invalid/gwen_core_bg.wasm");
  return glue;
}

function glueWithStringWasmUrl() {
  const glue = JSON.parse("{}");
  glue.createGlue = function createGlue(): undefined {
    return undefined;
  };
  glue.CONTRACT = { fingerprint: "gwen-core;variant=light;abi=2;profile=release" };
  glue.wasmUrl = "https://example.invalid/gwen_core_bg.wasm";
  return glue;
}

beforeAll(() => {
  expect(typeof location).toBe("undefined");
});

it.each(VARIANTS)(
  "%s init with glue and a data: wasmUrl boots and builds no glue URL",
  async (variant) => {
    const bridge = new WasmBridgeImpl();
    let engine: GwenEngine | undefined;
    try {
      globalThis.fetch = function fetchGlue(): Promise<Response> {
        throw new Error("glue init must not fetch");
      };
      const booted = await settled(() =>
        bridge.init(variant, {
          glue: openGlue(GLUE[variant]),
          wasmUrl: dataUrl(variant),
          maxEntities: 64,
        }),
      );
      expect(booted).toBe("ok");
      expect(bridge.isActive()).toBe(true);
      engine = await createEngine({ variant, _bridge: bridge });
      bridge.createEntity();
      expect(bridge.countEntities()).toBe(1);
    } finally {
      await engine?.stop();
      bridge.dispose();
      globalThis.fetch = realFetch;
    }
  },
  60_000,
);

it("without glue the same Node call rejects; with glue it resolves", async () => {
  const bridgeA = new WasmBridgeImpl();
  const bridgeB = new WasmBridgeImpl();
  let engine: GwenEngine | undefined;
  try {
    const rejected = asGwenError(
      await settled(() => bridgeA.init("light", { wasmUrl: dataUrl("light") })),
    );
    expect(rejected.code).toBe("CORE:WASM_LOAD_ERROR");
    expect(rejected.message).toContain(
      'No WASM source for variant "light": pass glue or jsUrl, and wasmBytes, wasmModule or wasmUrl.',
    );
    expect(bridgeA.isActive()).toBe(false);

    const booted = await settled(() =>
      bridgeB.init("light", { glue: openGlue(light), wasmUrl: dataUrl("light"), maxEntities: 64 }),
    );
    expect(booted).toBe("ok");
    expect(bridgeB.isActive()).toBe(true);
    engine = await createEngine({ variant: "light", _bridge: bridgeB });
  } finally {
    await engine?.stop();
    bridgeA.dispose();
    bridgeB.dispose();
    globalThis.fetch = realFetch;
  }
}, 60_000);

it("glue and jsUrl together reject with CORE:WASM_LOAD_ERROR and the bridge stays reusable", async () => {
  const bridge = new WasmBridgeImpl();
  let engine: GwenEngine | undefined;
  try {
    const rejected = asGwenError(
      await settled(() =>
        bridge.init("light", {
          glue: openGlue(light),
          jsUrl: lightJsUrl(),
          wasmUrl: dataUrl("light"),
        }),
      ),
    );
    expect(rejected.code).toBe("CORE:WASM_LOAD_ERROR");
    expect(rejected.message).toContain('glue and jsUrl were both passed for variant "light".');
    expect(bridge.isActive()).toBe(false);

    const booted = await settled(() =>
      bridge.init("light", { glue: openGlue(light), wasmUrl: dataUrl("light"), maxEntities: 64 }),
    );
    expect(booted).toBe("ok");
    expect(bridge.isActive()).toBe(true);
    engine = await createEngine({ variant: "light", _bridge: bridge });
  } finally {
    await engine?.stop();
    bridge.dispose();
    globalThis.fetch = realFetch;
  }
}, 60_000);

it("a light glue with the physics2d binary rejects with CORE:WASM_GLUE_MISMATCH before any instance", async () => {
  const bridge = new WasmBridgeImpl();
  try {
    const rejected = asMismatch(
      await settled(() =>
        bridge.init("light", {
          glue: openGlue(light),
          wasmUrl: dataUrl("physics2d"),
          maxEntities: 64,
        }),
      ),
    );
    expect(rejected.code).toBe("CORE:WASM_GLUE_MISMATCH");
    expect(rejected.reason).toBe("build");
    expect(bridge.isActive()).toBe(false);
  } finally {
    bridge.dispose();
    globalThis.fetch = realFetch;
  }
}, 60_000);

it('a physics2d glue with init("light") rejects with CORE:WASM_VARIANT_MISMATCH', async () => {
  const bridge = new WasmBridgeImpl();
  try {
    const rejected = asGwenError(
      await settled(() =>
        bridge.init("light", {
          glue: openGlue(physics2d),
          wasmUrl: dataUrl("light"),
          maxEntities: 64,
        }),
      ),
    );
    expect(rejected.code).toBe("CORE:WASM_VARIANT_MISMATCH");
    expect(rejected.message).toContain(
      'glue is for variant "physics2d" but init was called for "light".',
    );
    expect(bridge.isActive()).toBe(false);
  } finally {
    bridge.dispose();
    globalThis.fetch = realFetch;
  }
}, 60_000);

it("a glue that is not a factory module rejects with CORE:WASM_LOAD_ERROR", async () => {
  const bridge = new WasmBridgeImpl();
  try {
    const rejected = asGwenError(
      await settled(() => bridge.init("light", { glue: JSON.parse("{}") })),
    );
    expect(rejected.code).toBe("CORE:WASM_LOAD_ERROR");
    expect(rejected.message).toContain("glue is not a GWEN glue factory module.");
    expect(bridge.isActive()).toBe(false);
  } finally {
    bridge.dispose();
    globalThis.fetch = realFetch;
  }
});

it("init with glue on an active bridge rejects with CORE:WASM_LOAD_ERROR", async () => {
  const bridge = new WasmBridgeImpl();
  let engine: GwenEngine | undefined;
  try {
    const booted = await settled(() =>
      bridge.init("light", { glue: openGlue(light), wasmUrl: dataUrl("light"), maxEntities: 64 }),
    );
    expect(booted).toBe("ok");
    expect(bridge.isActive()).toBe(true);
    engine = await createEngine({ variant: "light", _bridge: bridge });

    const rejected = asGwenError(
      await settled(() => bridge.init("light", { glue: openGlue(light) })),
    );
    expect(rejected.code).toBe("CORE:WASM_LOAD_ERROR");
    expect(rejected.message).toContain("already initialised");
    bridge.createEntity();
    expect(bridge.countEntities()).toBe(1);
  } finally {
    await engine?.stop();
    bridge.dispose();
    globalThis.fetch = realFetch;
  }
}, 60_000);

it("a glue whose CONTRACT is null rejects with CORE:WASM_LOAD_ERROR", async () => {
  const bridge = new WasmBridgeImpl();
  try {
    const rejected = asGwenError(
      await settled(() => bridge.init("light", { glue: glueWithNullContract() })),
    );
    expect(rejected.code).toBe("CORE:WASM_LOAD_ERROR");
    expect(rejected.message).toContain("glue is not a GWEN glue factory module.");
    expect(bridge.isActive()).toBe(false);
  } finally {
    bridge.dispose();
    globalThis.fetch = realFetch;
  }
});

it("a glue whose wasmUrl is not a URL rejects with CORE:WASM_LOAD_ERROR", async () => {
  const bridge = new WasmBridgeImpl();
  try {
    const rejected = asGwenError(
      await settled(() => bridge.init("light", { glue: glueWithStringWasmUrl() })),
    );
    expect(rejected.code).toBe("CORE:WASM_LOAD_ERROR");
    expect(rejected.message).toContain("glue is not a GWEN glue factory module.");
    expect(bridge.isActive()).toBe(false);
  } finally {
    bridge.dispose();
    globalThis.fetch = realFetch;
  }
});

function fetchInputUrl(input: string | URL | Request): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

it("createEngine with glue in Node boots and adds no jsUrl", async () => {
  const calls = { count: 0 };
  const counted = {
    ...light,
    createGlue: () => {
      calls.count += 1;
      return light.createGlue();
    },
  };
  let engine: GwenEngine | undefined;
  let failure: unknown;
  try {
    engine = await createEngine({
      variant: "light",
      glue: openGlue(counted),
      wasmInstance: "isolated",
      maxEntities: 64,
    });
  } catch (error: unknown) {
    failure = error;
  }
  expect(failure).toBeUndefined();
  expect(calls.count).toBe(1);
  if (engine === undefined) return;
  try {
    engine.createEntity();
    expect(engine.getStats().entityCount).toBe(1);
  } finally {
    await engine.stop();
  }
}, 60_000);

it("init with glue and no wasmUrl reads the binary from the factory wasmUrl", async () => {
  const bridge = new WasmBridgeImpl();
  const seen: string[] = [];
  const factoryWasmUrl = new URL("https://wasm.example.test/light/gwen_core_bg.wasm");
  const glue = openGlue({ ...light, wasmUrl: factoryWasmUrl });
  try {
    globalThis.fetch = function fetchBinary(input: string | URL | Request): Promise<Response> {
      seen.push(fetchInputUrl(input));
      throw new Error("wasm fetch blocked");
    };
    const rejected = asGwenError(await settled(() => bridge.init("light", { glue })));
    expect(rejected.code).toBe("CORE:WASM_LOAD_ERROR");
    expect(rejected.message).toContain("wasm fetch blocked.");
    expect(seen).toEqual([factoryWasmUrl.href]);
  } finally {
    bridge.dispose();
    globalThis.fetch = realFetch;
  }
});

it("a glue whose fingerprint names no variant skips the variant check", async () => {
  const bridge = new WasmBridgeImpl();
  try {
    const glue = openGlue({
      ...light,
      CONTRACT: { ...light.CONTRACT, fingerprint: "gwen-core;abi=2" },
    });
    const rejected = asMismatch(
      await settled(() =>
        bridge.init("light", { glue, wasmUrl: dataUrl("light"), maxEntities: 64 }),
      ),
    );
    expect(rejected.code).toBe("CORE:WASM_GLUE_MISMATCH");
    expect(rejected.reason).toBe("fingerprint");
  } finally {
    bridge.dispose();
    globalThis.fetch = realFetch;
  }
}, 60_000);

it("a rejected glue init leaves the bridge variant untouched", async () => {
  const bridgeA = new WasmBridgeImpl();
  const bridgeB = new WasmBridgeImpl();
  try {
    const rejected = asGwenError(
      await settled(() =>
        bridgeA.init("physics2d", {
          glue: openGlue(physics2d),
          jsUrl: lightJsUrl(),
          wasmUrl: dataUrl("physics2d"),
        }),
      ),
    );
    expect(rejected.code).toBe("CORE:WASM_LOAD_ERROR");
    expect(bridgeA.variant).toBe("light");
    expect(bridgeA.hasPhysics()).toBe(false);

    const mismatch = asGwenError(
      await settled(() =>
        bridgeB.init("physics2d", {
          glue: openGlue(light),
          wasmUrl: dataUrl("physics2d"),
        }),
      ),
    );
    expect(mismatch.code).toBe("CORE:WASM_VARIANT_MISMATCH");
    expect(bridgeB.variant).toBe("light");
  } finally {
    bridgeA.dispose();
    bridgeB.dispose();
    globalThis.fetch = realFetch;
  }
});

it("a null glue rejects with CORE:WASM_LOAD_ERROR", async () => {
  const bridge = new WasmBridgeImpl();
  try {
    const rejected = asGwenError(
      await settled(() => bridge.init("light", { glue: JSON.parse("null") })),
    );
    expect(rejected.code).toBe("CORE:WASM_LOAD_ERROR");
    expect(rejected.message).toContain("glue is not a GWEN glue factory module.");
    expect(bridge.isActive()).toBe(false);
  } finally {
    bridge.dispose();
    globalThis.fetch = realFetch;
  }
});
