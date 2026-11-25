import type { AutoImport } from "@gwenjs/kit";
import type { GwenTweenOptions } from "./plugins/tween.js";
import type { HooksPluginOptions } from "./plugins/hooks.js";

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
   * When true, `gwen:layout-name` is not registered.
   * When false, each `const` layout is followed by a dev-only statement:
   * `__GWEN_DEV__ && Object.assign(Name, { __layoutName__: "Name" })`.
   * @default false
   */
  disableNameInjection?: boolean;
}

/**
 * Options for scene-router name injection.
 */
export interface GwenSceneRouterOptions {
  /**
   * When true, `gwen:scene-router-name` is not registered.
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
   * Whether to generate the auto-import `.d.ts` files and `wasm-modules.d.ts`.
   * Set to `false` to opt out.
   * @default true
   */
  dts?: boolean;

  /** Options for the actor auto-discovery sub-plugin. */
  actors?: ActorPluginOptions;

  /** Options for the layout virtual module sub-plugin. */
  layout?: GwenLayoutOptions;
  /** Options for scene-router name injection. */
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
   * Reserved. A no-op until the hot-path rewrite of #69; accepted so existing
   * configs keep typechecking.
   *
   * @default false
   */
  optimizer?: boolean | GwenOptimizerUserOptions;
}

/**
 * Reserved, a no-op until #69 (see GwenViteOptions.optimizer); the field is
 * accepted and ignored.
 */
export interface GwenOptimizerUserOptions {
  /** Accepted and ignored. */
  debug?: boolean;
}
