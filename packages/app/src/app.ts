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
import { createJiti } from "jiti";
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { inferModuleName, scanLocalModuleFiles } from "./local-modules";
import { readConfigFile, type ResolvedGwenConfig } from "./config";
import { GwenAppConfigError } from "./config-error";
import { isPlainRecord, mergeLayers, recordOf } from "./merge";
import { createViewportsPlugin } from "./viewports-plugin";
import { createScreenPlugin } from "./create-screen-plugin";
import { BUILT_IN_MODULES } from "./built-in-modules";
import { GwenError } from "@gwenjs/schema";
import { formatReceived, type GwenConfigIssue } from "@gwenjs/schema";
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
   * Returns a snapshot of the plugins GwenApp installs itself
   * (`gwen:viewports` and `gwen:screen`). Modules register declarations, not instances.
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
   * Returns a snapshot of the plugin declarations registered by modules, in setup order.
   * Built-in scene and tween declarations come first, then config modules, then local
   * `src/modules` loaded through jiti after the config modules (`options.root` on
   * {@link setupModules}).
   * Each call returns a fresh array — safe to mutate.
   */
  get pluginDeclarations(): PluginDeclaration[] {
    return [...this._pluginDeclarations];
  }

  // ── setupModules ─────────────────────────────────────────────────────────────

  /**
   * Processes all modules listed in the resolved config, then local `src/modules`.
   *
   * For each config module entry, then each local file (loaded through jiti after
   * the config modules, from `options.root`):
   * 1. Resolves the module (via `moduleLoader` or dynamic `import()` for a config
   *    module; jiti for a local file).
   * 2. Deep-merges user options with module defaults (user values win).
   * 3. Fires `module:before`, calls `mod.setup(options, kit)`, fires `module:done`.
   *
   * Hook firing order:
   * `build:before` → (`module:before` → `mod.setup` → `module:done`) × N → `build:done`
   *
   * @param config - Fully resolved project configuration.
   * @param moduleLoader - Optional loader for test injection / CLI override.
   *   Receives the module name string and must return a `GwenModule`.
   * @param options - `root` is the project root for local modules.
   *   Defaults to `process.cwd()`, same as {@link GwenApp.prepare}.
   *   `config.localModulesDir === false` disables local modules.
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
    options?: { root?: string },
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

    const root = options?.root ?? process.cwd();
    if (config.localModulesDir !== false) {
      const dir = resolve(root, config.localModulesDir ?? "src/modules");
      const files = scanLocalModuleFiles(dir);
      if (files.length > 0) {
        const jiti = createJiti(root, { fsCache: false, moduleCache: false });
        for (const file of files) {
          const inferred = inferModuleName(file, dir);
          const loadedMod = await loadModule(
            inferred,
            () => jiti.import(file, { default: true }),
            file,
          );
          const explicit = loadedMod.meta?.name;
          const name = typeof explicit === "string" && explicit !== "" ? explicit : inferred;
          const named: GwenModule = { ...loadedMod, meta: { ...loadedMod.meta, name } };
          loaded.push({ name: named.meta.name, mod: named });
        }
      }
    }

    const prepared = prepareModules(config, loaded);
    if (prepared.issues.length > 0) {
      throw new GwenAppConfigError(readConfigFile(config), prepared.issues);
    }

    await this.buildHooks.callHook("build:before");

    const view = freezeResolved(config);
    for (const run of prepared.builtIn) {
      await this.runSetup(view, run.mod, run.options, `Built-in module "${run.mod.meta.name}"`);
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
      await this.runSetup(view, run.mod, run.options, `Module "${run.label}"`);
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
   * The user `vite` key is already the last extender (`setupModules`).
   *
   * @param base - The starting Vite config (e.g. from `vite.config.ts`).
   * @param merge - Combines the accumulated config with one extender result.
   *   Defaults to a shallow spread. Pass Vite's `mergeConfig` for a deep merge.
   * @returns A new merged Vite config object.
   *
   * @example
   * ```typescript
   * const viteConfig = app.resolveViteConfig({ root: './src', plugins: [] })
   * ```
   */
  resolveViteConfig(
    base: ViteUserConfig,
    merge: (config: ViteUserConfig, patch: Partial<ViteUserConfig>) => ViteUserConfig = (
      config,
      patch,
    ) => ({ ...config, ...patch }),
  ): ViteUserConfig {
    return this._viteConfigExtenders.reduce((cfg, fn) => merge(cfg, fn(cfg)), base);
  }

  // ── _createKit ───────────────────────────────────────────────────────────────

  /**
   * Constructs a {@link GwenKit} bound to this `GwenApp` instance.
   * Called once per module so each module gets a fresh kit reference
   * (while sharing the same underlying collections on `this`).
   *
   * @param resolved - Frozen config view exposed via `kit.options`.
   * @returns A GwenKit implementation.
   */
  private _createKit(resolved: Readonly<ResolvedGwenConfig>): GwenKit {
    // Capture `this` as `app` to keep the closure readable.
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const app = this;

    return {
      /**
       * Registers a plugin declaration. An instance, a factory, a non-string
       * `export`, an empty `src`, or non-JSON options throw `APP:PLUGIN_NOT_DECLARATIVE`.
       * `options: undefined` is stored like an absent `options`.
       */
      addPlugin(decl: PluginDeclaration): void {
        const value: unknown = decl;
        if (!isPluginDeclaration(value)) {
          throw pluginNotDeclarative(
            "kit.addPlugin() takes a PluginDeclaration { src, export?, options? }.",
            "Declare the package and its export instead of passing a plugin instance or factory.",
          );
        }
        if (
          "options" in value &&
          value.options !== undefined &&
          !jsonRoundTripEquals(value.options)
        ) {
          throw pluginNotDeclarative(
            `Plugin declaration "${value.src}" has options that are not JSON-serializable.`,
            "Pass JSON data only: objects, arrays, strings, finite numbers, booleans, and null.",
          );
        }
        app._pluginDeclarations.push(storedPluginDeclaration(value));
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

      /**
       * Declared as a shallow `Readonly`. The value is frozen in depth, except `plugins` elements, `vite`, and `hooks`.
       */
      get options(): Readonly<ResolvedGwenConfig> {
        return resolved;
      },
    };
  }

  private async runSetup(
    resolved: Readonly<ResolvedGwenConfig>,
    mod: GwenModule,
    options: Record<string, unknown>,
    label: string,
  ) {
    const kit = this._createKit(resolved);
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

function isPluginDeclaration(value: unknown): value is PluginDeclaration {
  if (!isPlainRecord(value)) return false;
  if (typeof value.src !== "string") return false;
  if (value.src.length === 0) return false;
  if ("export" in value && typeof value.export !== "string") return false;
  return true;
}

/** Drops an explicit `options: undefined` so the stored row matches an absent field. */
function storedPluginDeclaration(value: PluginDeclaration): PluginDeclaration {
  if (value.options !== undefined) return value;
  const stored: PluginDeclaration = { src: value.src };
  if (typeof value.export === "string") stored.export = value.export;
  return stored;
}

function pluginNotDeclarative(what: string, hint: string): GwenError {
  return new GwenError(AppErrorCodes.PLUGIN_NOT_DECLARATIVE, what, {
    composable: "kit.addPlugin",
    hint: __GWEN_DEV__ ? hint : undefined,
  });
}

function jsonRoundTripEquals(value: unknown): boolean {
  try {
    const encoded = JSON.stringify(value);
    if (typeof encoded !== "string") return false;
    const parsed: unknown = JSON.parse(encoded);
    return sameJsonValue(parsed, value);
  } catch {
    return false;
  }
}

function sameJsonValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    for (let index = 0; index < left.length; index += 1) {
      if (!sameJsonValue(left[index], right[index])) return false;
    }
    return true;
  }
  if (!isPlainRecord(left) || !isPlainRecord(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  for (const key of leftKeys) {
    if (!Object.prototype.hasOwnProperty.call(right, key)) return false;
    if (!sameJsonValue(left[key], right[key])) return false;
  }
  return true;
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
  const seenNames = new Set<string>();
  for (const entry of all) {
    const moduleName = entry.mod.meta.name;
    if (seenNames.has(moduleName)) continue;
    seenNames.add(moduleName);
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
  if (owned && key !== undefined && user !== undefined && !isPlainRecord(user)) {
    issues.push(configIssue(key, "an object", formatReceived(user), mod.meta.name));
    return { mod, options: defaultsRecord, label: mod.meta.name };
  }
  const merged = mergeLayers(defaultsRecord, isPlainRecord(user) ? user : {});
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

function rejectSerializable(
  path: string,
  value: unknown,
  owner: string,
  issues: GwenConfigIssue[],
): void {
  issues.push(configIssue(path, "a JSON-serializable value", formatReceived(value), owner));
}

function pushSerializable(
  value: unknown,
  fallback: unknown,
  path: string,
  owner: string,
  issues: GwenConfigIssue[],
  stack?: WeakSet<object>,
): void {
  if (value === undefined || Object.is(value, fallback)) return;
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  const seen = stack ?? new WeakSet<object>();
  if (Array.isArray(value) || isPlainRecord(value)) {
    if (seen.has(value)) {
      rejectSerializable(path, value, owner, issues);
      return;
    }
    seen.add(value);
    if (Array.isArray(value)) {
      const items = Array.isArray(fallback) ? fallback : [];
      for (let index = 0; index < value.length; index += 1) {
        const item = value[index];
        if (item === undefined) {
          rejectSerializable(`${path}.${index}`, item, owner, issues);
          continue;
        }
        pushSerializable(item, items[index], `${path}.${index}`, owner, issues, seen);
      }
    } else {
      const base = isPlainRecord(fallback) ? fallback : {};
      for (const child of Object.keys(value)) {
        pushSerializable(value[child], base[child], `${path}.${child}`, owner, issues, seen);
      }
    }
    seen.delete(value);
    return;
  }
  rejectSerializable(path, value, owner, issues);
}

function copyFrozenValue(value: unknown, seen: WeakMap<object, unknown>): unknown {
  return copyFrozenNode(value, seen, true);
}

function copyFrozenNode(value: unknown, seen: WeakMap<object, unknown>, root: boolean): unknown {
  if (typeof value === "function" || value === null || typeof value !== "object") return value;
  const cached = seen.get(value);
  if (cached !== undefined) return cached;
  if (Array.isArray(value)) {
    const copy: unknown[] = [];
    seen.set(value, copy);
    for (const item of value) copy.push(copyFrozenNode(item, seen, false));
    return Object.freeze(copy);
  }
  if (!isPlainRecord(value)) return value;
  const copy: Record<string, unknown> = {};
  seen.set(value, copy);
  for (const key of Object.keys(value)) {
    if (key === "__proto__") continue;
    const child = value[key];
    copy[key] = root ? copyRootField(key, child, seen) : copyFrozenNode(child, seen, false);
  }
  if (root) copyOwnSymbols(value, copy);
  return Object.freeze(copy);
}

function copyRootField(key: string, child: unknown, seen: WeakMap<object, unknown>): unknown {
  if (key === "plugins" && Array.isArray(child)) return Object.freeze(child.slice());
  if (key === "modules" && Array.isArray(child)) return Object.freeze(child.slice());
  if (key === "plugins" || key === "vite" || key === "hooks") return child;
  return copyFrozenNode(child, seen, false);
}

function copyOwnSymbols(source: object, target: object): void {
  for (const key of Object.getOwnPropertySymbols(source)) {
    const description = Object.getOwnPropertyDescriptor(source, key);
    if (description !== undefined) Object.defineProperty(target, key, description);
  }
}

function freezeResolved(config: ResolvedGwenConfig): Readonly<ResolvedGwenConfig> {
  const frozen = copyFrozenValue(config, new WeakMap());
  if (!isPlainRecord(frozen)) return config;
  return frozen as Readonly<ResolvedGwenConfig>;
}

/**
 * Dynamically imports a module by name.
 * Works in Node.js environments with standard ESM or via `jiti` in the CLI.
 *
 * @param name - Npm package name, or the inferred `local:<slug>` when `read` loads a local file.
 * @param read - When set, loads that file instead of `import(name)`.
 * @param file - Absolute path of the local file. Set together with `read`.
 * @returns The resolved `GwenModule` exported as `default` or as the module object.
 *
 * @throws {GwenError} `APP:MODULE_LOAD_FAILED` when the import throws.
 *   A local file names `file` and does not suggest installing a package.
 * @throws {GwenError} `KIT:MODULE_INVALID` when the imported value has no `setup` function.
 *   In development the hint says to export the object from `defineGwenModule()`.
 *   A local file also names `file`.
 */
async function loadModule(
  name: string,
  read?: () => Promise<unknown>,
  file?: string,
): Promise<GwenModule> {
  let imported: { default?: unknown } & Record<string, unknown>;

  try {
    const value: unknown = read ? await read() : await import(/* @vite-ignore */ name);
    imported = value as typeof imported;
  } catch (cause) {
    if (read !== undefined) {
      throw new GwenError(
        AppErrorCodes.MODULE_LOAD_FAILED,
        `Failed to load local module "${name}" from ${file}. Cause: ${causeText(cause)}`,
        { cause },
      );
    }
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
    const what =
      read !== undefined
        ? `Module "${name}" from ${file} does not export a valid GwenModule (missing setup function).`
        : `Module "${name}" does not export a valid GwenModule (missing setup function).`;
    throw new GwenError(AppErrorCodes.MODULE_INVALID, what, {
      hint: __GWEN_DEV__
        ? "Ensure the module exports a default object created with defineGwenModule()."
        : undefined,
    });
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
