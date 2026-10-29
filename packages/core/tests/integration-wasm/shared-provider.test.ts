import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

import { sharedProvider } from "../../src/engine/wasm-instance-provider.js";
import type {
  GwenCoreGlueFactoryModule,
  GwenCoreGlueInstance,
} from "../../src/engine/wasm-bridge-types.js";

const f: GwenCoreGlueFactoryModule = await import("@gwenjs/core/wasm/light/factory");
const lightLoaded: unknown = await import("@gwenjs/core/wasm/light/factory");
const physics2dLoaded: unknown = await import("@gwenjs/core/wasm/physics2d/factory");
const physics3dLoaded: unknown = await import("@gwenjs/core/wasm/physics3d/factory");

const VARIANTS = ["light", "physics2d", "physics3d"] as const;
type Variant = (typeof VARIANTS)[number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// physics2d is narrowed here: Engine.physics_get_sensor_state returns Uint32Array (packages/core/wasm/physics2d/gwen_core.d.ts:372, crates/gwen-core/src/bindings.rs:1592) while WasmEngine declares Int32Array (packages/core/src/engine/wasm-bridge-types.ts:490).
function isGlueFactoryModule(value: unknown): value is GwenCoreGlueFactoryModule {
  if (!isRecord(value)) return false;
  if (typeof value.createGlue !== "function") return false;
  if (!(value.wasmUrl instanceof URL)) return false;
  if (!isRecord(value.CONTRACT)) return false;
  return true;
}

function loadedFactory(variant: Variant): unknown {
  if (variant === "light") return lightLoaded;
  if (variant === "physics2d") return physics2dLoaded;
  return physics3dLoaded;
}

function factoryOf(variant: Variant): GwenCoreGlueFactoryModule {
  const loaded = loadedFactory(variant);
  if (!isGlueFactoryModule(loaded)) {
    throw new Error(
      `@gwenjs/core/wasm/${variant}/factory is missing createGlue, wasmUrl, or CONTRACT`,
    );
  }
  if (variant === "light" && loaded !== f) {
    throw new Error("light factory module is not the typed import");
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

function failOnce(real: GwenCoreGlueFactoryModule, boom: Error): GwenCoreGlueFactoryModule {
  let fail = true;
  return {
    CONTRACT: real.CONTRACT,
    wasmUrl: real.wasmUrl,
    createGlue() {
      const glue = real.createGlue();
      if (!fail) return glue;
      fail = false;
      return {
        Engine: glue.Engine,
        initSync(): { memory: WebAssembly.Memory } {
          throw boom;
        },
      };
    },
  };
}

it.each(VARIANTS)(
  "%s two acquires on one Module share one glue and one memory",
  async (variant) => {
    const factory = factoryOf(variant);
    const module = await WebAssembly.compile(wasmBytes(variant));
    const held: GwenCoreGlueInstance[] = [];
    try {
      const first = sharedProvider.acquire(module, factory);
      held.push(first.glue);
      const second = sharedProvider.acquire(module, factory);
      held.push(second.glue);
      expect(second.glue).toBe(first.glue);
      expect(second.exports.memory).toBe(first.exports.memory);
    } finally {
      for (const glue of held) sharedProvider.release(glue);
    }
  },
);

it.each(VARIANTS)("%s a failed shared instantiation leaves no cache entry", async (variant) => {
  const factory = factoryOf(variant);
  const module = await WebAssembly.compile(wasmBytes(variant));
  const boom = new Error("initSync failed");
  const wrapped = failOnce(factory, boom);
  const held: GwenCoreGlueInstance[] = [];
  try {
    let caught: unknown;
    try {
      sharedProvider.acquire(module, wrapped);
    } catch (error: unknown) {
      caught = error;
    }
    expect(caught).toBe(boom);

    const second = sharedProvider.acquire(module, wrapped);
    held.push(second.glue);
    expect(second.exports.memory).toBeInstanceOf(WebAssembly.Memory);

    const third = sharedProvider.acquire(module, wrapped);
    held.push(third.glue);
    expect(third.glue).toBe(second.glue);
    expect(third.exports.memory).toBe(second.exports.memory);
  } finally {
    for (const glue of held) sharedProvider.release(glue);
  }
});

it.each(VARIANTS)(
  "%s release at zero refs drops the entry and the next acquire instantiates again",
  async (variant) => {
    const factory = factoryOf(variant);
    const module = await WebAssembly.compile(wasmBytes(variant));
    const held: GwenCoreGlueInstance[] = [];
    try {
      const first = sharedProvider.acquire(module, factory);
      held.push(first.glue);
      const second = sharedProvider.acquire(module, factory);
      held.push(second.glue);
      sharedProvider.release(second.glue);
      held.pop();

      const third = sharedProvider.acquire(module, factory);
      held.push(third.glue);
      expect(third.exports.memory).toBe(first.exports.memory);

      sharedProvider.release(first.glue);
      sharedProvider.release(third.glue);
      held.length = 0;

      const again = sharedProvider.acquire(module, factory);
      held.push(again.glue);
      expect(again.exports.memory).not.toBe(first.exports.memory);
    } finally {
      for (const glue of held) sharedProvider.release(glue);
    }
  },
);

it.each(VARIANTS)("%s two Modules of one variant get two instances", async (variant) => {
  const factory = factoryOf(variant);
  const bytes = wasmBytes(variant);
  const moduleA = await WebAssembly.compile(bytes);
  const moduleB = await WebAssembly.compile(bytes);
  const held: GwenCoreGlueInstance[] = [];
  try {
    const first = sharedProvider.acquire(moduleA, factory);
    held.push(first.glue);
    const second = sharedProvider.acquire(moduleB, factory);
    held.push(second.glue);
    expect(second.glue).not.toBe(first.glue);
    expect(second.exports.memory).not.toBe(first.exports.memory);

    const third = sharedProvider.acquire(moduleA, factory);
    held.push(third.glue);
    expect(third.glue).toBe(first.glue);
    expect(third.exports.memory).toBe(first.exports.memory);
  } finally {
    for (const glue of held) sharedProvider.release(glue);
  }
});
