/**
 * Build-time module types for the GWEN framework.
 *
 * Defined in `@gwenjs/schema` so that `@gwenjs/app` and `@gwenjs/vite`
 * can reference `GwenModule` and `GwenKit` without depending on `@gwenjs/kit`,
 * eliminating circular dependency risk when built-in features are extracted
 * from core into kit-authored GwenModules.
 *
 * `@gwenjs/kit` re-exports everything from here for module authors.
 *
 * @module
 */

import type { GwenPlugin } from "./plugin.js";
import type { DeepPartial } from "./config.js";

/**
 * Augmentable module options merged into `defineConfig`.
 * Each module package adds its key through declaration merging.
 *
 * @example
 * ```typescript
 * declare module "@gwenjs/schema" {
 *   interface GwenModuleOptions {
 *     physics2d?: { gravity: number }
 *   }
 * }
 * ```
 */
export interface GwenModuleOptions {}

// ─── AutoImport ───────────────────────────────────────────────────────────────

/**
 * Declares a composable or utility to be auto-imported into game code.
 *
 * Registered entries become available in game source files without an explicit
 * `import` statement. The `@gwenjs/vite` plugin reads these declarations at
 * build time and generates the `#gwen` virtual module.
 *
 * @example
 * ```ts
 * import type { AutoImport } from '@gwenjs/schema'
 *
 * const entry: AutoImport = {
 *   name: 'usePhysics2D',
 *   from: '@gwenjs/physics2d',
 *   as: 'usePhysics',
 * }
 * ```
 *
 */
export interface AutoImport {
  /** The exported name from the source module. */
  name: string;
  /** The npm package or path to import from. */
  from: string;
  /** Override the local name used in auto-import (default: same as `name`). */
  as?: string;
}

// ─── VitePlugin / ViteUserConfig ─────────────────────────────────────────────

/**
 * Minimal Vite plugin shape, compatible with Vite's `Plugin` type.
 *
 * Typed as `Record<string, unknown>` so that `@gwenjs/schema` and
 * `@gwenjs/kit` remain isomorphic (usable in browser and Node.js alike)
 * without a hard dependency on the `vite` package.
 *
 */
export type VitePlugin = Record<string, unknown>;

/**
 * Minimal Vite user config shape, compatible with Vite's `UserConfig` type.
 *
 * Typed as `Record<string, unknown>` so that `@gwenjs/schema` remains
 * isomorphic without a direct Vite dependency. Passed to
 * {@link GwenKit.extendViteConfig}.
 *
 */
export type ViteUserConfig = Record<string, unknown>;

// ─── GwenBuildHooks ──────────────────────────────────────────────────────────

/**
 * Build-time hook map for the GWEN framework.
 *
 * Only available in Node.js context (CLI, Vite build). Module `setup()`
 * functions can subscribe via {@link GwenKit.hook}.
 *
 * @example
 * ```ts
 * setup(_opts, gwen) {
 *   gwen.hook('build:done', () => console.log('Build complete'))
 * }
 * ```
 *
 */
export interface GwenBuildHooks {
  /** Fired before any module `setup()` runs. */
  "build:before": () => void;
  /** Fired after all module `setup()` calls are complete. */
  "build:done": () => void;
  /** Fired immediately before a module's `setup()` runs. */
  "module:before": (mod: { meta: { name: string } }) => void;
  /** Fired immediately after a module's `setup()` completes. */
  "module:done": (mod: { meta: { name: string } }) => void;
  /** Fired each time a module calls `gwen.extendViteConfig()`. */
  "vite:extendConfig": (config: ViteUserConfig) => void;
}

// ─── GwenBaseConfig ──────────────────────────────────────────────────────────

/**
 * Minimal resolved config shape exposed to module `setup()` via
 * {@link GwenKit.options}.
 *
 * `@gwenjs/app` extends this with the full `ResolvedGwenConfig` type. When
 * writing a module, access these fields via `gwen.options` rather than
 * importing `GwenBaseConfig` directly.
 *
 * @example
 * ```ts
 * import type { GwenBaseConfig } from '@gwenjs/schema'
 *
 * function getTargetFPS(config: GwenBaseConfig): number {
 *   return config.engine?.targetFPS ?? 60
 * }
 * ```
 *
 */
export interface GwenBaseConfig {
  modules?: Array<string | [string, Record<string, unknown>?]>;
  engine?: {
    maxEntities?: number;
    targetFPS?: number;
    variant?: string;
    loop?: string;
    maxDeltaSeconds?: number;
  };
  [key: string]: unknown;
}

// ─── PluginDeclaration ────────────────────────────────────────────────────────

/**
 * A path-based plugin declaration used by module `setup()` functions.
 *
 * Instead of passing a runtime instance to `kit.addPlugin()`, modules declare
 * WHERE the plugin lives. `@gwenjs/vite` reads these declarations at build time
 * and generates a static `import` in the virtual entry — no esbuild duplication.
 *
 * @example
 * ```ts
 * setup(_opts, gwen) {
 *   gwen.addPlugin({ src: '@gwenjs/renderer-core', export: 'ScreenPlugin', options: { fov: 75 } })
 * }
 * ```
 */
export interface PluginDeclaration {
  /** npm package name or project-root-relative file path. */
  src: string;
  /** Named export to import. Omit to use the default export. */
  export?: string;
  /** Options passed as the first argument to the factory. Must be JSON-serializable. */
  options?: unknown;
}

// ─── GwenKit ─────────────────────────────────────────────────────────────────

/**
 * The build-time API provided to module `setup()` functions.
 *
 * Available only during `gwen dev`, `gwen build`, and `gwen prepare`
 * (Node.js context). Not available at browser runtime.
 *
 * @example
 * ```ts
 * import { defineGwenModule } from '@gwenjs/kit/module'
 *
 * export default defineGwenModule({
 *   meta: { name: '@gwenjs/physics2d' },
 *   setup(options, gwen) {
 *     gwen.addPlugin(createPhysics2DPlugin(options))
 *     gwen.addAutoImports([{ name: 'usePhysics2D', from: '@gwenjs/physics2d' }])
 *   },
 * })
 * ```
 *
 */
export interface GwenKit {
  /**
   * Registers a runtime plugin to be loaded when the engine starts.
   *
   * @param plugin - A plugin instance or a factory function that returns one.
   * @example
   * gwen.addPlugin(createPhysics2DPlugin(options))
   */
  addPlugin(plugin: GwenPlugin | (() => GwenPlugin) | PluginDeclaration): void;

  /**
   * Registers composables or utilities for auto-import via the `#gwen`
   * virtual module. The `@gwenjs/vite` plugin aggregates all declarations.
   *
   * @param imports - Array of {@link AutoImport} declarations.
   * @example
   * gwen.addAutoImports([
   *   { name: 'usePhysics2D', from: '@gwenjs/physics2d' },
   *   { name: 'useRigidBody', from: '@gwenjs/physics2d', as: 'useBody' },
   * ])
   */
  addAutoImports(imports: AutoImport[]): void;

  /**
   * Adds a Vite plugin to the build pipeline.
   * Plugins from modules are inserted before the user's `vite.plugins` array.
   *
   * @param plugin - Any Vite-compatible plugin object.
   */
  addVitePlugin(plugin: VitePlugin): void;

  /**
   * Extends the Vite user config. The extender receives the current config and
   * must return a partial override, merged with `defu` (user values win).
   *
   * @param extender - Function that receives the current config and returns overrides.
   * @example
   * gwen.extendViteConfig(config => ({
   *   resolve: { alias: { '~assets': './src/assets' } },
   * }))
   */
  extendViteConfig(extender: (config: ViteUserConfig) => Partial<ViteUserConfig>): void;

  /**
   * Subscribes to a build-time hook.
   *
   * @param event - A {@link GwenBuildHooks} event name.
   * @param fn - Handler matching the hook signature.
   */
  hook<H extends keyof GwenBuildHooks>(event: H, fn: GwenBuildHooks[H]): void;

  /** The fully resolved and merged `gwen.config.ts` options. */
  readonly options: GwenBaseConfig;
}

// ─── GwenModuleDefinition / GwenModule ───────────────────────────────────────

/**
 * The definition object passed to `defineGwenModule()`.
 *
 * Describes a build-time module: its metadata, default options, and `setup`
 * function that configures the GWEN build pipeline.
 *
 * @template Options - The typed options shape this module accepts.
 *
 * @example
 * ```ts
 * import type { GwenModuleDefinition } from '@gwenjs/schema'
 *
 * interface MyOptions { debug?: boolean }
 *
 * const definition: GwenModuleDefinition<MyOptions> = {
 *   meta: { name: '@my-scope/gwen-module', configKey: 'myModule' },
 *   defaults: { debug: false },
 *   setup(options, gwen) { ... },
 * }
 * ```
 *
 */
export interface GwenModuleDefinition<Options extends object = Record<string, unknown>> {
  /** Module metadata. */
  meta: {
    /** Full npm package name, e.g. `'@gwenjs/physics2d'`. */
    name: string;
    /**
     * Key in `gwen.config.ts` where this module's options are read from.
     * E.g. `'physics2d'` means the user writes `physics2d: { gravity: ... }`.
     */
    configKey?: string;
    /** Semver version string, e.g. `'1.2.3'`. */
    version?: string;
  };

  /**
   * Default option values.
   * Merged with user-provided config using `defu` — user values take precedence.
   */
  defaults?: DeepPartial<Options>;

  /**
   * Build-time setup function. Runs in Node.js during `gwen dev`,
   * `gwen build`, or `gwen prepare`.
   *
   * Use the {@link GwenKit} argument to register plugins, auto-imports,
   * and Vite plugins.
   *
   * @param options - Resolved options (user values merged with `defaults`).
   * @param gwen - The build-time kit API.
   */
  setup(options: Options, gwen: GwenKit): void | Promise<void>;
}

/**
 * A resolved GWEN module instance returned by `defineGwenModule()`.
 *
 * Structurally identical to {@link GwenModuleDefinition}. The type alias
 * distinguishes a validated, returned definition from a raw definition literal.
 *
 * @template Options - The typed options shape this module accepts.
 */
export type GwenModule<Options extends object = Record<string, unknown>> =
  GwenModuleDefinition<Options>;
