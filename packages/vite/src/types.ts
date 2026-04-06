import type { AutoImport, GwenTypeTemplate } from '@gwenjs/kit';
import type { GwenSceneRouterOptions } from './plugins/scene-router.js';
import type { GwenTweenOptions } from './plugins/tween.js';

/**
 * Which WASM binary build variant to load.
 * - `'debug'` — unoptimised, faster to build, includes debug info.
 * - `'release'` — optimised, smaller, suitable for production.
 * - `'auto'` — resolves to `'release'` during `vite build`, `'debug'` during `vite dev`.
 */
export type WasmVariant = 'debug' | 'release' | 'auto';

/**
 * Options for the WASM sub-plugin (`gwen:wasm`).
 */
export interface GwenWasmOptions {
  /**
   * Which WASM binary to load.
   * @default 'auto'
   */
  variant?: WasmVariant;

  /**
   * Override the path to the WASM file.
   * When omitted the plugin resolves the binary from the installed
   * `@gwenjs/core` package.
   */
  wasmPath?: string;

  /**
   * Enable WASM HMR.
   * When `true`, a `.wasm` source file change triggers a full page reload.
   * @default true
   */
  hmr?: boolean;
}

/**
 * Options for the `gwen:actor` sub-plugin.
 */
export interface ActorPluginOptions {
  /**
   * Directory (relative to project root) scanned for actor files.
   * @default 'src/actors'
   */
  dir?: string;
  /**
   * Enable targeted HMR invalidation for actor files.
   * @default true
   */
  hmr?: boolean;
}

/**
 * Options for the `gwen:layout` sub-plugin.
 */
export interface GwenLayoutOptions {
  /**
   * Glob patterns for layout source files.
   * @default ['src/layouts/**\/*.ts', 'src/**\/*.layout.ts']
   */
  include?: string[];

  /**
   * Disable debug name injection (default: false).
   * When `false`, `defineLayout(...)` calls are wrapped with `Object.assign(..., { __layoutName__: 'Name' })`.
   * @default false
   */
  disableNameInjection?: boolean;
}

/**
 * Top-level options for the `gwenVitePlugin` / individual sub-plugins.
 */
export interface GwenViteOptions {
  /** WASM binary options. */
  wasm?: GwenWasmOptions;

  /**
   * Auto-import entries to expose via `virtual:gwen/auto-imports`.
   * @default []
   */
  autoImports?: AutoImport[];

  /**
   * Type templates to write into `.gwen/types/` at build start.
   * @default []
   */
  typeTemplates?: GwenTypeTemplate[];

  /**
   * Directory (relative to project root) where generated files are written.
   * @default '.gwen'
   */
  gwenDir?: string;

  /**
   * Whether to generate `.d.ts` files for auto-imports.
   * Set to `false` to opt out.
   * @default true
   */
  dts?: boolean;

  /** Options for the actor auto-discovery sub-plugin. */
  actors?: ActorPluginOptions;

  /** Options for the layout virtual module sub-plugin. */
  layout?: GwenLayoutOptions;
  /** Options for the scene router sub-plugin. */
  sceneRouter?: GwenSceneRouterOptions;

  /** Options for the tween easing analysis sub-plugin. */
  tween?: GwenTweenOptions;
}
