/**
 * `@gwenjs/core/node` (#267). Real WASM, no DOM.
 * The entry is imported inside the helper so a missing module fails an assertion.
 */

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

import { GwenError } from "@gwenjs/schema";
import { afterEach, beforeEach, expect, it } from "vitest";

import { GwenConfigError, setupGwen } from "@gwenjs/core";
import type { GwenEngine } from "../../src/engine/engine-types.js";
import { WasmBridgeImpl } from "../../src/engine/wasm-bridge.js";
import type { CoreVariant, GwenCoreGlueFactoryModule } from "../../src/engine/wasm-bridge-types.js";

const VARIANTS: readonly CoreVariant[] = ["light", "physics2d", "physics3d"];
const NODE_SOURCE = fileURLToPath(new URL("../../src/node.ts", import.meta.url));

const realFetch = globalThis.fetch;

function lightWasmBytes(): Uint8Array<ArrayBuffer> {
  const file = readFileSync(
    fileURLToPath(new URL("../../wasm/light/gwen_core_bg.wasm", import.meta.url)),
  );
  const bytes = new Uint8Array(new ArrayBuffer(file.byteLength));
  bytes.set(file);
  return bytes;
}

function lightFactoryHref(): string {
  return pathToFileURL(
    fileURLToPath(new URL("../../wasm/light/gwen_core_factory.js", import.meta.url)),
  ).href;
}

function lightDataUrl(): string {
  return `data:application/wasm;base64,${Buffer.from(lightWasmBytes()).toString("base64")}`;
}

function isGlueModule(value: unknown): value is GwenCoreGlueFactoryModule {
  if (typeof value !== "object" || value === null) return false;
  if (!("createGlue" in value) || typeof value.createGlue !== "function") return false;
  if (!("CONTRACT" in value) || typeof value.CONTRACT !== "object" || value.CONTRACT === null) {
    return false;
  }
  return "wasmUrl" in value && value.wasmUrl instanceof URL;
}

async function lightGlue(): Promise<GwenCoreGlueFactoryModule> {
  const value: unknown = await import("@gwenjs/core/wasm/light/factory");
  if (!isGlueModule(value)) {
    throw new Error("factory module is missing createGlue, CONTRACT, or wasmUrl");
  }
  return value;
}

async function nodeEntry(): Promise<typeof import("@gwenjs/core/node")> {
  // A string variable: Vite must not resolve this at transform time.
  // On the base the import rejects and expect.fail is the assertion.
  const specifier = `${"@gwenjs/core"}/node`;
  try {
    const loaded: typeof import("@gwenjs/core/node") = await import(specifier);
    return loaded;
  } catch (error: unknown) {
    expect.fail(`@gwenjs/core/node did not load: ${String(error)}`);
  }
}

function asGwenError(error: unknown): GwenError {
  expect(error).toBeInstanceOf(GwenError);
  if (!(error instanceof GwenError)) throw new Error("expected GwenError");
  return error;
}

beforeEach(() => {
  globalThis.fetch = function trappedFetch(): Promise<Response> {
    throw new Error("fetch called");
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

it.each(VARIANTS)(
  "%s createEngine from @gwenjs/core/node boots with no source options in isolated mode",
  async (variant) => {
    const { createEngine } = await nodeEntry();
    const engines: GwenEngine[] = [];
    try {
      const first = await createEngine({ variant });
      engines.push(first);
      expect(first.inject("wasm:bridge").isActive()).toBe(true);
      if (variant === "light") {
        const bare = await createEngine();
        engines.push(bare);
        expect(bare.inject("wasm:bridge").isActive()).toBe(true);
      }
      const second = await createEngine({ variant });
      engines.push(second);
      expect(second.inject("wasm:bridge").isActive()).toBe(true);
      const memoryA = first.inject("wasm:bridge").getLinearMemory();
      const memoryB = second.inject("wasm:bridge").getLinearMemory();
      expect(memoryA).toBeInstanceOf(WebAssembly.Memory);
      expect(memoryB).toBeInstanceOf(WebAssembly.Memory);
      expect(memoryA).not.toBe(memoryB);
    } finally {
      for (const engine of engines) await engine.stop();
    }
  },
);

it('two loadGwenModule("light") calls return the same Module object', async () => {
  const { loadGwenModule } = await nodeEntry();
  const first = await loadGwenModule("light");
  const second = await loadGwenModule("light");
  expect(second).toBe(first);
});

it("a missing artefact rejects with CORE:WASM_LOAD_ERROR naming the paths tried and is not cached", async () => {
  const { loadGwenModule } = await nodeEntry();
  const variant = "missing" as CoreVariant;
  let first: unknown;
  try {
    await loadGwenModule(variant);
    first = undefined;
  } catch (error: unknown) {
    first = error;
  }
  const error = asGwenError(first);
  expect(error.code).toBe("CORE:WASM_LOAD_ERROR");
  expect(error.message).toContain("gwen_core_bg.wasm");
  expect(error.message.match(/\/wasm\/missing/g)).toHaveLength(3);

  let second: unknown;
  try {
    await loadGwenModule(variant);
    second = undefined;
  } catch (error: unknown) {
    second = error;
  }
  expect(second).not.toBe(first);
});

it("caller sources win over the node defaults", async () => {
  const { createEngine } = await nodeEntry();
  const glue = await lightGlue();
  const engines: GwenEngine[] = [];
  try {
    const fromBytes = await createEngine({ variant: "light", wasmBytes: lightWasmBytes() });
    engines.push(fromBytes);
    expect(fromBytes.inject("wasm:bridge").isActive()).toBe(true);
    const fromGlue = await createEngine({ variant: "light", glue });
    engines.push(fromGlue);
    expect(fromGlue.inject("wasm:bridge").isActive()).toBe(true);
    const fromJsUrl = await createEngine({ variant: "light", jsUrl: lightFactoryHref() });
    engines.push(fromJsUrl);
    expect(fromJsUrl.inject("wasm:bridge").isActive()).toBe(true);
    const fromWasmUrl = await createEngine({ variant: "light", wasmUrl: lightDataUrl() });
    engines.push(fromWasmUrl);
    expect(fromWasmUrl.inject("wasm:bridge").isActive()).toBe(true);
  } finally {
    for (const engine of engines) await engine.stop();
  }
});

it("a caller _bridge is used as is and not rebuilt by the node entry", async () => {
  const { createEngine } = await nodeEntry();
  const bridge = new WasmBridgeImpl();
  let engine: GwenEngine | undefined;
  try {
    await bridge.init("light", { glue: await lightGlue(), wasmBytes: lightWasmBytes() });
    engine = await createEngine({ _bridge: bridge });
    expect(engine.inject("wasm:bridge")).toBe(bridge);
  } finally {
    await engine?.stop();
    bridge.dispose();
  }
});

it("createEngine from the node entry keeps GwenConfigError for an invalid maxEntities", async () => {
  const { createEngine } = await nodeEntry();
  let engine: GwenEngine | undefined;
  const pending = createEngine({ maxEntities: -1 }).then((created) => {
    engine = created;
    return created;
  });
  try {
    await expect(pending).rejects.toThrow(GwenConfigError);
  } finally {
    await engine?.stop();
  }
});

it("setupGwen from @gwenjs/core in Node with no source names @gwenjs/core/node", async () => {
  let engine: GwenEngine | undefined;
  const pending = setupGwen().then((created) => {
    engine = created;
    return created;
  });
  try {
    await expect(pending).rejects.toMatchObject({ code: "CORE:WASM_LOAD_ERROR" });
    await expect(pending).rejects.toThrow(/@gwenjs\/core\/node/);
  } finally {
    await engine?.stop();
  }
});

it("the node entry reads no process.versions", () => {
  expect(existsSync(NODE_SOURCE), "packages/core/src/node.ts").toBe(true);
  if (!existsSync(NODE_SOURCE)) return;
  expect(readFileSync(NODE_SOURCE, "utf8")).not.toContain("process.versions");
});
