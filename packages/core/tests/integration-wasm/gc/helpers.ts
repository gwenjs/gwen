import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { CoreVariant } from "../../../src/engine/wasm-bridge-types.js";

/** Three `gc()` passes, each followed by a macrotask, so a dropped ref can be collected. */
export async function forceGc(): Promise<void> {
  const gc = Reflect.get(globalThis, "gc");
  if (typeof gc !== "function") {
    throw new Error("globalThis.gc is not a function");
  }
  for (let pass = 0; pass < 3; pass += 1) {
    gc();
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  }
}

/**
 * Same `file:` glue URL and `data:` wasm URL as `nodeWasmUrls` in engine-factory.ts.
 * `setupGwen` does not resolve them on its own.
 */
export function nodeArtefactUrls(variant: CoreVariant): { jsUrl: string; wasmUrl: string } {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = ["../../../wasm", "../../../../wasm", "../../wasm"].map((relative) =>
    path.join(here, relative, variant),
  );
  const root = candidates.find((dir) => existsSync(path.join(dir, "gwen_core_factory.js")));
  if (root === undefined) {
    throw new Error(`WASM artefacts missing for ${variant}`);
  }
  const wasmBytes = readFileSync(path.join(root, "gwen_core_bg.wasm"));
  return {
    jsUrl: pathToFileURL(path.join(root, "gwen_core_factory.js")).href,
    wasmUrl: `data:application/wasm;base64,${wasmBytes.toString("base64")}`,
  };
}
