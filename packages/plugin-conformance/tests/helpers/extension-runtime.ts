import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach } from "vitest";

/**
 * The base fixture pushes each installed `extensionApi` here.
 * Cleared after every test in a file that imports this module.
 */
interface FixtureHost {
  __fixtureBaseApis?: unknown;
}

afterEach(() => {
  delete (globalThis as FixtureHost).__fixtureBaseApis;
});

export interface GwenFields {
  readonly extends?: readonly string[];
  readonly hookNamespace?: string;
}

export interface BaseSourceOptions {
  readonly exportName?: string;
  readonly packageName?: string;
  readonly pluginName?: string;
  readonly hookNamespace?: string;
  readonly major?: number;
  readonly minor?: number;
  /** When false, the plugin object has no `extensionApi`. */
  readonly extensionApi?: boolean;
  /** When false, the plugin object has no `provides`. */
  readonly provides?: boolean;
  /** Starting `registrations` after `setup`. Default 0. */
  readonly registrations?: number;
  /** Service `extensionApi`. Defaults to the plugin's major and minor. */
  readonly serviceMajor?: number;
  readonly serviceMinor?: number;
}

export interface ExtensionSourceOptions {
  readonly exportName?: string;
  readonly pluginName?: string;
  readonly requiresPlugins?: "none" | "string" | "object";
  readonly requiredBase?: string;
  readonly requiredMajor?: number;
  readonly requiredMinor?: number;
  readonly hookNamespace?: string;
  /** `empty` does nothing. The other modes need the base installed. */
  readonly setup?: "empty" | "register" | "leak" | "warn" | "hook" | "use-base";
}

export interface ExtensionWriteOptions {
  readonly name?: string;
  readonly exportName?: string;
  readonly pluginName?: string;
  /** Replaces the generated entry. */
  readonly source?: string;
  readonly sourceOptions?: ExtensionSourceOptions;
  /** Written when set, including `extends: []`. Omit the field to leave `gwen` out. */
  readonly gwen?: GwenFields;
  readonly extensionExport?: boolean;
  readonly moduleSource?: string;
  readonly files?: Readonly<Record<string, string>>;
}

export interface BaseWriteOptions extends BaseSourceOptions {
  readonly name?: string;
  /** Replaces the generated entry. */
  readonly source?: string;
  readonly gwen?: GwenFields;
  readonly extensionExport?: boolean;
}

function gwenValue(gwen: GwenFields): Record<string, unknown> {
  const value: Record<string, unknown> = {};
  if (gwen.extends !== undefined) value.extends = [...gwen.extends];
  if (gwen.hookNamespace !== undefined) value.hookNamespace = gwen.hookNamespace;
  return value;
}

function manifestFor(
  name: string,
  gwen: GwenFields | undefined,
  extensionExport: boolean,
  moduleSource: string | undefined,
): Record<string, unknown> {
  const exportsValue: Record<string, unknown> = {
    ".": { import: "./dist/index.js" },
  };
  if (extensionExport) exportsValue["./extension"] = { import: "./dist/extension.js" };
  if (moduleSource !== undefined) exportsValue["./module"] = { import: "./dist/module.js" };
  const manifest: Record<string, unknown> = {
    name,
    type: "module",
    exports: exportsValue,
  };
  if (gwen !== undefined) manifest.gwen = gwenValue(gwen);
  return manifest;
}

async function writeTree(
  dir: string,
  manifest: Record<string, unknown>,
  files: Readonly<Record<string, string>>,
): Promise<string> {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  for (const [relative, text] of Object.entries(files)) {
    const full = path.join(dir, relative);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, text);
  }
  return dir;
}

/** Plain-object base factory. `setup` records `this.extensionApi` and provides the service. */
export function baseModuleSource(options: BaseSourceOptions = {}): string {
  const exportName = options.exportName ?? "Base";
  const pluginName = options.pluginName ?? options.packageName ?? "fixture-base";
  const namespace = options.hookNamespace ?? pluginName;
  const major = options.major ?? 1;
  const minor = options.minor ?? 2;
  const serviceMajor = options.serviceMajor ?? major;
  const serviceMinor = options.serviceMinor ?? minor;
  const registrations = options.registrations ?? 0;
  const key = `${namespace}:extension`;
  const apiField =
    options.extensionApi === false
      ? ""
      : `extensionApi: { major: ${String(major)}, minor: ${String(minor)} },`;
  const providesField = options.provides === false ? "" : `provides: [${JSON.stringify(key)}],`;
  return `export function ${exportName}() {
  return {
    name: ${JSON.stringify(pluginName)},
    ${apiField}
    ${providesField}
    setup(engine) {
      const extensionApi = this.extensionApi;
      const list = globalThis.__fixtureBaseApis ?? [];
      list.push(extensionApi);
      globalThis.__fixtureBaseApis = list;
      let registrations = ${String(registrations)};
      const api = {
        extensionApi: { major: ${String(serviceMajor)}, minor: ${String(serviceMinor)} },
        get registrations() {
          return registrations;
        },
        register() {
          registrations += 1;
          let disposed = false;
          return () => {
            if (disposed) return;
            disposed = true;
            registrations -= 1;
          };
        },
      };
      engine.provide(${JSON.stringify(key)}, api);
    },
  };
}
`;
}

function requiresField(options: ExtensionSourceOptions): string {
  const mode = options.requiresPlugins ?? "none";
  if (mode === "none") return "";
  const base = options.requiredBase ?? "fixture-base";
  if (mode === "string") return `requires: { plugins: [${JSON.stringify(base)}] },`;
  const major = options.requiredMajor ?? 1;
  const minor = options.requiredMinor ?? 2;
  return `requires: { plugins: [{ name: ${JSON.stringify(base)}, extensionApi: { major: ${String(major)}, minor: ${String(minor)} } }] },`;
}

function setupBody(options: ExtensionSourceOptions): {
  readonly setup: string;
  readonly teardown: string;
} {
  const namespace = options.hookNamespace ?? options.requiredBase ?? "fixture-base";
  const key = `${namespace}:extension`;
  const mode = options.setup ?? "empty";
  if (mode === "empty") return { setup: "setup() {}", teardown: "" };
  if (mode === "warn") {
    return {
      setup: `setup(engine) {
      engine.hooks.hook("engine:update", () => {
        if (engine.getStats().frameCount === 1) engine.logger.warn("ext frame");
      });
    }`,
      teardown: "",
    };
  }
  if (mode === "hook") {
    return {
      setup: `setup(engine) {
      const real = engine;
      real.hooks.hook("engine:update", () => {});
    }`,
      teardown: "",
    };
  }
  if (mode === "use-base") {
    const base = options.requiredBase ?? "fixture-base";
    return {
      setup: `setup(engine) {
      engine.use({ name: ${JSON.stringify(base)}, setup() {} });
    }`,
      teardown: "",
    };
  }
  const teardown =
    mode === "leak"
      ? ""
      : `teardown() {
      if (typeof disposer === "function") disposer();
    },`;
  return {
    setup: `setup(engine) {
      const api = engine.tryInject(${JSON.stringify(key)});
      disposer = api.register();
    }`,
    teardown,
  };
}

/** Plain-object extension factory. The default setup is empty so the current checks stay quiet. */
export function extensionModuleSource(options: ExtensionSourceOptions = {}): string {
  const exportName = options.exportName ?? "Plugin";
  const pluginName = options.pluginName ?? "fixture-ext";
  const requires = requiresField(options);
  const body = setupBody(options);
  const disposer =
    body.teardown.length > 0 || (options.setup ?? "empty") === "leak" ? "let disposer;\n  " : "";
  return `export function ${exportName}() {
  ${disposer}return {
    name: ${JSON.stringify(pluginName)},
    ${requires}
    ${body.setup},
    ${body.teardown}
  };
}
`;
}

/** Extension package at `dir`. Bases are not written here. */
export async function writeExtensionPackage(
  dir: string,
  options: ExtensionWriteOptions = {},
): Promise<string> {
  const name = options.name ?? "fixture-ext";
  const exportName = options.exportName ?? options.sourceOptions?.exportName ?? "Plugin";
  const source =
    options.source ??
    extensionModuleSource({
      exportName,
      pluginName: options.pluginName ?? name,
      ...options.sourceOptions,
    });
  const files: Record<string, string> = { "dist/index.js": source };
  if (options.files !== undefined) {
    for (const [relative, text] of Object.entries(options.files)) {
      files[relative] = text;
    }
  }
  if (options.extensionExport === true) {
    files["dist/extension.js"] = files["dist/extension.js"] ?? "export const ready = true;\n";
  }
  if (options.moduleSource !== undefined) files["dist/module.js"] = options.moduleSource;
  return writeTree(
    dir,
    manifestFor(name, options.gwen, options.extensionExport === true, options.moduleSource),
    files,
  );
}

/**
 * Base package at `<parent>/node_modules/<name>`.
 * `resolveInstalledPackage` finds it from `parent`.
 */
export async function writeBasePackage(
  parent: string,
  options: BaseWriteOptions = {},
): Promise<string> {
  const name = options.name ?? "fixture-base";
  const exportName = options.exportName ?? "Base";
  const source =
    options.source ??
    baseModuleSource({
      ...options,
      exportName,
      packageName: name,
      pluginName: options.pluginName ?? name,
      hookNamespace: options.hookNamespace ?? options.gwen?.hookNamespace ?? name,
    });
  const hookNamespace = options.hookNamespace ?? options.gwen?.hookNamespace ?? name;
  const gwen: GwenFields =
    options.gwen?.extends === undefined
      ? { hookNamespace }
      : { hookNamespace, extends: options.gwen.extends };
  const files: Record<string, string> = { "dist/index.js": source };
  if (options.extensionExport === true) files["dist/extension.js"] = "export const ready = true;\n";
  return writeTree(
    path.join(parent, "node_modules", name),
    manifestFor(name, gwen, options.extensionExport === true, undefined),
    files,
  );
}
