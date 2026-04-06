/**
 * @file RFC-004 — defineGwenModule, GwenKit, AutoImport, GwenTypeTemplate
 */

import type { GwenPlugin } from '@gwenjs/core';

// ─── DeepPartial helper ───────────────────────────────────────────────────────

/** Recursively marks all properties of T as optional.
 *
 * Useful for `defaults` objects in module definitions, where only a subset of
 * options is provided and the rest is filled in by the user or by `defu`.
 *
 * @typeParam T - The type whose properties to make recursively optional.
 *
 * @example
 * ```ts
 * import type { DeepPartial } from '@gwenjs/kit'
 *
 * interface PhysicsOptions {
 *   gravity: number
 *   solver: { iterations: number; tolerance: number }
 * }
 *
 * const defaults: DeepPartial<PhysicsOptions> = {
 *   solver: { iterations: 8 },
 * }
 * ```
 *
 * @since 1.0.0
 */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

// ─── AutoImport ───────────────────────────────────────────────────────────────

/**
 * Declares a composable or utility to be auto-imported into game code.
 *
 * Registered composables become available in game source files without an
 * explicit `import` statement. The `@gwenjs/vite` plugin reads these
 * declarations at build time and generates a virtual module.
 *
 * @example
 * ```ts
 * import type { AutoImport } from '@gwenjs/kit'
 *
 * const entry: AutoImport = {
 *   name: 'usePhysics2D',
 *   from: '@gwenjs/physics2d',
 *   as: 'usePhysics',
 * }
 * ```
 *
 * @since 1.0.0
 */
export interface AutoImport {
  /** The exported name from the source module */
  name: string;
  /** The npm package or path to import from */
  from: string;
  /** Override the name used in auto-import (default: same as `name`) */
  as?: string;
}

// ─── GwenTypeTemplate ─────────────────────────────────────────────────────────

/**
 * A type template that generates a `.d.ts` file inside the `.gwen/` directory.
 *
 * Called during `gwen prepare` to produce declaration files that power IDE
 * auto-complete and type checking for game code that relies on services or hooks
 * added by a GWEN module.
 *
 * @example
 * ```ts
 * import type { GwenTypeTemplate } from '@gwenjs/kit'
 *
 * const template: GwenTypeTemplate = {
 *   filename: 'types/physics2d.d.ts',
 *   getContents() {
 *     return `declare module '@gwenjs/core' {
 *       interface GwenProvides { physics2d: Physics2DAPI }
 *     }`
 *   },
 * }
 * ```
 *
 * @since 1.0.0
 */
export interface GwenTypeTemplate {
  /** Relative path inside `.gwen/`, e.g. `'types/physics2d.d.ts'` */
  filename: string;
  /** Called during `gwen prepare` to get the file content. */
  getContents(): string;
}

// ─── VitePlugin / ViteUserConfig stubs (keep tree-shakeable) ─────────────────

// We don't import from Vite directly — these are intentionally generic
// so that @gwenjs/kit stays isomorphic (browser + Node.js).

/**
 * Minimal Vite plugin shape, compatible with Vite's `Plugin` type.
 *
 * Typed as `Record<string, unknown>` so that `@gwenjs/kit` remains
 * isomorphic (usable in both browser and Node.js contexts) without a
 * hard dependency on the `vite` package.
 *
 * @example
 * ```ts
 * import type { VitePlugin } from '@gwenjs/kit'
 *
 * function myVitePlugin(): VitePlugin {
 *   return { name: 'my-gwen-vite-plugin', transform(code) { return code } }
 * }
 * ```
 *
 * @since 1.0.0
 */
export type VitePlugin = Record<string, unknown>;

/**
 * Minimal Vite user config shape, compatible with Vite's `UserConfig` type.
 *
 * Typed as `Record<string, unknown>` so that `@gwenjs/kit` remains
 * isomorphic without a direct Vite dependency. Passed to `extendViteConfig`
 * in {@link GwenKit}.
 *
 * @example
 * ```ts
 * import type { ViteUserConfig } from '@gwenjs/kit'
 *
 * const overrides: ViteUserConfig = {
 *   resolve: { alias: { '~assets': './src/assets' } },
 * }
 * ```
 *
 * @since 1.0.0
 */
export type ViteUserConfig = Record<string, unknown>;

// ─── GwenBuildHooks ──────────────────────────────────────────────────────────

/**
 * Build-time hook map for the GWEN framework.
 *
 * Only available in Node.js context (CLI, Vite build).
 * Declared in `@gwenjs/kit` so that `defineGwenModule()` can reference it
 * without a circular dependency. Re-exported by `@gwenjs/app`.
 *
 * @example
 * ```typescript
 * defineGwenModule({
 *   meta: { name: 'my-module' },
 *   setup(_opts, gwen) {
 *     gwen.hook('build:done', () => console.log('Build complete'))
 *   }
 * })
 * ```
 *
 * @since 1.0.0
 */
export interface GwenBuildHooks {
  /** Fired before any module setup runs. */
  'build:before': () => void;
  /** Fired after all module setup is complete. */
  'build:done': () => void;
  /** Fired before each module's `setup()` runs. */
  'module:before': (mod: { meta: { name: string } }) => void;
  /** Fired after each module's `setup()` completes. */
  'module:done': (mod: { meta: { name: string } }) => void;
  /** Fired by each module when it extends the Vite config. */
  'vite:extendConfig': (config: ViteUserConfig) => void;
}

// ─── GwenBaseConfig ──────────────────────────────────────────────────────────

/**
 * Minimal resolved config shape passed to module `setup()` via `GwenKit.options`.
 *
 * Extended by `ResolvedGwenConfig` in `@gwenjs/app` with full field types.
 * When writing a module, access these fields through `gwen.options` rather
 * than importing this type directly.
 *
 * @example
 * ```ts
 * import type { GwenBaseConfig } from '@gwenjs/kit'
 *
 * function getTargetFPS(config: GwenBaseConfig): number {
 *   return config.engine?.targetFPS ?? 60
 * }
 * ```
 *
 * @since 1.0.0
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

// ─── GwenKit ─────────────────────────────────────────────────────────────────

/**
 * The build-time API provided to module `setup()` functions.
 *
 * Available only during `gwen dev`, `gwen build`, and `gwen prepare` (Node.js context).
 * Not available at runtime in the browser.
 *
 * @example
 * ```typescript
 * defineGwenModule({
 *   meta: { name: '@gwenjs/physics2d' },
 *   setup(options, gwen) {
 *     gwen.addPlugin(createPhysics2DPlugin(options))
 *     gwen.addAutoImports([{ name: 'usePhysics2D', from: '@gwenjs/physics2d' }])
 *   }
 * })
 * ```
 *
 * @since 1.0.0
 */
export interface GwenKit {
  /**
   * Registers a runtime plugin to be loaded when the engine starts.
   *
   * @param plugin - A plugin instance, factory function, or module path string.
   * @example
   * gwen.addPlugin(createPhysics2DPlugin(options))
   */
  addPlugin(plugin: GwenPlugin | (() => GwenPlugin)): void;

  /**
   * Registers composables or utilities for auto-import.
   * The `@gwenjs/vite` plugin generates a virtual module from these declarations.
   *
   * @param imports - Array of auto-import declarations.
   * @example
   * gwen.addAutoImports([
   *   { name: 'usePhysics2D', from: '@gwenjs/physics2d' },
   *   { name: 'useRigidBody', from: '@gwenjs/physics2d', as: 'useBody' },
   * ])
   */
  addAutoImports(imports: AutoImport[]): void;

  /**
   * Adds a Vite plugin to the build pipeline.
   * Plugins added by modules are inserted before the user's `vite.plugins` array.
   *
   * @param plugin - Any Vite-compatible plugin object.
   */
  addVitePlugin(plugin: VitePlugin): void;

  /**
   * Extends the Vite user config. The extender function receives the current
   * config and must return a partial config to be merged (using `defu`).
   *
   * @param extender - Function that receives the current config and returns overrides.
   * @example
   * gwen.extendViteConfig(config => ({
   *   resolve: { alias: { '~assets': './src/assets' } }
   * }))
   */
  extendViteConfig(extender: (config: ViteUserConfig) => Partial<ViteUserConfig>): void;

  /**
   * Registers a type template. The template's `getContents()` is called during
   * `gwen prepare` to generate a `.d.ts` file inside the `.gwen/` directory.
   *
   * @param template - Template definition with filename and content factory.
   * @example
   * gwen.addTypeTemplate({
   *   filename: 'types/physics2d.d.ts',
   *   getContents: () => `declare module '@gwenjs/core' { ... }`
   * })
   */
  addTypeTemplate(template: GwenTypeTemplate): void;

  /**
   * Registers a TypeScript snippet to be aggregated into
   * `.gwen/types/module-augments.d.ts` during `gwen prepare`.
   *
   * Use this to extend `GwenProvides` or `GwenRuntimeHooks` from a module
   * without creating a separate type-template file.
   *
   * @param snippet - A valid TypeScript declaration string (e.g. `declare module '...' { ... }`).
   * @example
   * gwen.addModuleAugment(`
   *   declare module '@gwenjs/core' {
   *     interface GwenProvides { myService: MyServiceAPI }
   *   }
   * `)
   */
  addModuleAugment(snippet: string): void;

  /**
   * Subscribes to a build-time hook.
   *
   * @param event - A `GwenBuildHooks` event name.
   * @param fn - Handler function matching the hook signature.
   */
  hook<H extends keyof GwenBuildHooks>(event: H, fn: GwenBuildHooks[H]): void;

  /** The fully resolved and merged `gwen.config.ts` options. */
  readonly options: GwenBaseConfig;
}

// ─── GwenModuleDefinition ─────────────────────────────────────────────────────

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
 * import type { GwenModuleDefinition } from '@gwenjs/kit'
 *
 * interface MyOptions { debug?: boolean }
 *
 * const definition: GwenModuleDefinition<MyOptions> = {
 *   meta: { name: '@my-scope/gwen-module', configKey: 'myModule' },
 *   defaults: { debug: false },
 *   setup(options, gwen) { /* ... *\/ },
 * }
 * ```
 *
 * @since 1.0.0
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
    /** Semver version string. */
    version?: string;
  };

  /**
   * Default option values.
   * Merged with user config using `defu` (deep defaults — user values take precedence).
   */
  defaults?: DeepPartial<Options>;

  /**
   * Build-time setup function. Runs in Node.js during `gwen dev`, `gwen build`, or `gwen prepare`.
   *
   * Use the `GwenKit` argument to register plugins, auto-imports, Vite plugins, and type templates.
   *
   * @param options - Resolved module options (user values merged with `defaults`).
   * @param gwen - The build-time kit API.
   */
  setup(options: Options, gwen: GwenKit): void | Promise<void>;
}

/**
 * A resolved GWEN module instance returned by `defineGwenModule()`.
 *
 * Structurally identical to `GwenModuleDefinition` — the type alias exists
 * to distinguish a definition object that has been validated and returned from
 * the factory from a raw definition literal.
 *
 * @template Options - The typed options shape this module accepts.
 *
 * @since 1.0.0
 */
export type GwenModule<Options extends object = Record<string, unknown>> =
  GwenModuleDefinition<Options>;

// ─── defineGwenModule ────────────────────────────────────────────────────────

/**
 * Defines a GWEN module — a build-time extension that registers runtime plugins,
 * auto-imports, Vite extensions, and type templates.
 *
 * Modules run in Node.js during `gwen dev`, `gwen build`, or `gwen prepare`.
 * They are the primary way to add capabilities to a GWEN project.
 *
 * @template Options - The typed options shape this module accepts.
 * @param definition - The module definition object containing metadata,
 *   defaults, and the `setup` function.
 * @returns A resolved `GwenModule` ready for use in `gwen.config.ts`.
 *
 * @example
 * ```typescript
 * export default defineGwenModule<Physics2DOptions>({
 *   meta: { name: '@gwenjs/physics2d', configKey: 'physics2d' },
 *   defaults: { gravity: 9.81, iterations: 8 },
 *   async setup(options, gwen) {
 *     gwen.addPlugin(createPhysics2DPlugin(options))
 *     gwen.addAutoImports([{ name: 'usePhysics2D', from: '@gwenjs/physics2d' }])
 *     gwen.addTypeTemplate({
 *       filename: 'types/physics2d.d.ts',
 *       getContents: () => `declare module '@gwenjs/core' { ... }`
 *     })
 *   }
 * })
 * ```
 *
 * @since 1.0.0
 */
export function defineGwenModule<Options extends object = Record<string, unknown>>(
  definition: GwenModuleDefinition<Options>,
): GwenModule<Options> {
  return definition as GwenModule<Options>;
}
