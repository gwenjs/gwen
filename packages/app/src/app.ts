/**
 * @file RFC-004 — GwenApp orchestrator class
 *
 * GwenApp collects registrations from modules (plugins, auto-imports,
 * Vite plugins) and fires build-time hooks via `hookable`.
 *
 * @internal — not part of the public API surface. Use `@gwenjs/app` exports.
 */

import type { GwenPlugin, PluginDeclaration } from "@gwenjs/schema";
import type { AutoImport, VitePlugin, ViteUserConfig } from "@gwenjs/kit";
import type { GwenModule, GwenKit, GwenBuildHooks } from "@gwenjs/kit/module";
import { createHooks } from "hookable";
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { readConfigFile, type ResolvedGwenConfig } from "./config";
import { GwenAppConfigError } from "./config-error";
import { isPlainRecord, mergeLayers, recordOf } from "./merge";
import { createViewportsPlugin } from "./viewports-plugin";
import { createScreenPlugin } from "./create-screen-plugin";
import { BUILT_IN_MODULES } from "./built-in-modules";
import { GwenError } from "@gwenjs/schema";
import { formatReceived, type GwenBaseConfig, type GwenConfigIssue } from "@gwenjs/schema";
import { AppErrorCodes, causeText } from "./error-codes";

// ─── Constants ─────────────────────────────────────────────────────────────────

/** Keys reserved by GwenUserConfig — must not be used as module configKey. */
const RESERVED_KEYS = new Set([
  "modules",
  "engine",
  "logger",
  "vite",
  "hooks",
  "plugins",
  "viewports",
  "screen",
  "globalCss",
  "localPluginsDir",
  "localModulesDir",
  "mainScene",
]);

// ─── GwenApp ──────────────────────────────────────────────────────────────────

/**
 * Internal orchestrator that runs module setup and accumulates build-time
 * registrations (plugins, auto-imports, Vite extensions).
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
  /** Collected path-based plugin declarations (used by @gwenjs/vite for static imports). */
  private readonly _pluginDeclarations: PluginDeclaration[] = [];

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
   * Returns a snapshot of all path-based plugin declarations registered by modules.
   * Each call returns a fresh array — safe to mutate.
   */
  get pluginDeclarations(): PluginDeclaration[] {
    return [...this._pluginDeclarations];
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
   * @throws {GwenError} If a module cannot be resolved or has no `setup` function.
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
    const loaded: LoadedModule[] = [];
    for (const name of config.modules ?? []) {
      let mod: GwenModule;
      try {
        mod = moduleLoader ? await moduleLoader(name) : await loadModule(name);
      } catch (cause) {
        if (cause instanceof GwenError && cause.code === AppErrorCodes.MODULE_LOAD_FAILED) {
          throw cause;
        }
        const hint =
          cause instanceof Error && cause.message.includes("Cannot find package")
            ? ` Hint: run 'gwen add ${name}' to install it.`
            : "";
        throw new GwenError(
          AppErrorCodes.MODULE_LOAD_FAILED,
          `Failed to load module "${name}": ${causeText(cause)}${hint}`,
          { cause },
        );
      }
      loaded.push({ name, mod });
    }

    const prepared = prepareModules(config, loaded);
    if (prepared.issues.length > 0) {
      throw new GwenAppConfigError(readConfigFile(config), prepared.issues);
    }

    await this.buildHooks.callHook("build:before");

    for (const run of prepared.builtIn) {
      await this.runSetup(config, run.mod, run.options, `Built-in module "${run.mod.meta.name}"`);
    }

    // 2. viewports + screen plugins (existing code, unchanged)
    // Register the viewports plugin first so it runs before camera/renderer plugins.
    // This ensures ViewportManager is populated by engine:init, when camera systems
    // expect viewports to already exist.
    // Replace if already registered (idempotent for watch-mode / multi-call scenarios).
    const viewportsPlugin = createViewportsPlugin(config.viewports);
    const existingIndex = this._plugins.findIndex((plugin) => plugin.name === "gwen:viewports");
    if (existingIndex >= 0) {
      this._plugins[existingIndex] = viewportsPlugin;
    } else {
      this._plugins.unshift(viewportsPlugin);
    }
    // Register the screen plugin after gwen:viewports so ViewportManager exists.
    const screenPlugin = createScreenPlugin(config.screen);
    const existingScreenIndex = this._plugins.findIndex((plugin) => plugin.name === "gwen:screen");
    if (existingScreenIndex >= 0) {
      this._plugins[existingScreenIndex] = screenPlugin;
    } else {
      // Insert after gwen:viewports (index 1 if viewports is at 0, otherwise append near start)
      const viewportsIndex = this._plugins.findIndex((p) => p.name === "gwen:viewports");
      this._plugins.splice(viewportsIndex + 1, 0, screenPlugin);
    }

    for (const run of prepared.users) {
      await this.runSetup(config, run.mod, run.options, `Module "${run.label}"`);
    }

    // Apply the user's direct `vite` config extension last.
    if (config.vite) {
      this._viteConfigExtenders.push(() => config.vite as Partial<ViteUserConfig>);
    }

    this._autoImports.push({ name: "useScreen", from: "@gwenjs/renderer-core" });

    await this.buildHooks.callHook("build:done");
  }

  // ── prepare ──────────────────────────────────────────────────────────────────

  /**
   * Writes the `.gwen/` directory with all generated type declarations.
   *
   * Creates:
   * - `.gwen/types/auto-imports.d.ts` — global stubs for auto-imported composables
   * - `.gwen/types/env.d.ts` — `virtual:gwen/*` module types
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
    const gwenDir = resolve(rootDir, ".gwen");
    const typesDir = join(gwenDir, "types");

    mkdirSync(typesDir, { recursive: true });

    // 1. auto-imports.d.ts
    writeIfChanged(join(typesDir, "auto-imports.d.ts"), generateAutoImportsDts(this._autoImports));

    // 2. env.d.ts
    writeIfChanged(join(typesDir, "env.d.ts"), GWEN_ENV_DTS);

    // 3. .gwen/tsconfig.json
    writeIfChanged(join(gwenDir, "tsconfig.json"), generateGwenTsConfig());
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
      addPlugin(plugin: GwenPlugin | (() => GwenPlugin) | PluginDeclaration): void {
        if (typeof plugin === "function") {
          app._plugins.push(plugin());
        } else if ("src" in plugin) {
          app._pluginDeclarations.push(plugin as PluginDeclaration);
        } else {
          app._plugins.push(plugin as GwenPlugin);
        }
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

      /** Subscribes to a build-time hook. */
      hook<H extends string & keyof GwenBuildHooks>(event: H, fn: GwenBuildHooks[H]): void {
        // TypeScript cannot fully preserve Hookable's callback inference when
        // forwarding a generic event key through this wrapper method.
        // `as never` is a local escape hatch that keeps strict typing at the
        // call sites while avoiding a broad `any` cast in framework internals.
        app.buildHooks.hook(event, fn as never);
      },

      get options(): GwenBaseConfig {
        return Object.freeze({ ...config }) as GwenBaseConfig;
      },
    };
  }

  private async runSetup(
    config: ResolvedGwenConfig,
    mod: GwenModule,
    options: Record<string, unknown>,
    label: string,
  ) {
    const kit = this._createKit(config);
    await this.buildHooks.callHook("module:before", mod);
    try {
      await mod.setup(options, kit);
    } catch (cause) {
      throw new GwenError(
        AppErrorCodes.MODULE_SETUP_FAILED,
        `${label} setup() threw: ${causeText(cause)}`,
        { cause },
      );
    }
    await this.buildHooks.callHook("module:done", mod);
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

interface LoadedModule {
  name: string;
  mod: GwenModule;
}
interface ModuleRun {
  mod: GwenModule;
  options: Record<string, unknown>;
  label: string;
}

function configIssue(
  path: string,
  expected: string,
  received: string,
  owner: string,
  conflictsWith?: string,
): GwenConfigIssue {
  if (conflictsWith === undefined) return { path, expected, received, owner };
  return { path, expected, received, owner, conflictsWith };
}

function prepareModules(config: ResolvedGwenConfig, loaded: readonly LoadedModule[]) {
  const record = recordOf(config);
  const all: LoadedModule[] = [
    ...BUILT_IN_MODULES.map((mod) => ({ name: mod.meta.name, mod })),
    ...loaded,
  ];
  const owners = new Map<string, string>();
  for (const { mod } of all) {
    const key = mod.meta.configKey;
    if (key && !RESERVED_KEYS.has(key) && !owners.has(key)) owners.set(key, mod.meta.name);
  }
  const issues: GwenConfigIssue[] = [];
  for (const key of Object.keys(record)) {
    if (RESERVED_KEYS.has(key) || owners.has(key)) continue;
    issues.push(
      configIssue(key, "a known top-level key", formatReceived(record[key]), "@gwenjs/app"),
    );
  }
  for (const { mod } of all) {
    const key = mod.meta.configKey;
    if (!key) continue;
    const name = mod.meta.name;
    const first = owners.get(key);
    let issue: GwenConfigIssue | undefined;
    if (RESERVED_KEYS.has(key)) {
      issue = configIssue(
        key,
        "a configKey that is not reserved by gwen.config",
        `"${key}" declared by module "${name}"`,
        name,
        "@gwenjs/app",
      );
    } else if (first !== undefined && first !== name) {
      issue = configIssue(
        key,
        "a configKey owned by one module",
        `declared by "${first}" and "${name}"`,
        name,
        first,
      );
    }
    if (issue !== undefined) issues.push(issue);
  }
  const builtIn: ModuleRun[] = [];
  const users: ModuleRun[] = [];
  for (const entry of all) {
    const run = resolveModuleRun(entry, record, owners, issues);
    if (BUILT_IN_MODULES.includes(entry.mod)) builtIn.push(run);
    else users.push({ ...run, label: entry.name });
  }
  return { issues, builtIn, users };
}

function resolveModuleRun(
  entry: LoadedModule,
  record: Record<string, unknown>,
  owners: ReadonlyMap<string, string>,
  issues: GwenConfigIssue[],
): ModuleRun {
  const { mod } = entry;
  const key = mod.meta.configKey;
  const defaults = mod.defaults ?? {};
  const owned = key !== undefined && owners.get(key) === mod.meta.name;
  const user = owned ? record[key] : undefined;
  const defaultsRecord = isPlainRecord(defaults) ? defaults : {};
  const merged =
    user === undefined || isPlainRecord(user)
      ? mergeLayers(defaultsRecord, isPlainRecord(user) ? user : {})
      : user;
  const options = isPlainRecord(merged) ? merged : {};
  if (owned && key !== undefined) {
    pushSerializable(merged, defaults, key, mod.meta.name, issues);
    if (isPlainRecord(merged) && mod.validate) {
      for (const item of mod.validate(merged)) {
        const path = item.path.length === 0 ? key : `${key}.${item.path}`;
        issues.push(
          configIssue(path, item.expected, item.received, mod.meta.name, item.conflictsWith),
        );
      }
    }
  }
  return { mod, options, label: mod.meta.name };
}

function pushSerializable(
  value: unknown,
  fallback: unknown,
  path: string,
  owner: string,
  issues: GwenConfigIssue[],
): void {
  if (value === undefined || Object.is(value, fallback)) return;
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    const items = Array.isArray(fallback) ? fallback : [];
    for (let index = 0; index < value.length; index += 1) {
      pushSerializable(value[index], items[index], `${path}.${index}`, owner, issues);
    }
    return;
  }
  if (isPlainRecord(value)) {
    const base = isPlainRecord(fallback) ? fallback : {};
    for (const child of Object.keys(value)) {
      pushSerializable(value[child], base[child], `${path}.${child}`, owner, issues);
    }
    return;
  }
  issues.push(configIssue(path, "a JSON-serializable value", formatReceived(value), owner));
}

/**
 * Dynamically imports a module by name.
 * Works in Node.js environments with standard ESM or via `jiti` in the CLI.
 *
 * @param name - The npm package name or file path to import.
 * @returns The resolved `GwenModule` exported as `default` or as the module object.
 *
 * @throws {GwenError} `KIT:MODULE_INVALID` when the imported value has no `setup` function.
 *   In development the hint says to export the object from `defineGwenModule()`.
 */
async function loadModule(name: string): Promise<GwenModule> {
  let imported: { default?: unknown } & Record<string, unknown>;

  try {
    imported = (await import(/* @vite-ignore */ name)) as typeof imported;
  } catch (cause) {
    const missing = cause instanceof Error && cause.message.includes("Cannot find package");
    throw new GwenError(
      AppErrorCodes.MODULE_LOAD_FAILED,
      `Failed to load module "${name}". ` +
        `Check that the package is installed and the name is spelled correctly. ` +
        `Cause: ${causeText(cause)}`,
      {
        cause,
        hint: __GWEN_DEV__
          ? missing
            ? `run 'gwen add ${name}' to install it.`
            : undefined
          : undefined,
      },
    );
  }

  const definition: unknown = imported.default ?? imported;

  if (!definition || typeof (definition as Record<string, unknown>)["setup"] !== "function") {
    throw new GwenError(
      AppErrorCodes.MODULE_INVALID,
      `Module "${name}" does not export a valid GwenModule (missing setup function).`,
      {
        hint: __GWEN_DEV__
          ? "Ensure the module exports a default object created with defineGwenModule()."
          : undefined,
      },
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
    const current = readFileSync(filePath, "utf8");
    if (current === content) return;
  }
  writeFileSync(filePath, content, "utf8");
}

/**
 * Generates `auto-imports.d.ts` declaring each auto-imported composable
 * as a global `const` function so the IDE and `tsc` see it without an import.
 *
 * @param imports - Auto-import declarations collected from all modules.
 */
function generateAutoImportsDts(entries: AutoImport[]): string {
  const lines = [
    "// Generated by gwen prepare — do not edit",
    "// Auto-imported composables — available globally without an explicit import.",
    "",
    "export {}",
    "",
  ];

  if (entries.length === 0) {
    return lines.join("\n");
  }

  lines.push("declare global {");

  for (const { name, from, as } of entries) {
    const localName = as ?? name;
    lines.push(`  // from: ${from}`);
    lines.push(`  const ${localName}: typeof import('${from}')['${name}'];`);
  }

  lines.push("}", "");
  return lines.join("\n");
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

declare module '#gwen' {
  export * from 'virtual:gwen/auto-imports';
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
        $schema: "https://json.schemastore.org/tsconfig",
        _comment: "Generated by gwen prepare — do not edit",
        compilerOptions: {
          // TypeScript 6 compat
          ignoreDeprecations: "6.0",
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "bundler",
          lib: ["ES2022", "DOM", "DOM.Iterable"],
          strict: true,
          verbatimModuleSyntax: true,
          isolatedModules: true,
          noEmit: true,
          // Allow incomplete type declarations in dependencies
          skipLibCheck: true,
        },
        include: ["../src/**/*.ts", "../*.ts", "types/**/*.d.ts"],
      },
      null,
      2,
    ) + "\n"
  );
}
