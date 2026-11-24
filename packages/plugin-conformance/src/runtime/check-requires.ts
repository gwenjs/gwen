import { CoreErrorCodes, type GwenEngine } from "@gwenjs/core";
import type { GwenPlugin } from "@gwenjs/schema";
import { ConformanceErrorCodes } from "../error-codes.js";
import { isRecord } from "../json.js";
import type { ConformanceFinding } from "../types.js";
import { callExport, isPlugin, isProvideCode, thrownCode } from "./call-factory.js";
import { FRAMEWORK_PLUGIN_NAMES } from "./framework-plugin-names.js";
import { installProviders, sameNames, thrownMessage } from "./lifecycle.js";
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
  for (const factory of context.packageFactories) {
    const created = callExport(context.entry, factory.export, factory.options);
    if (!isPlugin(created)) continue;
    allowed.add(created.name);
  }
  return allowed;
}

/** Object entries `{ name, extensionApi }`, by `name`. Strings stay in {@link requiredPluginNames}. */
function objectRequirementNames(plugin: GwenPlugin): string[] {
  const requires: unknown = plugin.requires;
  if (!isRecord(requires)) return [];
  const plugins: unknown = requires.plugins;
  if (!Array.isArray(plugins)) return [];
  const names: string[] = [];
  for (const entry of plugins) {
    if (!isRecord(entry)) continue;
    if (!Object.hasOwn(entry, "extensionApi")) continue;
    const name: unknown = entry.name;
    if (typeof name !== "string" || name.length === 0) continue;
    names.push(name);
  }
  return names;
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
  for (const name of objectRequirementNames(plugin)) {
    if (allowed.has(name) || foreign.includes(name)) continue;
    foreign.push(name);
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

function useRejection(
  spec: PluginConformanceSpec,
  factory: PluginFactorySpec,
  error: unknown,
): ConformanceFinding {
  const code = thrownCode(error);
  const detail = code === undefined ? thrownMessage(error) : `${code}: ${thrownMessage(error)}`;
  return {
    code: ConformanceErrorCodes.RUNTIME_REQUIRES,
    message: `${pluginLabel(spec, factory)} was rejected by engine.use with ${detail}`,
    hint: REQUIRES_HINT,
  };
}

/** Install factories of this package whose plugin name this plugin requires. */
async function installSiblings(
  context: RuntimeCheckContext,
  plugin: GwenPlugin,
  currentExport: string,
  engine: GwenEngine,
): Promise<void> {
  const needed = new Set(requiredPluginNames(plugin));
  needed.delete(plugin.name);
  if (needed.size === 0) return;
  for (const factory of context.packageFactories) {
    if (factory.export === currentExport) continue;
    const created = callExport(context.entry, factory.export, factory.options);
    if (!isPlugin(created)) continue;
    if (!needed.has(created.name)) continue;
    await engine.use(created);
    needed.delete(created.name);
  }
}

async function checkOne(
  context: RuntimeCheckContext,
  factory: PluginFactorySpec,
  plugin: GwenPlugin,
  allowed: ReadonlySet<string>,
): Promise<ConformanceFinding[]> {
  const spec = context.spec;
  const foreign = foreignPluginNames(spec, plugin, allowed);
  if (foreign.length > 0) return [foreignPlugin(spec, factory, foreign)];
  return withEngine(spec, async (open) => {
    /** R2 does not install bases. */
    await installProviders(open.engine, spec);
    await installSiblings(context, plugin, factory.export, open.engine);
    const baseline = open.engine.getStats().plugins;
    try {
      await open.engine.use(plugin);
    } catch (error: unknown) {
      if (thrownCode(error) === CoreErrorCodes.PLUGIN_DEPENDENCY_MISSING) {
        if (unmetEntries(error, allowed).length === 0) return [];
        return [aloneRejection(spec, factory, error, allowed)];
      }
      if (isProvideCode(thrownCode(error))) return [];
      return [useRejection(spec, factory, error)];
    }
    const installed = open.engine.getStats().plugins;
    const expected = [...baseline, plugin.name];
    if (!sameNames(installed, expected)) return [hiddenInstall(spec, factory, installed)];
    return [];
  });
}

/**
 * R2. Install `frameworkProviders`, then a sibling factory of this package
 * when `requires.plugins` names it, then `use`. The installed plugins must be
 * that baseline plus the plugin name. An official plugin may name only this
 * package or `FRAMEWORK_PLUGIN_NAMES`. An object entry `{ name, extensionApi }`
 * counts by `name` for that rule. `requiredPluginNames` still keeps only strings.
 * A community plugin ignores other names.
 * A `use` rejection that is not the dependency code and not a provide code
 * is one finding.
 */
export async function checkRequires(context: RuntimeCheckContext): Promise<ConformanceFinding[]> {
  const allowed = allowedNames(context);
  const findings: ConformanceFinding[] = [];
  for (const factory of context.spec.factories) {
    const created = callExport(context.entry, factory.export, factory.options);
    if (!isPlugin(created)) continue;
    findings.push(...(await checkOne(context, factory, created, allowed)));
  }
  return findings;
}
