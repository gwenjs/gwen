/// <reference types="node" />
// @gwenjs/core/node — Node-only entry. Importing it is the runtime declaration: no sniffing.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { GwenError } from "@gwenjs/schema";

import { validateEngineConfig } from "./engine/engine-config-validator.js";
import { CoreErrorCodes } from "./engine/engine-errors.js";
import {
  createEngine as coreCreateEngine,
  setupGwen as coreSetupGwen,
} from "./engine/engine-factory.js";
import type { GwenEngine, GwenEngineOptions } from "./engine/engine-types.js";
import type {
  CoreVariant,
  GwenCoreGlueFactoryModule,
  InitWasmOptions,
} from "./engine/wasm-bridge-types.js";

// Same three relatives as engine-factory.ts:41-43 (dist chunk, src entry, monorepo).
const here = path.dirname(fileURLToPath(import.meta.url));
const CANDIDATES = ["../../wasm", "../wasm", "../../../wasm"];

const modules = new Map<CoreVariant, Promise<WebAssembly.Module>>();

function isFactoryModule(value: unknown): value is GwenCoreGlueFactoryModule {
  if (typeof value !== "object" || value === null) return false;
  if (!("createGlue" in value) || typeof value.createGlue !== "function") return false;
  if (!("CONTRACT" in value) || typeof value.CONTRACT !== "object" || value.CONTRACT === null) {
    return false;
  }
  return "wasmUrl" in value && value.wasmUrl instanceof URL;
}

function artefact(variant: CoreVariant, file: string): string {
  const tried = CANDIDATES.map((relative) => path.join(here, relative, variant, file));
  const found = tried.find((candidate) => existsSync(candidate));
  if (found !== undefined) return found;
  throw new GwenError(
    CoreErrorCodes.WASM_LOAD_ERROR,
    `No ${file} for variant "${variant}" in: ${tried.join(", ")}.`,
    {
      composable: "loadGwenModule",
      hint: __GWEN_DEV__
        ? "Run pnpm build:wasm, or reinstall @gwenjs/core with its wasm/ directory."
        : undefined,
    },
  );
}

/**
 * Compile `gwen_core_bg.wasm` for `variant` once per process.
 * A rejected lookup is removed only while it is still the cached promise.
 */
export function loadGwenModule(variant: CoreVariant): Promise<WebAssembly.Module> {
  const cached = modules.get(variant);
  if (cached !== undefined) return cached;

  const p = (async () => {
    const file = await readFile(artefact(variant, "gwen_core_bg.wasm"));
    const bytes = new Uint8Array(new ArrayBuffer(file.byteLength));
    bytes.set(file);
    return WebAssembly.compile(bytes);
  })();
  modules.set(variant, p);
  void p.catch(() => {
    if (modules.get(variant) === p) modules.delete(variant);
  });
  return p;
}

/** Load `gwen_core_factory.js` by a computed file URL. Not a static import. */
async function loadFactory(variant: CoreVariant): Promise<GwenCoreGlueFactoryModule> {
  const href = pathToFileURL(artefact(variant, "gwen_core_factory.js")).href;
  let loaded: unknown;
  try {
    loaded = await import(/* @vite-ignore */ href);
  } catch (cause) {
    throw new GwenError(CoreErrorCodes.WASM_LOAD_ERROR, `Unable to load WASM glue: ${href}.`, {
      composable: "setupGwen",
      cause,
    });
  }
  if (!isFactoryModule(loaded)) {
    throw new GwenError(
      CoreErrorCodes.WASM_LOAD_ERROR,
      `jsUrl must point at gwen_core_factory.js, got ${href}.`,
      { composable: "setupGwen" },
    );
  }
  return loaded;
}

/**
 * Node `setupGwen`. Fills only the glue side or the binary side the caller left empty.
 * `wasmInstance` defaults to `"isolated"`.
 */
export async function setupGwen(
  options: GwenEngineOptions & InitWasmOptions = {},
): Promise<GwenEngine> {
  const variant = options.variant ?? "light";
  const glue =
    options.glue ?? (options.jsUrl === undefined ? await loadFactory(variant) : undefined);
  const binary = options.wasmUrl ?? options.wasmBytes ?? options.wasmModule;
  const wasmModule = binary === undefined ? await loadGwenModule(variant) : options.wasmModule;
  return coreSetupGwen({
    ...options,
    ...(glue !== undefined ? { glue } : {}),
    ...(wasmModule !== undefined ? { wasmModule } : {}),
    wasmInstance: options.wasmInstance ?? "isolated",
  });
}

/**
 * Node `createEngine`. A caller `_bridge` is passed to `@gwenjs/core`.
 * Otherwise the config is checked, then {@link setupGwen} runs. URLs are not auto-resolved.
 */
export async function createEngine(
  options: GwenEngineOptions & InitWasmOptions = {},
): Promise<GwenEngine> {
  if (options._bridge !== undefined) return coreCreateEngine(options);
  validateEngineConfig(options);
  return setupGwen(options);
}

export type { CoreVariant, InitWasmOptions };
