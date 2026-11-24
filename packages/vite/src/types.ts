import type { AutoImport } from "@gwenjs/kit";
import type { GwenSceneRouterOptions } from "./plugins/scene-router.js";
import type { GwenTweenOptions } from "./plugins/tween.js";
import type { HooksPluginOptions } from "./plugins/hooks.js";
import type { WasmTier } from "./optimizer/types.js";

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
 * Options for the `gwen:local-plugins` sub-plugin.
 */
export interface LocalPluginsOptions {
  /**
   * Directory (relative to project root) scanned for local plugin files.
   * @default 'src/plugins'
   */
  dir?: string;
  /**
   * Enable HMR invalidation when files are added, removed, or renamed.
   * @default true
   */
  hmr?: boolean;
}

/**
 * Options for the `gwen:local-modules` sub-plugin.
 */
export interface LocalModulesOptions {
  /**
   * Directory (relative to project root) scanned for local module files.
   * @default 'src/modules'
   */
  dir?: string;
  /**
   * Enable HMR invalidation when files are added, removed, or renamed.
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
  /**
   * Auto-import entries to expose via `virtual:gwen/auto-imports`.
   * @default []
   */
  autoImports?: AutoImport[];

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

  /**
   * Options for the `gwen:hooks` sub-plugin.
   * When omitted the plugin uses `'src/hooks.ts'` as the default hooks file.
   */
  hooks?: HooksPluginOptions;

  /**
   * Options for the `gwen:local-plugins` sub-plugin.
   * Set to `false` to disable auto-discovery of `src/plugins/`.
   * @default { dir: 'src/plugins', hmr: true }
   */
  localPlugins?: LocalPluginsOptions | false;

  /**
   * Options for the `gwen:local-modules` sub-plugin.
   * Set to `false` to disable auto-discovery of `src/modules/`.
   * @default { dir: 'src/modules', hmr: true }
   */
  localModules?: LocalModulesOptions | false;

  /**
   * Enable the ECS bulk optimizer.
   *
   * - `false` (default) — detect-only mode: logs optimizable patterns without modifying code.
   * - `true` — transform mode: rewrites `useQuery + onUpdate + useComponent` loops to bulk
   *   WASM calls with default settings (`componentsDir: 'src'`, `tier: 'core'`).
   * - `{ ... }` — transform mode with explicit options. Providing an object always enables
   *   the optimizer in `'transform'` mode.
   *
   * @example vite.config.ts — simple activation
   * ```ts
   * gwenVitePlugin({ optimizer: true })
   * ```
   *
   * @example vite.config.ts — custom components directory
   * ```ts
   * gwenVitePlugin({ optimizer: { componentsDir: 'src/ecs', tier: 'physics3d' } })
   * ```
   *
   * @default false
   */
  optimizer?: boolean | GwenOptimizerUserOptions;
}

/**
 * Fine-grained options for the ECS bulk optimizer sub-plugin.
 * Providing these always enables the optimizer in `'transform'` mode.
 *
 * @see {@link GwenViteOptions.optimizer}
 */
export interface GwenOptimizerUserOptions {
  /**
   * Directory (relative to project root) scanned for `defineComponent` calls.
   * Set this when your components live outside the default `'src'` folder.
   * @default 'src'
   */
  componentsDir?: string;
  /**
   * Override the WASM tier for generated bulk-call code.
   * Use `'physics2d'` or `'physics3d'` when the optimized systems query
   * physics-specific component types.
   * @default 'core'
   */
  tier?: WasmTier;
  /**
   * Log each detected and transformed pattern to the console.
   * @default false
   */
  debug?: boolean;
}
