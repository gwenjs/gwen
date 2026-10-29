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

/** Process-wide provider. Each `acquire` instantiates. `release` does nothing. */
export const sharedProvider: WasmInstanceProvider = {
  mode: "shared",
  acquire(module, factory) {
    const glue = factory.createGlue();
    const exports = glue.initSync({ module });
    return { glue, exports };
  },
  release(glue) {
    void glue;
  },
};
