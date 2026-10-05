import { expectTypeOf } from "vitest";

import type { GwenEngine } from "../../src/engine/gwen-engine";
import { useWasmModule } from "../../src/system/runtime/define-system";

declare module "../../src/engine/engine-types.js" {
  interface GwenWasmModules {
    pathfinder: WebAssembly.Exports & { find(): number };
  }
}

declare const engine: GwenEngine;

const handle = useWasmModule("pathfinder");
expectTypeOf(handle.exports.find).toEqualTypeOf<() => number>();
expectTypeOf(engine.getWasmModule("pathfinder").exports.find).toEqualTypeOf<() => number>();

// @ts-expect-error unknown module name
useWasmModule("missing");
// @ts-expect-error unknown module name
engine.getWasmModule("missing");
