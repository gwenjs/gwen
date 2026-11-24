import type { GwenPlugin } from "@gwenjs/schema";
import { ConformanceErrorCodes } from "../error-codes.js";
import { isRecord } from "../json.js";
import type { ConformanceFinding } from "../types.js";
import { callExport, isPlugin } from "./call-factory.js";
import { runtimeRoot } from "./load-package.js";
import { readRuntimeManifest } from "./package-manifest.js";
import type { PluginConformanceSpec, PluginFactorySpec, RuntimeCheckContext } from "./types.js";

const HINT = "Name each base in requires.plugins as { name, extensionApi }.";

interface NamedBase {
  readonly packageName: string;
  readonly pluginName: string;
}

interface NamedEntry {
  readonly kind: "string" | "object";
  readonly name: string;
}

function formFinding(message: string): ConformanceFinding {
  return { code: ConformanceErrorCodes.RUNTIME_REQUIRES, message, hint: HINT };
}

function pluginLabel(spec: PluginConformanceSpec, factory: PluginFactorySpec): string {
  return `${JSON.stringify(spec.packageName)} export ${JSON.stringify(factory.export)}`;
}

function stringForm(
  spec: PluginConformanceSpec,
  factory: PluginFactorySpec,
  name: string,
): ConformanceFinding {
  return formFinding(
    `RX6 ${pluginLabel(spec, factory)} requires.plugins entry ${JSON.stringify(name)} names a base; use the object form { name, extensionApi }`,
  );
}

function unnamedPackage(
  spec: PluginConformanceSpec,
  factory: PluginFactorySpec,
  packageName: string,
): ConformanceFinding {
  return formFinding(
    `RX6 ${pluginLabel(spec, factory)} gwen.extends package ${JSON.stringify(packageName)} has no requires.plugins entry`,
  );
}

function namedBases(context: RuntimeCheckContext): NamedBase[] {
  const named: NamedBase[] = [];
  for (const base of context.bases) {
    const created = base.create();
    if (!isPlugin(created)) continue;
    named.push({ packageName: base.packageName, pluginName: created.name });
  }
  return named;
}

/** String entries, and object entries `{ name, extensionApi }`, by name. */
function namedEntry(entry: unknown): NamedEntry | undefined {
  if (typeof entry === "string" && entry.length > 0) return { kind: "string", name: entry };
  if (!isRecord(entry)) return undefined;
  if (!Object.hasOwn(entry, "extensionApi")) return undefined;
  const name: unknown = entry.name;
  if (typeof name !== "string" || name.length === 0) return undefined;
  return { kind: "object", name };
}

function pluginEntries(plugin: GwenPlugin): readonly unknown[] {
  const requires: unknown = plugin.requires;
  if (!isRecord(requires)) return [];
  const plugins: unknown = requires.plugins;
  if (!Array.isArray(plugins)) return [];
  return plugins;
}

function baseNames(extendsNames: readonly string[], bases: readonly NamedBase[]): Set<string> {
  const names = new Set<string>(extendsNames);
  for (const base of bases) {
    names.add(base.packageName);
    names.add(base.pluginName);
  }
  return names;
}

function packageCovered(
  packageName: string,
  bases: readonly NamedBase[],
  covered: ReadonlySet<string>,
): boolean {
  if (covered.has(packageName)) return true;
  for (const base of bases) {
    if (base.packageName === packageName && covered.has(base.pluginName)) return true;
  }
  return false;
}

function factoryFindings(
  spec: PluginConformanceSpec,
  factory: PluginFactorySpec,
  plugin: GwenPlugin,
  extendsNames: readonly string[],
  bases: readonly NamedBase[],
): ConformanceFinding[] {
  const parsed: NamedEntry[] = [];
  for (const entry of pluginEntries(plugin)) {
    const named = namedEntry(entry);
    if (named !== undefined) parsed.push(named);
  }
  const names = baseNames(extendsNames, bases);
  const findings: ConformanceFinding[] = [];
  for (const item of parsed) {
    if (item.kind === "string" && names.has(item.name)) {
      findings.push(stringForm(spec, factory, item.name));
    }
  }
  const covered = new Set<string>();
  for (const item of parsed) covered.add(item.name);
  for (const packageName of extendsNames) {
    if (!packageCovered(packageName, bases, covered)) {
      findings.push(unnamedPackage(spec, factory, packageName));
    }
  }
  return findings;
}

/**
 * RX6, plugin half. Runs only when `spec.bases` is non-empty.
 * A string that names a base must be `{ name, extensionApi }`.
 * Every package in this package's `gwen.extends` needs one requires entry.
 */
export async function checkRequirementForm(
  context: RuntimeCheckContext,
): Promise<ConformanceFinding[]> {
  const loaded = await readRuntimeManifest(runtimeRoot(context.spec));
  const extendsNames = loaded.ok ? loaded.manifest.gwenExtends : [];
  const bases = namedBases(context);
  const findings: ConformanceFinding[] = [];
  for (const factory of context.spec.factories) {
    const created = callExport(context.entry, factory.export, factory.options);
    if (!isPlugin(created)) continue;
    findings.push(...factoryFindings(context.spec, factory, created, extendsNames, bases));
  }
  return findings;
}
