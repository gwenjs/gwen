import type { Plugin } from "vite";
import type { GwenViteOptions } from "../types.js";

/** Options of the `gwen:wasm-modules-dts` plugin. */
export interface WasmModulesDtsOptions {
  /**
   * Extra directories to scan besides `src`, relative to the project root.
   * Read at `buildStart` and on each hot update. `false` and `undefined` entries are ignored.
   */
  dirs?: () => readonly (string | false | undefined)[];
}

/**
 * Vite sub-plugin that writes `.gwen/types/wasm-modules.d.ts`.
 * Not implemented yet: the hooks do nothing.
 */
export function gwenWasmModulesDtsPlugin(
  _options: GwenViteOptions & WasmModulesDtsOptions,
): Plugin {
  return {
    name: "gwen:wasm-modules-dts",
    configResolved() {},
    buildStart() {},
    handleHotUpdate() {},
  };
}
