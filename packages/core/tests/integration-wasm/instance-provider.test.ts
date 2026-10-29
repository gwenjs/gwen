/**
 * Shared glue instance (P-263-1b). Real WASM.
 * One Module, one memory. Each engine keeps its own `Engine`.
 */

import { createServer, type Server } from "node:http";
import { once } from "node:events";
import {
  createReadStream,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { GwenError } from "@gwenjs/schema";
import { describe, expect, it } from "vitest";

import { CoreErrorCodes, GwenWasmPanicError } from "../../src/engine/engine-errors.js";
import { createEngine } from "../../src/engine/engine-factory.js";
import type { GwenEngine } from "../../src/engine/engine-types.js";
import { entityGeneration, entityIndex } from "../../src/types/entity.js";
import { WasmBridgeImpl } from "../../src/engine/wasm-bridge.js";
import type { CoreVariant } from "../../src/engine/wasm-bridge-types.js";
import { invalidateWasmModule } from "../../src/engine/wasm-module-cache.js";
import "../../../physics2d/src/augment";
import { Physics2DPlugin } from "../../../physics2d/src/plugin/index";
import "../../../physics3d/src/augment";
import { Physics3DPlugin } from "../../../physics3d/src/plugin/index";

const VARIANTS = ["light", "physics2d", "physics3d"] as const;

/**
 * Recorded from one run of this test on the unchanged bridge.
 * Command is in the round report.
 */
const PHYSICS2D_HASH_A = 1648044585;
const PHYSICS2D_HASH_B = 1648044585;
/**
 * Shared-mode run of `buildScene3d`, 60 steps at `physicsHz: 60`.
 * Command: pnpm --filter @gwenjs/core exec vitest run --config vitest.wasm.config.ts --project dev tests/integration-wasm/probe-263.test.ts
 * Received `hash3`: 2972392379. The probe file was removed after the run.
 */
const PHYSICS3D_HASH_A = 2972392379;

const CORRUPT_WASM_URL = "data:application/wasm;base64,AAAA";

const SOURCES = ["wasm-bridge.ts", "wasm-instance-provider.ts", "wasm-module-cache.ts"] as const;

function artifact(variant: CoreVariant, fileName: string): string {
  return fileURLToPath(new URL(`../../wasm/${variant}/${fileName}`, import.meta.url));
}

function factoryUrl(variant: CoreVariant): string {
  return pathToFileURL(artifact(variant, "gwen_core_factory.js")).href;
}

function dataWasmUrl(variant: CoreVariant, tag?: string): string {
  const bytes = readFileSync(artifact(variant, "gwen_core_bg.wasm"));
  const marker = tag === undefined ? "" : `;${tag}`;
  return `data:application/wasm${marker};base64,${bytes.toString("base64")}`;
}

function bridgeOf(engine: GwenEngine): WasmBridgeImpl {
  return engine.inject("wasm:bridge");
}

function glueKeys(): string[] {
  return Object.keys(globalThis).filter((key) => key.startsWith("__gwenGlue_"));
}

function fnv1a(values: readonly number[]): number {
  let hash = 0x811c9dc5;
  for (const value of values) {
    const buffer = new ArrayBuffer(8);
    new DataView(buffer).setFloat64(0, value, true);
    const bytes = new Uint8Array(buffer);
    for (const byte of bytes) {
      hash ^= byte;
      hash = Math.imul(hash, 0x01000193);
    }
  }
  return hash >>> 0;
}

async function stopAll(engines: readonly GwenEngine[]): Promise<void> {
  for (const engine of engines) {
    await engine.stop();
  }
}

function fingerprintOf(loaded: unknown): string {
  if (typeof loaded !== "object" || loaded === null || !("CONTRACT" in loaded)) {
    throw new Error("loaded factory has no CONTRACT");
  }
  const contract = loaded.CONTRACT;
  if (typeof contract !== "object" || contract === null || !("fingerprint" in contract)) {
    throw new Error("loaded CONTRACT has no fingerprint");
  }
  const fingerprint = contract.fingerprint;
  if (typeof fingerprint !== "string") throw new Error("fingerprint is not a string");
  return fingerprint;
}

describe("shared wasm instance", () => {
  it.each(VARIANTS)(
    "shared: two engines of one variant share one memory and no globalThis glue key exists (%s)",
    async (variant) => {
      const engines: GwenEngine[] = [];
      try {
        const engineA = await createEngine({ variant, maxEntities: 32 });
        const engineB = await createEngine({ variant, maxEntities: 32 });
        engines.push(engineA, engineB);
        const bridgeA = bridgeOf(engineA);
        const bridgeB = bridgeOf(engineB);
        for (let n = 0; n < 10; n += 1) engineA.createEntity();

        expect(glueKeys()).toEqual([]);
        expect(bridgeA.getLinearMemory()).toBe(bridgeB.getLinearMemory());
        expect(engineA.getStats().entityCount).toBe(10);
        expect(engineB.getStats().entityCount).toBe(0);
        expect(bridgeA.countEntities()).toBe(10);
        expect(bridgeB.countEntities()).toBe(0);
      } finally {
        await stopAll(engines);
      }
    },
    60_000,
  );

  it("shared: results are unchanged from today", async () => {
    const engines: GwenEngine[] = [];
    try {
      const engineA = await createEngine({
        variant: "physics2d",
        maxEntities: 32,
        physicsHz: 60,
      });
      engines.push(engineA);
      const idsA = await buildScene(engineA);
      const engineB = await createEngine({
        variant: "physics2d",
        maxEntities: 32,
        physicsHz: 60,
      });
      engines.push(engineB);
      const idsB = await buildScene(engineB);
      await engineA.startExternal();
      await engineB.startExternal();
      for (let step = 0; step < 60; step += 1) {
        await engineA.advance(1 / 60);
        await engineB.advance(1 / 60);
      }
      expect(positionHash(engineA, idsA)).toBe(PHYSICS2D_HASH_A);
      expect(positionHash(engineB, idsB)).toBe(PHYSICS2D_HASH_B);
      expect(memoryPositionHash(engineA, idsA)).toBe(PHYSICS2D_HASH_A);
      expect(memoryPositionHash(engineB, idsB)).toBe(PHYSICS2D_HASH_B);
    } finally {
      await stopAll(engines);
    }
  }, 60_000);

  it("init() with a source on an initialised bridge rejects CORE:WASM_LOAD_ERROR; without a source it returns the existing init", async () => {
    const engines: GwenEngine[] = [];
    const pending: WasmBridgeImpl[] = [];
    try {
      const engine = await createEngine({ variant: "light", maxEntities: 32 });
      engines.push(engine);
      const bridge = bridgeOf(engine);
      const memory = bridge.getLinearMemory();
      let rejected: unknown = "resolved";
      try {
        await bridge.init("light", { jsUrl: factoryUrl("light") });
      } catch (error: unknown) {
        rejected = error;
      }
      expect(rejected).toBeInstanceOf(GwenError);
      if (!(rejected instanceof GwenError)) return;
      expect(rejected.code).toBe(CoreErrorCodes.WASM_LOAD_ERROR);
      expect(rejected.message).toContain("The bridge is already initialised; create a new engine.");

      await bridge.init("light");
      expect(bridge.isActive()).toBe(true);
      expect(bridge.getLinearMemory()).toBe(memory);

      const starting = new WasmBridgeImpl();
      pending.push(starting);
      const first = starting.init("light", {
        jsUrl: factoryUrl("light"),
        wasmUrl: dataWasmUrl("light"),
      });
      const second = starting.init("light", { jsUrl: factoryUrl("light") });
      const secondResult = await second.then(
        () => "resolved",
        (error: unknown) => error,
      );
      const firstResult = await first.then(
        () => "ok",
        (error: unknown) => error,
      );
      expect(secondResult).toBeInstanceOf(GwenError);
      if (!(secondResult instanceof GwenError)) return;
      expect(secondResult.code).toBe(CoreErrorCodes.WASM_LOAD_ERROR);
      expect(secondResult.message).toContain(
        "The bridge is already initialised; create a new engine.",
      );
      expect(firstResult).toBe("ok");
      expect(starting.isActive()).toBe(true);
    } finally {
      for (const bridge of pending) bridge.dispose();
      await stopAll(engines);
    }
  }, 60_000);

  it("a failed first init can retry", async () => {
    const bridge = new WasmBridgeImpl();
    try {
      let first: unknown = "ok";
      try {
        await bridge.init("light", { jsUrl: factoryUrl("light"), wasmUrl: CORRUPT_WASM_URL });
      } catch (error: unknown) {
        first = error;
      }
      expect(first).toBeInstanceOf(GwenError);
      if (!(first instanceof GwenError)) return;
      expect(first.code).toBe(CoreErrorCodes.WASM_LOAD_ERROR);
      expect(first.message).toContain("did not compile");

      let again: unknown = "ok";
      try {
        await bridge.init("light", { jsUrl: factoryUrl("light"), wasmUrl: CORRUPT_WASM_URL });
      } catch (error: unknown) {
        again = error;
      }
      expect(again).toBeInstanceOf(GwenError);
      if (!(again instanceof GwenError)) return;
      expect(again.code).toBe(CoreErrorCodes.WASM_LOAD_ERROR);
      expect(again.message).toContain("did not compile");
      expect(bridge.isActive()).toBe(false);

      let retried: unknown = "ok";
      try {
        await bridge.init("light", { jsUrl: factoryUrl("light"), wasmUrl: dataWasmUrl("light") });
      } catch (error: unknown) {
        retried = error;
      }
      expect(retried).toBe("ok");
      expect(bridge.isActive()).toBe(true);
    } finally {
      bridge.dispose();
    }
  }, 60_000);

  it("a failed instantiation can retry on the same bridge", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "gwen-instantiate-"));
    const bridge = new WasmBridgeImpl();
    const jsPath = path.join(dir, "glue.mjs");
    const wasmUrl = dataWasmUrl("light", "instantiate-retry");
    writeFileSync(jsPath, flakyInstantiateFactory(factoryUrl("light")), "utf8");
    const jsUrl = pathToFileURL(jsPath).href;
    try {
      let first: unknown = "resolved";
      try {
        await bridge.init("light", { jsUrl, wasmUrl });
      } catch (error: unknown) {
        first = error;
      }
      expect(first).toBeInstanceOf(GwenError);
      if (!(first instanceof GwenError)) return;
      expect(first.code).toBe(CoreErrorCodes.WASM_LOAD_ERROR);
      expect(bridge.isActive()).toBe(false);

      let retried: unknown = "ok";
      try {
        await bridge.init("light", { jsUrl, wasmUrl });
      } catch (error: unknown) {
        retried = error;
      }
      expect(retried).toBe("ok");
      expect(bridge.isActive()).toBe(true);
    } finally {
      bridge.dispose();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("dispose during an in-flight init rejects CORE:ENGINE_DISPOSED and leaves no shared ref", async () => {
    const wasmUrl = dataWasmUrl("light", "dispose-during-init");
    const jsUrl = factoryUrl("light");
    const first = new WasmBridgeImpl();
    const second = new WasmBridgeImpl();
    const third = new WasmBridgeImpl();
    try {
      const pending = first.init("light", { jsUrl, wasmUrl });
      first.dispose();
      let rejected: unknown = "resolved";
      try {
        await pending;
      } catch (error: unknown) {
        rejected = error;
      }
      const code = rejected instanceof GwenError ? rejected.code : rejected;
      expect(code).toBe(CoreErrorCodes.ENGINE_DISPOSED);
      expect(first.isActive()).toBe(false);

      await second.init("light", { jsUrl, wasmUrl });
      const secondMemory = second.getLinearMemory();
      second.dispose();
      await third.init("light", { jsUrl, wasmUrl });
      expect(third.getLinearMemory()).not.toBe(secondMemory);
    } finally {
      first.dispose();
      second.dispose();
      third.dispose();
    }
  }, 60_000);

  it("jsUrl pointing at the raw glue rejects with CORE:WASM_LOAD_ERROR", async () => {
    const bridge = new WasmBridgeImpl();
    const jsUrl = pathToFileURL(artifact("light", "gwen_core.js")).href;
    try {
      let caught: unknown = "resolved";
      try {
        await bridge.init("light", { jsUrl });
      } catch (error: unknown) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(GwenError);
      if (!(caught instanceof GwenError)) return;
      expect(caught.code).toBe(CoreErrorCodes.WASM_LOAD_ERROR);
      expect(caught.message.split("\n")[0]).toBe(
        `[initWasm()] jsUrl must point at gwen_core_factory.js, got ${jsUrl}.`,
      );
    } finally {
      bridge.dispose();
    }
  }, 60_000);

  it("two engines on one URL get a new memory after invalidateWasmModule", async () => {
    const engines: GwenEngine[] = [];
    const wasmUrl = dataWasmUrl("light");
    try {
      const engineA = await createEngine({ variant: "light", maxEntities: 32 });
      const engineB = await createEngine({ variant: "light", maxEntities: 32 });
      engines.push(engineA, engineB);
      const memory = bridgeOf(engineA).getLinearMemory();
      expect(memory).not.toBeNull();
      expect(bridgeOf(engineB).getLinearMemory()).toBe(memory);

      expect(invalidateWasmModule(wasmUrl)).toBe(true);
      const engineC = await createEngine({ variant: "light", maxEntities: 32 });
      engines.push(engineC);
      expect(bridgeOf(engineC).getLinearMemory()).not.toBe(memory);
      expect(bridgeOf(engineA).getLinearMemory()).toBe(memory);
    } finally {
      await stopAll(engines);
    }
  }, 60_000);

  it("light init fetches only light URLs", async () => {
    const root = fileURLToPath(new URL("../../wasm/", import.meta.url));
    const paths: string[] = [];
    const server = createServer((request, response) => {
      const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
      paths.push(pathname);
      const relative = pathname.replace(/^\/+/, "");
      const file = path.resolve(root, relative);
      const fromRoot = path.relative(root, file);
      if (fromRoot.startsWith("..") || path.isAbsolute(fromRoot) || !existsSync(file)) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, { "content-type": "application/octet-stream" });
      createReadStream(file).pipe(response);
    });
    const bridge = new WasmBridgeImpl();
    try {
      await listen(server);
      const address = server.address();
      if (address === null || typeof address === "string") {
        throw new Error("test server has no port");
      }
      const jsUrl = factoryUrl("light");
      const wasmUrl = `http://127.0.0.1:${address.port}/light/gwen_core_bg.wasm`;
      let caught: unknown = "resolved";
      try {
        await bridge.init("light", { jsUrl, wasmUrl });
      } catch (error: unknown) {
        caught = error;
      }
      expect(paths).toEqual(["/light/gwen_core_bg.wasm"]);
      expect(caught).toBe("resolved");
      expect(bridge.isActive()).toBe(true);
      const loaded: unknown = await import(jsUrl);
      expect(fingerprintOf(loaded)).toContain("variant=light");
    } finally {
      bridge.dispose();
      await closeServer(server);
    }
  }, 60_000);

  it("a glue/binary mismatch rejects with CORE:WASM_GLUE_MISMATCH before any instance", async () => {
    const originalInstantiate = WebAssembly.instantiate;
    const OriginalInstance = WebAssembly.Instance;
    let instantiateCalls = 0;
    let instanceCalls = 0;
    WebAssembly.instantiate = new Proxy(originalInstantiate, {
      apply(target, thisArg, argArray) {
        instantiateCalls += 1;
        return Reflect.apply(target, thisArg, argArray);
      },
    });
    class CountingInstance extends OriginalInstance {
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
    const bridge = new WasmBridgeImpl();
    try {
      let caught: unknown = "resolved";
      try {
        await bridge.init("light", {
          jsUrl: factoryUrl("light"),
          wasmUrl: dataWasmUrl("physics2d"),
        });
      } catch (error: unknown) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(GwenError);
      if (!(caught instanceof GwenError)) return;
      expect(caught.code).toBe(CoreErrorCodes.WASM_GLUE_MISMATCH);
      expect(instanceCalls).toBe(0);
      expect(instantiateCalls).toBe(0);
      expect(bridge.isActive()).toBe(false);
    } finally {
      WebAssembly.instantiate = originalInstantiate;
      WebAssembly.Instance = OriginalInstance;
      bridge.dispose();
    }
  }, 60_000);

  it("no process.versions read in the bridge, the provider and the module cache", () => {
    const source = SOURCES.map((name) =>
      readFileSync(fileURLToPath(new URL(`../../src/engine/${name}`, import.meta.url)), "utf8"),
    ).join("\n");
    expect(source).toContain("getWasmModule");
    expect(source).not.toContain("process.versions");
  });
});

async function buildScene(engine: GwenEngine): Promise<ReturnType<GwenEngine["createEntity"]>[]> {
  await engine.use(Physics2DPlugin({ gravity: -10, maxEntities: 32 }));
  const api = engine.inject("physics2d");
  const floor = engine.createEntity();
  api.addBoxCollider(api.addRigidBody(floor, "fixed", 0, 0), 5, 0.25);
  const spots = [
    { x: 0, y: 4 },
    { x: 1.25, y: 7.5 },
    { x: -0.5, y: 2.25 },
  ] as const;
  return spots.map((spot) => {
    const id = engine.createEntity();
    api.addBoxCollider(api.addRigidBody(id, "dynamic", spot.x, spot.y), 0.3, 0.3);
    return id;
  });
}

function positionHash(
  engine: GwenEngine,
  ids: readonly ReturnType<GwenEngine["createEntity"]>[],
): number {
  const api = engine.inject("physics2d");
  const values: number[] = [];
  for (const id of ids) {
    const position = api.getPosition(id);
    if (position === null) throw new Error("missing physics2d position");
    values.push(position.x, position.y, position.rotation);
  }
  return fnv1a(values);
}

const POSITION_LANES = new Uint8Array([0, 0, 0]);
const POSITION_STRIDE = 7;

/**
 * Copies each body pose into three f32 columns, then hashes the columns
 * read through `bridge.getLinearMemory()`. A miss hashes one NaN.
 */
function memoryPositionHash(
  engine: GwenEngine,
  ids: readonly ReturnType<GwenEngine["createEntity"]>[],
): number {
  const bridge = bridgeOf(engine);
  const memory = bridge.getLinearMemory();
  if (!(memory instanceof WebAssembly.Memory)) throw new Error("no linear memory");
  const api = engine.inject("physics2d");
  const typeId = bridge.registerComponent(POSITION_LANES);
  const bytes = new Uint8Array(12);
  const packed = new DataView(bytes.buffer);
  for (const id of ids) {
    const position = api.getPosition(id);
    if (position === null) throw new Error("missing physics2d position");
    packed.setFloat32(0, position.x, true);
    packed.setFloat32(4, position.y, true);
    packed.setFloat32(8, position.rotation, true);
    const stored = bridge.addComponent(entityIndex(id), entityGeneration(id), typeId, bytes);
    if (!stored) throw new Error("position column was not stored");
  }
  const query = bridge.registerQuery(new Uint32Array([typeId]));
  const ptr = bridge.queryChunks(query);
  const values = columnFloats(memory.buffer, ptr, ids);
  if (values === null) return fnv1a([Number.NaN]);
  return fnv1a(values);
}

function columnFloats(
  buffer: ArrayBuffer,
  ptr: number,
  ids: readonly ReturnType<GwenEngine["createEntity"]>[],
): number[] | null {
  const words = 4 + POSITION_STRIDE;
  if (ptr <= 0 || ptr % 4 !== 0 || ptr + words * 4 > buffer.byteLength) return null;
  const table = new Uint32Array(buffer, ptr, words);
  const chunkCount = table[0] ?? 0;
  const stride = table[2] ?? 0;
  const count = table[5] ?? 0;
  if (chunkCount !== 1 || stride !== POSITION_STRIDE || count !== ids.length) return null;
  const indexPtr = table[6] ?? 0;
  const xPtr = table[8] ?? 0;
  const yPtr = table[9] ?? 0;
  const rotationPtr = table[10] ?? 0;
  const indexes = alignedU32(buffer, indexPtr, count);
  const xs = alignedF32(buffer, xPtr, count);
  const ys = alignedF32(buffer, yPtr, count);
  const rotations = alignedF32(buffer, rotationPtr, count);
  if (indexes === null || xs === null || ys === null || rotations === null) return null;
  const found = new Map<number, readonly [number, number, number]>();
  for (let row = 0; row < count; row += 1) {
    found.set(indexes[row] ?? 0, [xs[row] ?? 0, ys[row] ?? 0, rotations[row] ?? 0]);
  }
  const values: number[] = [];
  for (const id of ids) {
    const row = found.get(entityIndex(id));
    if (row === undefined) return null;
    values.push(row[0], row[1], row[2]);
  }
  return values;
}

function alignedU32(buffer: ArrayBuffer, ptr: number, count: number): Uint32Array | null {
  if (ptr <= 0 || ptr % 4 !== 0 || ptr + count * 4 > buffer.byteLength) return null;
  return new Uint32Array(buffer, ptr, count);
}

function alignedF32(buffer: ArrayBuffer, ptr: number, count: number): Float32Array | null {
  if (ptr <= 0 || ptr % 4 !== 0 || ptr + count * 4 > buffer.byteLength) return null;
  return new Float32Array(buffer, ptr, count);
}

function listen(server: Server): Promise<void> {
  server.listen(0, "127.0.0.1");
  return once(server, "listening").then(() => undefined);
}

function closeServer(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

/** `initSync` throws once, then delegates to the real light factory. */
function flakyInstantiateFactory(realJsUrl: string): string {
  return [
    `import * as real from ${JSON.stringify(realJsUrl)};`,
    "export const CONTRACT = real.CONTRACT;",
    "export const wasmUrl = real.wasmUrl;",
    "let calls = 0;",
    "export function createGlue() {",
    "  const glue = real.createGlue();",
    "  return {",
    "    initSync(input) {",
    "      calls += 1;",
    "      if (calls === 1) throw new Error('instantiation failed');",
    "      return glue.initSync(input);",
    "    },",
    "    Engine: glue.Engine,",
    "  };",
    "}",
    "",
  ].join("\n");
}

function memoryOf(engine: GwenEngine): WebAssembly.Memory {
  const memory = bridgeOf(engine).getLinearMemory();
  if (!(memory instanceof WebAssembly.Memory)) throw new Error("no linear memory");
  return memory;
}

async function openTwo(
  into: GwenEngine[],
  variant: CoreVariant,
  mode: "isolated" | "shared",
  physicsHz?: number,
): Promise<readonly [GwenEngine, GwenEngine]> {
  const timing = physicsHz === undefined ? {} : { physicsHz };
  const engineA = await createEngine({ variant, wasmInstance: mode, maxEntities: 32, ...timing });
  const engineB = await createEngine({ variant, wasmInstance: mode, maxEntities: 32, ...timing });
  into.push(engineA, engineB);
  return [engineA, engineB];
}

async function openOne(
  into: GwenEngine[],
  variant: CoreVariant,
  mode: "isolated" | "shared",
): Promise<GwenEngine> {
  const engine = await createEngine({
    variant,
    wasmInstance: mode,
    maxEntities: 32,
    physicsHz: 60,
  });
  into.push(engine);
  return engine;
}

const BOX3D = { shape: { type: "box" as const, halfX: 0.3, halfY: 0.3, halfZ: 0.3 } };

async function buildScene3d(engine: GwenEngine): Promise<ReturnType<GwenEngine["createEntity"]>[]> {
  await engine.use(Physics3DPlugin({ gravity: { x: 0, y: -10, z: 0 }, maxEntities: 32 }));
  const api = engine.inject("physics3d");
  const floor = engine.createEntity();
  api.createBody(floor, {
    kind: "fixed",
    initialPosition: { x: 0, y: 0, z: 0 },
    colliders: [{ shape: { type: "box" as const, halfX: 5, halfY: 0.25, halfZ: 5 } }],
  });
  const spots = [
    { x: 0, y: 4, z: 0 },
    { x: 1.25, y: 7.5, z: 0.4 },
    { x: -0.5, y: 2.25, z: -0.2 },
  ] as const;
  return spots.map((spot) => {
    const id = engine.createEntity();
    api.createBody(id, { kind: "dynamic", initialPosition: spot, colliders: [BOX3D] });
    return id;
  });
}

function positionHash3d(
  engine: GwenEngine,
  ids: readonly ReturnType<GwenEngine["createEntity"]>[],
): number {
  const api = engine.inject("physics3d");
  const values: number[] = [];
  for (const id of ids) {
    const state = api.getBodyState(id);
    if (state === undefined) throw new Error("missing physics3d body");
    values.push(
      state.position.x,
      state.position.y,
      state.position.z,
      state.rotation.x,
      state.rotation.y,
      state.rotation.z,
      state.rotation.w,
    );
  }
  return fnv1a(values);
}

async function sceneHash(engine: GwenEngine, variant: "physics2d" | "physics3d"): Promise<number> {
  const ids = variant === "physics2d" ? await buildScene(engine) : await buildScene3d(engine);
  await engine.startExternal();
  for (let step = 0; step < 60; step += 1) await engine.advance(1 / 60);
  return variant === "physics2d" ? positionHash(engine, ids) : positionHash3d(engine, ids);
}

describe("isolated wasm instance", () => {
  it.each(VARIANTS)(
    "isolated: two engines have different memory objects (%s)",
    async (variant) => {
      const engines: GwenEngine[] = [];
      try {
        const [engineA, engineB] = await openTwo(engines, variant, "isolated");
        expect(memoryOf(engineA)).not.toBe(memoryOf(engineB));
      } finally {
        await stopAll(engines);
      }
    },
    60_000,
  );

  it.each(VARIANTS)(
    "isolated: memory.grow in A leaves B's size and data unchanged (%s)",
    async (variant) => {
      const engines: GwenEngine[] = [];
      try {
        const [engineA, engineB] = await openTwo(engines, variant, "isolated");
        for (let n = 0; n < 3; n += 1) engineA.createEntity();
        for (let n = 0; n < 10; n += 1) engineB.createEntity();
        const memA = memoryOf(engineA);
        const memB = memoryOf(engineB);
        const beforeA = memA.buffer.byteLength;
        const beforeB = memB.buffer.byteLength;
        memA.grow(1);
        expect(memA.buffer.byteLength).toBeGreaterThan(beforeA);
        expect(memB.buffer.byteLength).toBe(beforeB);
        expect(engineA.getStats().entityCount).toBe(3);
        expect(engineB.getStats().entityCount).toBe(10);
      } finally {
        await stopAll(engines);
      }
    },
    60_000,
  );

  it("isolated: a trap in A faults A only and B keeps advancing", async () => {
    const engines: GwenEngine[] = [];
    try {
      const [engineA, engineB] = await openTwo(engines, "physics2d", "isolated", 60);
      await buildScene(engineA);
      const idsB = await buildScene(engineB);
      await engineA.startExternal();
      await engineB.startExternal();
      const panics: unknown[] = [];
      engineA.errors.on((event) => {
        if (event.code === CoreErrorCodes.WASM_PANIC) panics.push(event.error);
      });
      new Uint8Array(memoryOf(engineA).buffer).fill(0xff);
      let rejection: unknown;
      let steps = 0;
      for (; steps < 60; steps += 1) {
        try {
          await engineA.advance(1 / 60);
        } catch (error: unknown) {
          rejection = error;
          break;
        }
        if (panics.length > 0 || engineA.state === "faulted") break;
      }
      const trap = rejection instanceof GwenWasmPanicError ? rejection : panics[0];
      if (!(trap instanceof GwenWasmPanicError)) {
        const seen = rejection instanceof Error ? rejection.name : String(rejection);
        throw new Error(
          `A did not trap within 60 advances (state ${engineA.state}, steps ${steps}, rejection ${seen}, panics ${panics.length})`,
        );
      }
      expect(trap).toBeInstanceOf(GwenWasmPanicError);
      expect(engineA.state).toBe("faulted");

      const bErrors: unknown[] = [];
      for (let step = 0; step < 60; step += 1) {
        try {
          await engineB.advance(1 / 60);
        } catch (error: unknown) {
          bErrors.push(error);
          break;
        }
      }
      expect(bErrors).toEqual([]);
      expect(engineB.state).toBe("running");
      expect(positionHash(engineB, idsB)).toBe(PHYSICS2D_HASH_A);
    } finally {
      await stopAll(engines);
    }
  }, 60_000);

  it("isolated rooms keep their own entity counts and component values (physics2d)", async () => {
    const engines: GwenEngine[] = [];
    try {
      const [engineA, engineB] = await openTwo(engines, "physics2d", "isolated", 60);
      const idsA = await buildScene(engineA);
      await engineB.use(Physics2DPlugin({ gravity: -10, maxEntities: 32 }));
      const apiB = engineB.inject("physics2d");
      const idB = engineB.createEntity();
      apiB.addBoxCollider(apiB.addRigidBody(idB, "dynamic", 2, 6), 0.3, 0.3);
      await engineA.startExternal();
      await engineB.startExternal();
      for (let step = 0; step < 60; step += 1) {
        await engineA.advance(1 / 60);
        await engineB.advance(1 / 60);
      }
      expect(engineA.getStats().entityCount).toBe(4);
      expect(engineB.getStats().entityCount).toBe(1);
      expect(positionHash(engineA, idsA)).toBe(PHYSICS2D_HASH_A);
      expect(positionHash(engineB, [idB])).not.toBe(PHYSICS2D_HASH_A);
      expect(memoryOf(engineA)).not.toBe(memoryOf(engineB));
    } finally {
      await stopAll(engines);
    }
  }, 60_000);

  it.each(["physics2d", "physics3d"] as const)(
    "determinism: alone, interleaved and shared give identical state hashes (%s)",
    async (variant) => {
      const expected = variant === "physics2d" ? PHYSICS2D_HASH_A : PHYSICS3D_HASH_A;
      const engines: GwenEngine[] = [];
      try {
        const alone = await openOne(engines, variant, "isolated");
        const aloneHash = await sceneHash(alone, variant);
        const [roomA, roomB] = await openTwo(engines, variant, "isolated", 60);
        const idsA = variant === "physics2d" ? await buildScene(roomA) : await buildScene3d(roomA);
        if (variant === "physics2d") await buildScene(roomB);
        else await buildScene3d(roomB);
        await roomA.startExternal();
        await roomB.startExternal();
        for (let step = 0; step < 60; step += 1) {
          await roomA.advance(1 / 60);
          await roomB.advance(1 / 60);
        }
        const interleaved =
          variant === "physics2d" ? positionHash(roomA, idsA) : positionHash3d(roomA, idsA);

        const shared = await openOne(engines, variant, "shared");
        const sharedHash = await sceneHash(shared, variant);

        expect(aloneHash).toBe(expected);
        expect(interleaved).toBe(expected);
        expect(sharedHash).toBe(expected);
        expect(memoryOf(roomA)).not.toBe(memoryOf(roomB));
      } finally {
        await stopAll(engines);
      }
    },
    60_000,
  );

  it("isolated: light init fetches only light URLs", async () => {
    const root = fileURLToPath(new URL("../../wasm/", import.meta.url));
    const paths: string[] = [];
    const server = createServer((request, response) => {
      const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
      paths.push(pathname);
      const relative = pathname.replace(/^\/+/, "");
      const file = path.resolve(root, relative);
      const fromRoot = path.relative(root, file);
      if (fromRoot.startsWith("..") || path.isAbsolute(fromRoot) || !existsSync(file)) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, { "content-type": "application/octet-stream" });
      createReadStream(file).pipe(response);
    });
    const engines: GwenEngine[] = [];
    try {
      await listen(server);
      const address = server.address();
      if (address === null || typeof address === "string")
        throw new Error("test server has no port");
      const jsUrl = factoryUrl("light");
      const wasmUrl = `http://127.0.0.1:${address.port}/light/gwen_core_bg.wasm`;
      const bridgeA = new WasmBridgeImpl();
      const bridgeB = new WasmBridgeImpl();
      await bridgeA.init("light", { jsUrl, wasmUrl, wasmInstance: "isolated", maxEntities: 32 });
      await bridgeB.init("light", { jsUrl, wasmUrl, wasmInstance: "isolated", maxEntities: 32 });
      engines.push(
        await createEngine({
          variant: "light",
          maxEntities: 32,
          wasmInstance: "isolated",
          _bridge: bridgeA,
          _ownsBridge: true,
        }),
        await createEngine({
          variant: "light",
          maxEntities: 32,
          wasmInstance: "isolated",
          _bridge: bridgeB,
          _ownsBridge: true,
        }),
      );
      expect(paths).toEqual(["/light/gwen_core_bg.wasm"]);
      const loaded: unknown = await import(jsUrl);
      expect(fingerprintOf(loaded)).toContain("variant=light");
      expect(bridgeA.getLinearMemory()).not.toBe(bridgeB.getLinearMemory());
    } finally {
      await stopAll(engines);
      await closeServer(server);
    }
  }, 60_000);
});
