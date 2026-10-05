/**
 * Ambient type declarations for GWEN virtual modules.
 *
 * Import this file in your `tsconfig.json` compilerOptions.types array or
 * via a triple-slash reference to get full type safety for virtual imports.
 *
 * @example tsconfig.json
 * ```json
 * { "compilerOptions": { "types": ["@gwenjs/vite/virtual"] } }
 * ```
 */

declare module "virtual:gwen/wasm" {
  /** URL to the WASM binary. Use with `WebAssembly.instantiateStreaming(fetch(wasmUrl))`. */
  export const wasmUrl: string;
}

declare module "virtual:gwen/auto-imports" {
  // Re-exports are dynamic; typed individually in .gwen/types/auto-imports.d.ts
}

declare module "virtual:gwen/env" {
  /** The current version of `@gwenjs/core`. */
  export const GWEN_VERSION: string;

  /**
   * The WASM variant loaded at build time.
   * `'debug'` in dev mode, `'release'` in production builds (unless overridden).
   */
  export const GWEN_WASM_VARIANT: "debug" | "release";

  /** Same value as `__GWEN_DEV__` for this build. Matches Vite's `import.meta.env.DEV`. */
  export const GWEN_DEV: boolean;
}

declare module "virtual:gwen/local-plugins" {
  import type { GwenPlugin } from "@gwenjs/core";

  /** Factories for each file found in `src/plugins/`. Call each factory to get a plugin instance. */
  export const plugins: Array<() => GwenPlugin>;
}

declare module "virtual:gwen/local-modules" {
  import type { GwenModule } from "@gwenjs/schema";

  /** Module definitions found in `src/modules/`, with names inferred from filenames. */
  export const modules: GwenModule[];
}
