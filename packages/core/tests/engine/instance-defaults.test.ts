/**
 * The main entry (`@gwenjs/core`) resolves an omitted `wasmInstance` to `auto`.
 * The first engine of a module stays on the pool. The next one is isolated.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import * as light from "@gwenjs/core/wasm/light/factory";

import { createEngine } from "../../src/index.js";
import type { GwenEngine } from "../../src/engine/engine-types.js";
import type { GwenCoreGlueFactoryModule } from "../../src/engine/wasm-bridge-types.js";

function isGlueModule(value: object): value is GwenCoreGlueFactoryModule {
  if (!("createGlue" in value) || typeof value.createGlue !== "function") return false;
  if (!("CONTRACT" in value) || typeof value.CONTRACT !== "object" || value.CONTRACT === null) {
    return false;
  }
  return "wasmUrl" in value && value.wasmUrl instanceof URL;
}

function lightGlue(): GwenCoreGlueFactoryModule {
  if (!isGlueModule(light)) {
    throw new Error("light factory is missing createGlue, CONTRACT, or wasmUrl");
  }
  return light;
}

function lightModule(): WebAssembly.Module {
  const wasmPath = fileURLToPath(new URL("../../wasm/light/gwen_core_bg.wasm", import.meta.url));
  return new WebAssembly.Module(readFileSync(wasmPath));
}

describe("browser entry wasmInstance", () => {
  it("the browser entry resolves wasmInstance to auto", async () => {
    const glue = lightGlue();
    const wasmModule = lightModule();
    const engines: GwenEngine[] = [];
    try {
      const first = await createEngine({ glue, wasmModule, maxEntities: 8 });
      engines.push(first);
      const second = await createEngine({ glue, wasmModule, maxEntities: 8 });
      engines.push(second);
      expect(first.wasmInstance).toBe("shared");
      expect(second.wasmInstance).toBe("isolated");
    } finally {
      for (const engine of engines) await engine.stop();
    }
  });
});
