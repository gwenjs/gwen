/**
 * @file RFC-004 — GwenApp orchestrator class
 *
 * GwenApp collects registrations from modules (plugins, auto-imports,
 * Vite plugins, type templates) and fires build-time hooks via `hookable`.
 *
 * @internal — not part of the public API surface. Use `@gwenjs/app` exports.
 */

import type { GwenPlugin } from '@gwenjs/kit';
import type {
  GwenModule,
  GwenKit,
  AutoImport,
  GwenTypeTemplate,
  VitePlugin,
  ViteUserConfig,
  GwenBuildHooks,
} from '@gwenjs/kit';
import { createHooks } from 'hookable';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import type { ResolvedGwenConfig } from './config';

// ─── GwenApp ──────────────────────────────────────────────────────────────────

/**
 * Internal orchestrator that runs module setup and accumulates build-time
 * registrations (plugins, auto-imports, Vite extensions, type templates).
 *
 * Instantiate once per build and call {@link GwenApp.setupModules} to process
 * the project configuration.
 *
 * @internal
 *
 * @example
 * ```typescript
 * const app = new GwenApp()
 * await app.setupModules(resolvedConfig)
 * const viteConfig = app.resolveViteConfig({ root: './src' })
 * ```
 */
export class GwenApp {
  private readonly _plugins: GwenPlugin[] = [];
  private readonly _autoImports: AutoImport[] = [];
  private readonly _vitePlugins: VitePlugin[] = [];
  private readonly _viteConfigExtenders: Array<(c: ViteUserConfig) => Partial<ViteUserConfig>> = [];
  private readonly _typeTemplates: GwenTypeTemplate[] = [];
  /** Collected module-augmentation snippets (e.g. `GwenProvides` / `GwenRuntimeHooks` extensions). */
  private readonly _moduleAugments: string[] = [];

  /**
   * Build-time hook bus. Subscribe with `app.buildHooks.hook(event, fn)` or
   * call hooks with `app.buildHooks.callHook(event, ...args)`.
   */
  readonly buildHooks = createHooks<GwenBuildHooks>();

  // ── Getters (defensive copies) ──────────────────────────────────────────────

  /**
   * Returns a snapshot of all runtime plugins registered by modules.
   * Each call returns a fresh array — safe to mutate.
   */
  get plugins(): GwenPlugin[] {
    return [...this._plugins];
  }

  /**
   * Returns a snapshot of all auto-import declarations registered by modules.
   * Each call returns a fresh array — safe to mutate.
   */
  get autoImports(): AutoImport[] {
    return [...this._autoImports];
  }

  /**
   * Returns a snapshot of all Vite plugins registered by modules.
   * Each call returns a fresh array — safe to mutate.
   */
  get vitePlugins(): VitePlugin[] {
    return [...this._vitePlugins];
  }

  /**
   * Returns a snapshot of all type templates registered by modules.
   * Each call returns a fresh array — safe to mutate.
   */
  get typeTemplates(): GwenTypeTemplate[] {
    return [...this._typeTemplates];
  }

  // ── setupModules ─────────────────────────────────────────────────────────────

  /**
   * Processes all modules listed in the resolved config.
   *
   * For each module entry:
   * 1. Resolves the module (via `moduleLoader` or dynamic `import()`).
   * 2. Deep-merges user options with module defaults (user values win).
   * 3. Fires `module:before`, calls `mod.setup(options, kit)`, fires `module:done`.
   *
   * Hook firing order:
   * `build:before` → (`module:before` → `mod.setup` → `module:done`) × N → `build:done`
   *
   * @param config - Fully resolved project configuration.
   * @param moduleLoader - Optional loader for test injection / CLI override.
   *   Receives the module name string and must return a `GwenModule`.
   *
   * @throws {Error} If a module cannot be resolved or has no `setup` function.
   *
   * @example
   * ```typescript
   * const app = new GwenApp()
   * await app.setupModules(config)
   * ```
   */
  async setupModules(
    config: ResolvedGwenConfig,
    moduleLoader?: (name: string) => Promise<GwenModule>,
  ): Promise<void> {
    await this.buildHooks.callHook('build:before');

    for (const entry of config.modules ?? []) {
      const [name, userOptions = {}] = Array.isArray(entry)
        ? entry
        : [entry, {} as Record<string, unknown>];

      let mod: GwenModule;
      try {
        mod = moduleLoader ? await moduleLoader(name) : await loadModule(name);
      } catch (cause) {
        const hint =
          cause instanceof Error && cause.message.includes('Cannot find package')
            ? ` Hint: run 'gwen add ${name}' to install it.`
            : '';
        throw new Error(
          `[gwen] Failed to load module "${name}": ${cause instanceof Error ? cause.message : String(cause)}.${hint}`,
          { cause },
        );
      }

      // Deep-merge user options with module defaults (user values take precedence).
      const options = mergeDefaults(
        userOptions as Record<string, unknown>,
        (mod.defaults ?? {}) as Record<string, unknown>,
      );

      const kit = this._createKit(config);

      await this.buildHooks.callHook('module:before', mod);
      try {
        await mod.setup(options as Record<string, unknown>, kit);
      } catch (cause) {
        throw new Error(
          `[gwen] Module "${name}" setup() threw: ${cause instanceof Error ? cause.message : String(cause)}`,
          { cause },
        );
      }
      await this.buildHooks.callHook('module:done', mod);
    }

    // Apply the user's direct `vite` config extension last.
    if (config.vite) {
      this._viteConfigExtenders.push(() => config.vite as Partial<ViteUserConfig>);
    }

    await this.buildHooks.callHook('build:done');
  }

  // ── prepare ──────────────────────────────────────────────────────────────────

  /**
   * Writes the `.gwen/` directory with all generated type declarations.
   *
   * Creates:
   * - `.gwen/types/auto-imports.d.ts` — global stubs for auto-imported composables
   * - `.gwen/types/env.d.ts` — `virtual:gwen/*` module types
   * - `.gwen/types/<filename>` — per-module type templates (from `addTypeTemplate`)
   * - `.gwen/tsconfig.json` — TypeScript project config referencing all generated types
   *
   * Idempotent: uses `writeIfChanged` so unchanged files are not rewritten
   * (prevents unnecessary TypeScript re-checks in watch mode).
   *
   * @param rootDir - Project root directory. Defaults to `process.cwd()`.
   *
   * @example
   * ```typescript
   * const app = new GwenApp()
   * await app.setupModules(config)
   * await app.prepare()
   * // → .gwen/types/auto-imports.d.ts written
   * ```
   */
  async prepare(rootDir: string = process.cwd()): Promise<void> {
    const gwenDir = resolve(rootDir, '.gwen');
    const typesDir = join(gwenDir, 'types');

    mkdirSync(typesDir, { recursive: true });

    // 1. auto-imports.d.ts
    writeIfChanged(join(typesDir, 'auto-imports.d.ts'), generateAutoImportsDts(this._autoImports));

    // 2. per-module type templates
    for (const template of this._typeTemplates) {
      const dest = join(typesDir, template.filename);
      // Ensure sub-directories exist (e.g. 'types/physics2d.d.ts')
      mkdirSync(join(dest, '..'), { recursive: true });
      writeIfChanged(dest, template.getContents());
    }

    // 3. env.d.ts
    writeIfChanged(join(typesDir, 'env.d.ts'), GWEN_ENV_DTS);

    // 4. module-augments.d.ts — collected GwenProvides / GwenRuntimeHooks augmentations
    writeIfChanged(
      join(typesDir, 'module-augments.d.ts'),
      generateModuleAugmentsDts(this._moduleAugments),
    );

    // 5. .gwen/tsconfig.json
    writeIfChanged(join(gwenDir, 'tsconfig.json'), generateGwenTsConfig());
  }

  // ── resolveViteConfig ────────────────────────────────────────────────────────

  /**
   * Applies all Vite config extenders collected from modules (and the root
   * `vite` key in `gwen.config.ts`) on top of the provided base config.
   *
   * Extenders are applied in registration order (first registered, first applied).
   * Each extender receives the accumulated config from previous extenders.
   *
   * @param base - The starting Vite config (e.g. from `vite.config.ts`).
   * @returns A new merged Vite config object.
   *
   * @example
   * ```typescript
   * const viteConfig = app.resolveViteConfig({ root: './src', plugins: [] })
   * ```
   */
  resolveViteConfig(base: ViteUserConfig): ViteUserConfig {
    return this._viteConfigExtenders.reduce((cfg, fn) => ({ ...cfg, ...fn(cfg) }), base);
  }

  // ── _createKit ───────────────────────────────────────────────────────────────

  /**
   * Constructs a {@link GwenKit} bound to this `GwenApp` instance.
   * Called once per module so each module gets a fresh kit reference
   * (while sharing the same underlying collections on `this`).
   *
   * @param config - The resolved project config exposed via `kit.options`.
   * @returns A GwenKit implementation.
   */
  private _createKit(config: ResolvedGwenConfig): GwenKit {
    // Capture `this` as `app` to keep the closure readable.
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const app = this;

    return {
      /**
       * Registers a runtime plugin. Accepts a plugin instance or a zero-arg
       * factory function that returns a plugin instance.
       */
      addPlugin(plugin: GwenPlugin | (() => GwenPlugin)): void {
        app._plugins.push(typeof plugin === 'function' ? plugin() : plugin);
      },

      /** Registers composables/utilities for auto-import. */
      addAutoImports(imports: AutoImport[]): void {
        app._autoImports.push(...imports);
      },

      /** Adds a Vite-compatible plugin to the build pipeline. */
      addVitePlugin(plugin: VitePlugin): void {
        app._vitePlugins.push(plugin);
      },

      /** Queues a Vite config extender function. */
      extendViteConfig(extender: (c: ViteUserConfig) => Partial<ViteUserConfig>): void {
        app._viteConfigExtenders.push(extender);
      },

      /** Registers a type template for `gwen prepare`. */
      addTypeTemplate(template: GwenTypeTemplate): void {
        app._typeTemplates.push(template);
      },

      /**
       * Registers a TypeScript snippet that will be aggregated into
       * `.gwen/types/module-augments.d.ts`.  Use this to extend
       * `GwenProvides` or `GwenRuntimeHooks` from a module.
       *
       * @example
       * ```typescript
       * kit.addModuleAugment(`
       *   declare module '@gwenjs/core' {
       *     interface GwenProvides { physics2d: Physics2DAPI }
       *   }
       * `)
       * ```
       */
      addModuleAugment(snippet: string): void {
        app._moduleAugments.push(snippet);
      },

      /** Subscribes to a build-time hook. */
      hook<H extends keyof GwenBuildHooks>(event: H, fn: GwenBuildHooks[H]): void {
        // TypeScript cannot fully preserve Hookable's callback inference when
        // forwarding a generic event key through this wrapper method.
        // `as never` is a local escape hatch that keeps strict typing at the
        // call sites while avoiding a broad `any` cast in framework internals.
        app.buildHooks.hook(event, fn as never);
      },

      /** The fully resolved project config. */
      get options() {
        return config;
      },
    };
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Deep-merges `user` values on top of `defaults`.
 * User values always take precedence; plain objects are merged recursively.
 * Arrays and primitive values from `user` replace the default entirely.
 *
 * @param user - User-supplied values (higher priority).
 * @param defaults - Default values (lower priority).
 * @returns A new merged object.
 */
function mergeDefaults(
  user: Record<string, unknown>,
  defaults: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...defaults };

  for (const key of Object.keys(user)) {
    const userVal = user[key];
    const defaultVal = defaults[key];

    if (
      typeof userVal === 'object' &&
      userVal !== null &&
      !Array.isArray(userVal) &&
      typeof defaultVal === 'object' &&
      defaultVal !== null &&
      !Array.isArray(defaultVal)
    ) {
      result[key] = mergeDefaults(
        userVal as Record<string, unknown>,
        defaultVal as Record<string, unknown>,
      );
    } else {
      result[key] = userVal;
    }
  }

  return result;
}

/**
 * Dynamically imports a module by name.
 * Works in Node.js environments with standard ESM or via `jiti` in the CLI.
 *
 * @param name - The npm package name or file path to import.
 * @returns The resolved `GwenModule` exported as `default` or as the module object.
 *
 * @throws {Error} `[GWEN] Module "${name}" does not export a valid GwenModule`
 *   if the imported value has no `setup` function.
 */
async function loadModule(name: string): Promise<GwenModule> {
  const imported = (await import(/* @vite-ignore */ name)) as { default?: unknown } & Record<
    string,
    unknown
  >;
  const definition: unknown = imported.default ?? imported;

  if (!definition || typeof (definition as Record<string, unknown>)['setup'] !== 'function') {
    throw new Error(
      `[GWEN] Module "${name}" does not export a valid GwenModule (missing setup function). ` +
        `Ensure the module exports a default object created with defineGwenModule().`,
    );
  }

  return definition as GwenModule;
}

// ─── RFC-010: .gwen/ generation helpers ──────────────────────────────────────

/**
 * Writes `content` to `filePath` only if the file does not already contain
 * identical content. Prevents unnecessary disk writes in watch mode.
 *
 * @param filePath - Absolute path to write.
 * @param content  - String content to write.
 */
function writeIfChanged(filePath: string, content: string): void {
  if (existsSync(filePath)) {
    const current = readFileSync(filePath, 'utf8');
    if (current === content) return;
  }
  writeFileSync(filePath, content, 'utf8');
}

/**
 * Generates `auto-imports.d.ts` declaring each auto-imported composable
 * as a global `const` function so the IDE and `tsc` see it without an import.
 *
 * @param imports - Auto-import declarations collected from all modules.
 */
function generateAutoImportsDts(imports: AutoImport[]): string {
  if (imports.length === 0) {
    return '// Generated by gwen prepare — do not edit\n// No auto-imports registered.\nexport {};\n';
  }

  const lines: string[] = [
    '// Generated by gwen prepare — do not edit',
    '// Auto-imported composables — available globally without an explicit import.',
    '',
  ];

  for (const { name, from, as } of imports) {
    const localName = as ?? name;
    lines.push(`// from: ${from}`);
    lines.push(`declare const ${localName}: typeof import('${from}')['${name}'];`);
  }

  lines.push('');
  return lines.join('\n');
}

/** Virtual module type declarations written to `.gwen/types/env.d.ts`. */
const GWEN_ENV_DTS = `// Generated by gwen prepare — do not edit
// Virtual module type declarations for @gwenjs/* virtual imports.
// Reference vite/client so import.meta.env is available in playground source files.
/// <reference types="vite/client" />

declare module 'virtual:gwen/wasm' {
  /** URL pointing to the compiled WASM binary for the active variant. */
  const wasmUrl: string;
  export { wasmUrl };
}

declare module 'virtual:gwen/env' {
  /** Current GWEN version string. */
  const GWEN_VERSION: string;
  /** Active WASM variant: 'light' | 'physics2d' | 'physics3d'. */
  const GWEN_WASM_VARIANT: 'light' | 'physics2d' | 'physics3d';
  /** Whether the build is running in development mode. */
  const GWEN_DEV: boolean;
  export { GWEN_VERSION, GWEN_WASM_VARIANT, GWEN_DEV };
}

declare module 'virtual:gwen/auto-imports' {
  /** Re-exports all composables registered via gwen.addAutoImports(). */
  const autoImports: Record<string, unknown>;
  export default autoImports;
}
`;

/**
 * Generates the `.gwen/tsconfig.json` content.
 *
 * This file is standalone — it does NOT extend a project-level tsconfig.base.json
 * because that file may not exist (e.g. in standalone projects or playgrounds).
 * All compiler options required for GWEN TypeScript development are embedded here.
 *
 * The project root `tsconfig.json` (created/patched by gwen prepare) extends this
 * file and may add project-specific overrides on top.
 */
function generateGwenTsConfig(): string {
  return (
    JSON.stringify(
      {
        $schema: 'https://json.schemastore.org/tsconfig',
        _comment: 'Generated by gwen prepare — do not edit',
        compilerOptions: {
          // TypeScript 6 compat
          ignoreDeprecations: '6.0',
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'bundler',
          lib: ['ES2022', 'DOM', 'DOM.Iterable'],
          strict: true,
          verbatimModuleSyntax: true,
          isolatedModules: true,
          noEmit: true,
          // Allow incomplete type declarations in dependencies
          skipLibCheck: true,
        },
        include: ['../src/**/*.ts', '../*.ts', 'types/**/*.d.ts'],
      },
      null,
      2,
    ) + '\n'
  );
}

/**
 * Generates `.gwen/types/module-augments.d.ts` which aggregates all
 * `GwenProvides` / `GwenRuntimeHooks` augmentations registered by modules
 * via `kit.addModuleAugment(snippet)`.
 *
 * @param snippets - TypeScript declaration snippets collected from all modules.
 */
function generateModuleAugmentsDts(snippets: string[]): string {
  const header = [
    '// Generated by gwen prepare — do not edit',
    '// Aggregated GwenProvides / GwenRuntimeHooks module augmentations.',
    '',
  ];

  if (snippets.length === 0) {
    return [...header, 'export {};\n'].join('\n');
  }

  return [...header, ...snippets.map((s) => s.trim()), '', 'export {};\n'].join('\n');
}
