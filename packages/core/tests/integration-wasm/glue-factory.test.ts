import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

const VARIANTS = ["light", "physics2d", "physics3d"] as const;
type Variant = (typeof VARIANTS)[number];

// `Engine` is the class each variant's gwen_core.js exports.
const ENGINE_CLASS = "Engine";
const ENTITY_COUNT = 10;
// Engine::new rejects 0. 64 is inside 1..=MAX_ENTITIES_LIMIT.
const MAX_ENTITIES = 64;

interface GlueEntityId {
  free(): void;
}

interface GlueEngine {
  free(): void;
  count_entities(): number;
  create_entity(): GlueEntityId;
}

interface GlueSyncExports {
  readonly memory: WebAssembly.Memory;
}

/** Subset of the generated GwenCoreGlueInstance this file calls. */
interface GwenCoreGlueInstance {
  readonly Engine: new (max_entities: number) => GlueEngine;
  initSync(module: { module: WebAssembly.Module }): GlueSyncExports;
  init(): Promise<GlueSyncExports>;
}

interface GlueFactoryModule {
  createGlue(): GwenCoreGlueInstance;
  readonly wasmUrl: URL;
  readonly CONTRACT: {
    readonly fingerprint: string;
    readonly names: readonly string[];
    readonly rawExports: readonly string[];
    readonly imports: readonly string[];
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isGlueFactoryModule(value: unknown): value is GlueFactoryModule {
  if (!isRecord(value)) return false;
  if (typeof value.createGlue !== "function") return false;
  if (!(value.wasmUrl instanceof URL)) return false;
  if (!isRecord(value.CONTRACT) || !Array.isArray(value.CONTRACT.names)) return false;
  return true;
}

function isCoreWasmLoadError(value: unknown): boolean {
  return (
    value instanceof Error &&
    isRecord(value) &&
    value.code === "CORE:WASM_LOAD_ERROR" &&
    value.message.includes("createGlue().init() needs { module_or_path }")
  );
}

async function loadFactory(variant: Variant): Promise<unknown> {
  const spec = `@gwenjs/core/wasm/${variant}/factory`;
  try {
    return await import(/* @vite-ignore */ spec);
  } catch (error: unknown) {
    return error;
  }
}

function openFactory(loaded: unknown): GlueFactoryModule {
  const createGlue = isRecord(loaded) ? loaded.createGlue : undefined;
  expect(typeof createGlue).toBe("function");
  expect(typeof (isRecord(loaded) ? loaded.wasmUrl : undefined)).toBe("object");
  const names = isRecord(loaded) && isRecord(loaded.CONTRACT) ? loaded.CONTRACT.names : [];
  expect(Array.isArray(names) && names.includes(ENGINE_CLASS)).toBe(true);
  if (!isGlueFactoryModule(loaded)) {
    throw new Error("factory module is missing createGlue, wasmUrl, or CONTRACT");
  }
  return loaded;
}

function wasmBytes(variant: Variant): Uint8Array<ArrayBuffer> {
  const wasmPath = fileURLToPath(
    new URL(`../../wasm/${variant}/gwen_core_bg.wasm`, import.meta.url),
  );
  const file = readFileSync(wasmPath);
  const bytes = new Uint8Array(file.byteLength);
  bytes.set(file);
  return bytes;
}

it.each(VARIANTS)(
  "%s two createGlue states from one Module have separate memory and counts",
  async (variant) => {
    const factory = openFactory(await loadFactory(variant));
    const module = new WebAssembly.Module(wasmBytes(variant));
    const a = factory.createGlue();
    const b = factory.createGlue();
    const exportsA = a.initSync({ module });
    const exportsB = b.initSync({ module });
    expect(exportsA.memory).not.toBe(exportsB.memory);

    let engineA: GlueEngine | undefined;
    let engineB: GlueEngine | undefined;
    try {
      engineA = new a.Engine(MAX_ENTITIES);
      engineB = new b.Engine(MAX_ENTITIES);
      for (let index = 0; index < ENTITY_COUNT; index += 1) {
        engineA.create_entity();
      }
      expect(engineB.count_entities()).toBe(0);
      expect(engineA.count_entities()).toBe(ENTITY_COUNT);
    } finally {
      if (engineA !== undefined) engineA.free();
      if (engineB !== undefined) engineB.free();
    }
  },
);

it("init without module_or_path rejects with CORE:WASM_LOAD_ERROR", async () => {
  const factory = openFactory(await loadFactory("light"));
  const rejection: unknown = await factory
    .createGlue()
    .init()
    .then(
      () => undefined,
      (error: unknown) => error,
    );
  expect(isCoreWasmLoadError(rejection)).toBe(true);
});

it("initSync twice on one state returns the same exports", async () => {
  const factory = openFactory(await loadFactory("light"));
  const module = new WebAssembly.Module(wasmBytes("light"));
  const state = factory.createGlue();
  const first = state.initSync({ module });
  const second = state.initSync({ module });
  expect(second).toBe(first);
});
