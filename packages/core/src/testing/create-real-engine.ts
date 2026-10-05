/// <reference types="node" />

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createEngine, type GwenEngine } from "../engine/gwen-engine.js";
import { WasmBridgeImpl } from "../engine/wasm-bridge.js";
import type { CoreVariant } from "../engine/wasm-bridge-types.js";

export interface RealEngineHandle {
  readonly engine: GwenEngine;
  readonly bridge: WasmBridgeImpl;
  advance(frames: number, dt: number): Promise<void>;
  dispose(): Promise<void>;
}

export interface CreateRealEngineOptions {
  readonly variant: CoreVariant;
  readonly maxEntities: number;
}

function artifactPath(variant: CoreVariant, fileName: string): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(here, "../../wasm", variant, fileName),
    path.join(here, "../wasm", variant, fileName),
    path.join(here, "../../../wasm", variant, fileName),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  return found ?? path.join(here, "../../wasm", variant, fileName);
}

function assertArtifact(variant: CoreVariant, filePath: string): void {
  if (!existsSync(filePath)) {
    throw new Error(
      `WASM artifact missing for variant "${variant}": ${filePath}. Run pnpm build:wasm.`,
    );
  }
}

/**
 * Boot a real {@link GwenEngine} on the real `gwen-core` wasm binary.
 * `jsUrl` / `wasmUrl` go to `bridge.init` only — they are not engine options.
 *
 * Lives on `@gwenjs/core/testing` so satellite suites can reuse it.
 * It does not import vitest, and it is not exported from the runtime entry.
 */
export async function createRealEngine(
  options: CreateRealEngineOptions,
): Promise<RealEngineHandle> {
  const jsPath = artifactPath(options.variant, "gwen_core.js");
  const wasmPath = artifactPath(options.variant, "gwen_core_bg.wasm");
  assertArtifact(options.variant, jsPath);
  assertArtifact(options.variant, wasmPath);

  const jsUrl = pathToFileURL(jsPath).href;
  const wasmBytes = readFileSync(wasmPath);
  const wasmUrl = `data:application/wasm;base64,${wasmBytes.toString("base64")}`;

  const bridge = new WasmBridgeImpl();
  await bridge.init(options.variant, {
    maxEntities: options.maxEntities,
    jsUrl,
    wasmUrl,
  });
  const engine = await createEngine({
    variant: options.variant,
    maxEntities: options.maxEntities,
    _bridge: bridge,
  });

  let started = false;
  let disposed = false;

  return {
    engine,
    bridge,
    async advance(frames: number, dt: number): Promise<void> {
      if (!started) {
        await engine.startExternal();
        started = true;
      }
      for (let frame = 0; frame < frames; frame += 1) {
        await engine.advance(dt);
      }
    },
    async dispose(): Promise<void> {
      if (disposed) return;
      disposed = true;
      await engine.stop();
    },
  };
}
