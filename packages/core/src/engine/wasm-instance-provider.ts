/**
 * Glue instances for a compiled module.
 * `shared` keeps one instance per module. `isolated` is one instance per acquire.
 */

import type { GwenCoreGlueFactoryModule, GwenCoreGlueInstance } from "./wasm-bridge-types.js";

export type WasmInstanceMode = "shared" | "isolated";

export interface WasmInstanceProvider {
  readonly mode: WasmInstanceMode;
  acquire(
    module: WebAssembly.Module,
    factory: GwenCoreGlueFactoryModule,
  ): { glue: GwenCoreGlueInstance; exports: { memory: WebAssembly.Memory } };
  release(glue: GwenCoreGlueInstance): void;
}

interface SharedEntry {
  glue: GwenCoreGlueInstance;
  exports: { memory: WebAssembly.Memory };
  refs: number;
}

const byModule = new WeakMap<WebAssembly.Module, SharedEntry>();
const byGlue = new Map<GwenCoreGlueInstance, WebAssembly.Module>();

/**
 * One glue and one memory per compiled Module, for the whole process.
 * The entry is stored only after `initSync` succeeds, and removed at zero refs.
 */
export const sharedProvider: WasmInstanceProvider = {
  mode: "shared",
  acquire(module, factory) {
    const hit = byModule.get(module);
    if (hit !== undefined) {
      hit.refs += 1;
      return { glue: hit.glue, exports: hit.exports };
    }
    const glue = factory.createGlue();
    const exports = glue.initSync({ module });
    const entry: SharedEntry = { glue, exports, refs: 1 };
    byModule.set(module, entry);
    byGlue.set(glue, module);
    return { glue, exports };
  },
  release(glue) {
    const module = byGlue.get(glue);
    if (module === undefined) return;
    const entry = byModule.get(module);
    if (entry === undefined) return;
    entry.refs -= 1;
    if (entry.refs > 0) return;
    byModule.delete(module);
    byGlue.delete(glue);
  },
};

/**
 * One glue and one memory per `acquire`.
 * Instantiation errors are not mapped, and live instances are not counted.
 */
export const isolatedProvider: WasmInstanceProvider = {
  mode: "isolated",
  acquire(module, factory) {
    const glue = factory.createGlue();
    const exports = glue.initSync({ module });
    return { glue, exports };
  },
  release() {
    return;
  },
};
