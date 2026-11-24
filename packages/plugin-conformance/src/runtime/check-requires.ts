import { CoreErrorCodes } from "@gwenjs/core";
import type { GwenPlugin } from "@gwenjs/schema";
import { ConformanceErrorCodes } from "../error-codes.js";
import { isRecord } from "../json.js";
import type { ConformanceFinding } from "../types.js";
import { callExport, isPlugin, thrownCode } from "./call-factory.js";
import { FRAMEWORK_PLUGIN_NAMES } from "./framework-plugin-names.js";
import { withEngine } from "./open-engine.js";
import type { PluginConformanceSpec, PluginFactorySpec, RuntimeCheckContext } from "./types.js";

const REQUIRES_HINT = "Declare the hard requirement and export a system as its own factory.";

const FRAMEWORK_PLUGIN_NAME_SET: ReadonlySet<string> = new Set(FRAMEWORK_PLUGIN_NAMES);

function pluginLabel(spec: PluginConformanceSpec, factory: PluginFactorySpec): string {
  return `${JSON.stringify(spec.packageName)} export ${JSON.stringify(factory.export)}`;
}

function isOfficial(spec: PluginConformanceSpec): boolean {
  if (spec.official !== undefined) return spec.official;
  return spec.packageName.startsWith("@gwenjs/");
}

function hasHardRequires(plugin: GwenPlugin): boolean {
  const plugins = plugin.requires?.plugins ?? [];
  const services = plugin.requires?.services ?? [];
  return plugins.length > 0 || services.length > 0;
}

function requiredPluginNames(plugin: GwenPlugin): string[] {
  const requires: unknown = plugin.requires;
  if (!isRecord(requires)) return [];
  const plugins: unknown = requires.plugins;
  if (!Array.isArray(plugins)) return [];
  const names: string[] = [];
  for (const entry of plugins) {
    if (typeof entry === "string") names.push(entry);
  }
  return names;
}

/** Names this package's factories install, plus the framework plugin names. */
function allowedNames(context: RuntimeCheckContext): ReadonlySet<string> {
  const allowed = new Set<string>(FRAMEWORK_PLUGIN_NAME_SET);
  for (const factory of context.spec.factories) {
    const created = callExport(context.entry, factory.export, factory.options);
    if (!isPlugin(created)) continue;
    allowed.add(created.name);
  }
  return allowed;
}

function foreignPluginNames(
  spec: PluginConformanceSpec,
  plugin: GwenPlugin,
  allowed: ReadonlySet<string>,
): string[] {
  if (!isOfficial(spec)) return [];
  const foreign: string[] = [];
  for (const name of requiredPluginNames(plugin)) {
    if (!allowed.has(name)) foreign.push(name);
  }
  return foreign;
}

/** A plugin name outside `allowed` is left out: the official rule names it. */
function unmetEntries(error: unknown, allowed: ReadonlySet<string>): string[] {
  if (!isRecord(error)) return [];
  const unmet: unknown = error.missing;
  if (!Array.isArray(unmet)) return [];
  const names: string[] = [];
  for (const entry of unmet) {
    if (!isRecord(entry)) continue;
    const kind: unknown = entry.kind;
    const name: unknown = entry.name;
    if (typeof name !== "string") continue;
    if (kind === "service") names.push(name);
    if (kind === "plugin" && allowed.has(name)) names.push(name);
  }
  return names;
}

function aloneRejection(
  spec: PluginConformanceSpec,
  factory: PluginFactorySpec,
  error: unknown,
  allowed: ReadonlySet<string>,
): ConformanceFinding {
  const entries = unmetEntries(error, allowed);
  return {
    code: ConformanceErrorCodes.RUNTIME_REQUIRES,
    message: `${pluginLabel(spec, factory)} was rejected by engine.use with ${CoreErrorCodes.PLUGIN_DEPENDENCY_MISSING}: ${entries.join(", ")}`,
    hint: REQUIRES_HINT,
  };
}

function foreignPlugin(
  spec: PluginConformanceSpec,
  factory: PluginFactorySpec,
  foreign: readonly string[],
): ConformanceFinding {
  const listed = foreign.map((name) => JSON.stringify(name)).join(", ");
  return {
    code: ConformanceErrorCodes.RUNTIME_REQUIRES,
    message: `${pluginLabel(spec, factory)} requires ${listed}`,
    hint: REQUIRES_HINT,
  };
}

function hiddenInstall(
  spec: PluginConformanceSpec,
  factory: PluginFactorySpec,
  installed: readonly string[],
): ConformanceFinding {
  return {
    code: ConformanceErrorCodes.RUNTIME_REQUIRES,
    message: `${pluginLabel(spec, factory)} installed ${JSON.stringify(installed)}`,
    hint: REQUIRES_HINT,
  };
}

function sameNames(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

async function checkOne(
  spec: PluginConformanceSpec,
  factory: PluginFactorySpec,
  plugin: GwenPlugin,
  allowed: ReadonlySet<string>,
): Promise<ConformanceFinding[]> {
  const foreign = foreignPluginNames(spec, plugin, allowed);
  if (foreign.length > 0) return [foreignPlugin(spec, factory, foreign)];
  return withEngine(spec, async (open) => {
    if (hasHardRequires(plugin)) {
      for (const provider of spec.frameworkProviders ?? []) {
        await open.engine.use(provider());
      }
    }
    const baseline = open.engine.getStats().plugins;
    try {
      await open.engine.use(plugin);
    } catch (error: unknown) {
      if (thrownCode(error) === CoreErrorCodes.PLUGIN_DEPENDENCY_MISSING) {
        return [aloneRejection(spec, factory, error, allowed)];
      }
      return [];
    }
    const installed = open.engine.getStats().plugins;
    const expected = [...baseline, plugin.name];
    if (!sameNames(installed, expected)) return [hiddenInstall(spec, factory, installed)];
    return [];
  });
}

/**
 * R2. No hard `requires`: `use` alone, and the plugin list is the baseline plus the name.
 * Hard `requires`: `use` rejects until `frameworkProviders` are installed, then the list is
 * those providers' plugins plus the name. An official plugin may name only this package
 * or `FRAMEWORK_PLUGIN_NAMES`.
 */
export async function checkRequires(context: RuntimeCheckContext): Promise<ConformanceFinding[]> {
  const allowed = allowedNames(context);
  const findings: ConformanceFinding[] = [];
  for (const factory of context.spec.factories) {
    const created = callExport(context.entry, factory.export, factory.options);
    if (!isPlugin(created)) continue;
    findings.push(...(await checkOne(context.spec, factory, created, allowed)));
  }
  return findings;
}
