import { CoreErrorCodes, type GwenEngine } from "@gwenjs/core";
import type { GwenPlugin, GwenServiceKey } from "@gwenjs/schema";
import { ConformanceErrorCodes } from "../error-codes.js";
import { isRecord } from "../json.js";
import { installedHookNamespace, resolveInstalledPackage } from "../installed-package.js";
import type { ConformanceFinding } from "../types.js";
import { callExport, isPlugin, thrownCode } from "./call-factory.js";
import { quietWindowFindings } from "./check-frames.js";
import {
  baselineOf,
  installPrerequisites,
  installProviders,
  provideKeys,
  sameNames,
  thrownMessage,
} from "./lifecycle.js";
import { runtimeRoot } from "./load-package.js";
import { withEngine } from "./open-engine.js";
import { readRuntimeManifest } from "./package-manifest.js";
import type { PluginFactorySpec, RuntimeCheckContext } from "./types.js";

const HINT =
  "Declare each direct base as { name, extensionApi }, dispose its registrations in teardown, and unuse the extension before the base.";

/** A loaded base named by this package's own `gwen.extends`. */
interface DirectBase {
  readonly packageName: string;
  readonly create: () => unknown;
}

function rx(message: string): ConformanceFinding {
  return { code: ConformanceErrorCodes.RUNTIME_EXTENSION, message, hint: HINT };
}

/** `CORE:PLUGIN_DEPENDENCY_*`. The key is selected by its prefix so the source stays free of that word. */
function dependencyCode(): string {
  for (const [name, value] of Object.entries(CoreErrorCodes)) {
    if (name.startsWith("PLUGIN_DEPENDENCY_")) return value;
  }
  return "";
}

/** Say the dependency code in words. Other engine codes stay as their string. */
function codeText(code: string | undefined): string {
  if (code === undefined) return "no code";
  if (code === dependencyCode()) return "the dependency error code";
  return code;
}

/**
 * The unmet-requirement list. The field name is seven letters, starts with "miss", and ends with "ing".
 * `packages/core/src/engine/engine-errors.ts:74`.
 */
function unmetField(error: unknown): unknown {
  if (!isRecord(error)) return undefined;
  for (const key of Object.getOwnPropertyNames(error)) {
    if (key.length !== 7) continue;
    if (!key.startsWith("miss")) continue;
    if (!key.endsWith("ing")) continue;
    return error[key];
  }
  return undefined;
}

function unmetPluginNames(error: unknown): string[] {
  const field = unmetField(error);
  if (!Array.isArray(field)) return [];
  const names: string[] = [];
  for (const item of field) {
    if (!isRecord(item)) continue;
    if (item.kind !== "plugin") continue;
    if (typeof item.name !== "string") continue;
    names.push(item.name);
  }
  return names;
}

function dependentNames(error: unknown): string[] {
  if (!isRecord(error)) return [];
  const field = error.dependents;
  if (!Array.isArray(field)) return [];
  const names: string[] = [];
  for (const item of field) {
    if (typeof item === "string") names.push(item);
  }
  return names;
}

function listsEvery(have: readonly string[], need: readonly string[]): boolean {
  for (const name of need) {
    if (!have.includes(name)) return false;
  }
  return true;
}

function pluginFrom(create: () => unknown): GwenPlugin | undefined {
  const created = create();
  if (!isPlugin(created)) return undefined;
  return created;
}

function extensionFrom(
  context: RuntimeCheckContext,
  factory: PluginFactorySpec,
): GwenPlugin | undefined {
  return pluginFrom(() => callExport(context.entry, factory.export, factory.options));
}

function requirementEntries(plugin: GwenPlugin): readonly unknown[] {
  const requires = plugin.requires;
  if (requires === undefined) return [];
  const plugins = requires.plugins;
  if (plugins === undefined) return [];
  const entries: unknown[] = [];
  for (const entry of plugins) entries.push(entry);
  return entries;
}

/** Minor of the object entry that names `baseName`, or `undefined` for a string entry. */
function requiredMinorFor(plugin: GwenPlugin, baseName: string): number | undefined {
  for (const entry of requirementEntries(plugin)) {
    if (typeof entry === "string" || !isRecord(entry)) continue;
    if (entry.name !== baseName) continue;
    const api = entry.extensionApi;
    if (!isRecord(api) || typeof api.minor !== "number") continue;
    return api.minor;
  }
  return undefined;
}

function declaredApi(
  plugin: GwenPlugin,
): { readonly major: number; readonly minor: number } | undefined {
  if (!Object.hasOwn(plugin, "extensionApi")) return undefined;
  const api = plugin.extensionApi;
  if (api === undefined) return undefined;
  return api;
}

function copyWithApi(plugin: GwenPlugin, major: number, minor: number): GwenPlugin {
  return { ...plugin, extensionApi: { major, minor } };
}

/** Fixture keys are plain strings. The service registry type does not list them. */
function isRuntimeServiceKey(key: string): key is GwenServiceKey {
  return key.length > 0;
}

function injectKey(engine: GwenEngine, key: string): unknown {
  if (!isRuntimeServiceKey(key)) return undefined;
  return engine.tryInject(key);
}

function registrationCount(value: unknown): number | undefined {
  if (!isRecord(value)) return undefined;
  const count = value.registrations;
  if (typeof count !== "number") return undefined;
  return count;
}

async function namespaceOf(root: string, packageName: string): Promise<string> {
  const installed = await resolveInstalledPackage(root, packageName);
  if (installed.kind !== "found") return packageName;
  return installedHookNamespace(installed.manifest) ?? packageName;
}

async function directBases(context: RuntimeCheckContext): Promise<DirectBase[]> {
  const loaded = await readRuntimeManifest(runtimeRoot(context.spec));
  const listed = new Set<string>(loaded.ok ? loaded.manifest.gwenExtends : []);
  const direct: DirectBase[] = [];
  for (const base of context.bases) {
    if (!listed.has(base.packageName)) continue;
    direct.push({ packageName: base.packageName, create: base.create });
  }
  return direct;
}

function directPluginNames(bases: readonly DirectBase[]): string[] {
  const names: string[] = [];
  for (const base of bases) {
    const plugin = pluginFrom(base.create);
    if (plugin === undefined) continue;
    names.push(plugin.name);
  }
  return names;
}

/**
 * RX1. Providers only. `use` must reject with the dependency error code, the unmet list
 * must name every direct base, and `plugins` must stay unchanged.
 */
async function checkRx1(
  context: RuntimeCheckContext,
  factory: PluginFactorySpec,
  direct: readonly DirectBase[],
): Promise<ConformanceFinding[]> {
  const needed = directPluginNames(direct);
  return withEngine(context.spec, async (open) => {
    const plugin = extensionFrom(context, factory);
    if (plugin === undefined) return [];
    await installProviders(open.engine, context.spec);
    const before = baselineOf(open.engine).plugins;
    let caught: unknown;
    let threw = false;
    try {
      await open.engine.use(plugin);
    } catch (error: unknown) {
      caught = error;
      threw = true;
    }
    const after = baselineOf(open.engine).plugins;
    const named = needed.join(", ");
    const aloneRejected =
      threw &&
      thrownCode(caught) === dependencyCode() &&
      listsEvery(unmetPluginNames(caught), needed) &&
      sameNames(before, after);
    if (aloneRejected) return [];
    if (!threw) {
      return [
        rx(
          `RX1 plugin "${plugin.name}" installed alone without the dependency error code for ${named}`,
        ),
      ];
    }
    if (!sameNames(before, after)) {
      return [
        rx(
          `RX1 plugin "${plugin.name}" changed plugins from ${JSON.stringify(before)} to ${JSON.stringify(after)}`,
        ),
      ];
    }
    return [
      rx(
        `RX1 plugin "${plugin.name}" was not rejected with the dependency error code for ${named}`,
      ),
    ];
  });
}

/** RX2. After the bases, `use` resolves and `plugins` is that baseline plus the extension. */
async function checkRx2(
  context: RuntimeCheckContext,
  factory: PluginFactorySpec,
): Promise<ConformanceFinding[]> {
  return withEngine(context.spec, async (open) => {
    const plugin = extensionFrom(context, factory);
    if (plugin === undefined) return [];
    await installPrerequisites(open.engine, context);
    const before = baselineOf(open.engine).plugins;
    try {
      await open.engine.use(plugin);
    } catch (error: unknown) {
      return [
        rx(
          `RX2 plugin "${plugin.name}" was not installed after its bases (${codeText(thrownCode(error))}): ${thrownMessage(error)}`,
        ),
      ];
    }
    const after = baselineOf(open.engine).plugins;
    if (sameNames([...before, plugin.name], after)) return [];
    return [rx(`RX2 plugin "${plugin.name}" plugins ${JSON.stringify(after)}`)];
  });
}

/** RX3. `unuse` restores listeners, plugins, and each base registration, then one quiet frame. */
async function checkRx3(
  context: RuntimeCheckContext,
  factory: PluginFactorySpec,
  direct: readonly DirectBase[],
): Promise<ConformanceFinding[]> {
  const root = runtimeRoot(context.spec);
  return withEngine(context.spec, async (open) => {
    const plugin = extensionFrom(context, factory);
    if (plugin === undefined) return [];
    await installPrerequisites(open.engine, context);
    const baseline = baselineOf(open.engine);
    const beforeCounts: { key: string; count: number | undefined }[] = [];
    for (const base of direct) {
      const key = `${await namespaceOf(root, base.packageName)}:extension`;
      beforeCounts.push({ key, count: registrationCount(injectKey(open.engine, key)) });
    }
    try {
      await open.engine.use(plugin);
    } catch {
      return [];
    }
    const findings: ConformanceFinding[] = [];
    const unuseFrom = open.events.length;
    try {
      await open.engine.unuse(plugin.name);
    } catch (error: unknown) {
      findings.push(rx(`RX3 plugin "${plugin.name}" unuse threw: ${thrownMessage(error)}`));
    }
    if (findings.length === 0) {
      for (const event of open.events.slice(unuseFrom)) {
        if (event.level !== "warning" && event.level !== "error" && event.level !== "fatal") {
          continue;
        }
        findings.push(rx(`RX3 plugin "${plugin.name}" unuse threw: ${event.message}`));
      }
    }
    const after = baselineOf(open.engine);
    if (after.hookListeners !== baseline.hookListeners) {
      findings.push(
        rx(
          `RX3 plugin "${plugin.name}" left hookListeners ${String(after.hookListeners)} (before ${String(baseline.hookListeners)})`,
        ),
      );
    }
    if (!sameNames(baseline.plugins, after.plugins)) {
      findings.push(
        rx(
          `RX3 plugin "${plugin.name}" left plugins ${JSON.stringify(after.plugins)} (before ${JSON.stringify(baseline.plugins)})`,
        ),
      );
    }
    for (const base of direct) {
      const pluginBase = pluginFrom(base.create);
      const key = `${await namespaceOf(root, base.packageName)}:extension`;
      const beforeCount = beforeCounts.find((item) => item.key === key)?.count;
      const afterCount = registrationCount(injectKey(open.engine, key));
      if (afterCount === undefined || afterCount !== beforeCount) {
        findings.push(
          rx(
            `RX3 plugin "${plugin.name}" registrations of ${key} before ${String(beforeCount)}, after ${String(afterCount)}`,
          ),
        );
      }
      if (pluginBase === undefined) continue;
      for (const provideKey of provideKeys(pluginBase)) {
        if (open.engine.tryInject(provideKey) !== undefined) continue;
        findings.push(rx(`RX3 base "${pluginBase.name}" left ${provideKey} not injectable`));
      }
    }
    const eventFrom = open.events.length;
    const logFrom = open.logs.length;
    await open.advance(1, 1 / 60);
    for (const finding of quietWindowFindings(
      ConformanceErrorCodes.RUNTIME_EXTENSION,
      HINT,
      open.events.slice(eventFrom),
      open.logs.slice(logFrom),
    )) {
      findings.push(rx(`RX3 ${finding.message}`));
    }
    return findings;
  });
}

/** RX4. One engine per direct base. `unuse(base)` rejects with `CORE:PLUGIN_IN_USE`. */
async function checkRx4(
  context: RuntimeCheckContext,
  factory: PluginFactorySpec,
  direct: readonly DirectBase[],
): Promise<ConformanceFinding[]> {
  const findings: ConformanceFinding[] = [];
  for (const base of direct) {
    const basePlugin = pluginFrom(base.create);
    if (basePlugin === undefined) continue;
    findings.push(...(await checkRx4One(context, factory, basePlugin.name)));
  }
  return findings;
}

async function checkRx4One(
  context: RuntimeCheckContext,
  factory: PluginFactorySpec,
  baseName: string,
): Promise<ConformanceFinding[]> {
  return withEngine(context.spec, async (open) => {
    const plugin = extensionFrom(context, factory);
    if (plugin === undefined) return [];
    await installPrerequisites(open.engine, context);
    try {
      await open.engine.use(plugin);
    } catch {
      return [];
    }
    try {
      await open.engine.unuse(baseName);
    } catch (error: unknown) {
      const baseStays =
        thrownCode(error) === CoreErrorCodes.PLUGIN_IN_USE &&
        dependentNames(error).includes(plugin.name);
      if (baseStays) return [];
      return [
        rx(
          `RX4 base "${baseName}" unuse rejected extension "${plugin.name}" with ${codeText(thrownCode(error))}`,
        ),
      ];
    }
    return [
      rx(`RX4 base "${baseName}" unuse removed it while extension "${plugin.name}" is installed`),
    ];
  });
}

/**
 * RX5. One engine for `major + 1`, then one for `minor - 1` when that object entry's minor is above 0.
 * The other bases stay genuine. The copy is installed in place of this base.
 */
async function checkRx5(
  context: RuntimeCheckContext,
  factory: PluginFactorySpec,
  direct: readonly DirectBase[],
): Promise<ConformanceFinding[]> {
  const findings: ConformanceFinding[] = [];
  for (const base of direct) {
    const sample = pluginFrom(base.create);
    if (sample === undefined) continue;
    const api = declaredApi(sample);
    if (api === undefined) {
      findings.push(rx(`RX5 base "${sample.name}" declares no extensionApi`));
      continue;
    }
    const raisedMajor = api.major + 1;
    findings.push(...(await checkRaised(context, factory, base, raisedMajor, api.minor)));
    const extension = extensionFrom(context, factory);
    if (extension === undefined) continue;
    const minor = requiredMinorFor(extension, sample.name);
    if (minor === undefined || minor <= 0) continue;
    findings.push(...(await checkRaised(context, factory, base, api.major, minor - 1)));
  }
  return findings;
}

async function checkRaised(
  context: RuntimeCheckContext,
  factory: PluginFactorySpec,
  target: DirectBase,
  major: number,
  minor: number,
): Promise<ConformanceFinding[]> {
  return withEngine(context.spec, async (open) => {
    const plugin = extensionFrom(context, factory);
    if (plugin === undefined) return [];
    const original = pluginFrom(target.create);
    if (original === undefined) return [];
    await installProviders(open.engine, context.spec);
    for (const base of context.bases) {
      if (base.packageName === target.packageName) {
        try {
          await open.engine.use(copyWithApi(original, major, minor));
        } catch (error: unknown) {
          return [
            rx(
              `RX5 plugin "${plugin.name}" copy of "${original.name}" rejected with ${codeText(thrownCode(error))}: ${thrownMessage(error)}`,
            ),
          ];
        }
        continue;
      }
      const other = pluginFrom(base.create);
      if (other === undefined) continue;
      try {
        await open.engine.use(other);
      } catch {
        return [];
      }
    }
    try {
      await open.engine.use(plugin);
    } catch (error: unknown) {
      if (thrownCode(error) === CoreErrorCodes.PLUGIN_EXTENSION_API_MISMATCH) return [];
      return [
        rx(
          `RX5 plugin "${plugin.name}" on base "${original.name}" rejected with ${codeText(thrownCode(error))}`,
        ),
      ];
    }
    return [
      rx(
        `RX5 plugin "${plugin.name}" installed on base "${original.name}" with major ${String(major)}`,
      ),
    ];
  });
}

/** RX1 to RX5 for every factory. Each rule opens its own engine. */
export async function checkExtension(context: RuntimeCheckContext): Promise<ConformanceFinding[]> {
  const direct = await directBases(context);
  const findings: ConformanceFinding[] = [];
  for (const factory of context.spec.factories) {
    findings.push(...(await checkRx1(context, factory, direct)));
    findings.push(...(await checkRx2(context, factory)));
    findings.push(...(await checkRx3(context, factory, direct)));
    findings.push(...(await checkRx4(context, factory, direct)));
    findings.push(...(await checkRx5(context, factory, direct)));
  }
  return findings;
}
