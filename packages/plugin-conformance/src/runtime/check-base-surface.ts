import type { GwenPlugin, GwenPluginServiceKey } from "@gwenjs/schema";
import { ConformanceErrorCodes } from "../error-codes.js";
import { isRecord } from "../json.js";
import type { ConformanceFinding } from "../types.js";
import { callExport, isPlugin } from "./call-factory.js";
import { installPrerequisites } from "./lifecycle.js";
import { runtimeRoot } from "./load-package.js";
import { withEngine } from "./open-engine.js";
import { readRuntimeManifest } from "./package-manifest.js";
import type { PluginConformanceSpec, PluginFactorySpec, RuntimeCheckContext } from "./types.js";

const HINT =
  "Set gwen.hookNamespace, declare extensionApi, provide <hookNamespace>:extension, and leave registrations at 0.";

interface ExtensionApi {
  readonly major: number;
  readonly minor: number;
}

function rb1(message: string): ConformanceFinding {
  return { code: ConformanceErrorCodes.RUNTIME_EXTENSION_API, message, hint: HINT };
}

function pluginLabel(spec: PluginConformanceSpec, factory: PluginFactorySpec): string {
  return `${JSON.stringify(spec.packageName)} export ${JSON.stringify(factory.export)}`;
}

function declaresExtensionApi(plugin: GwenPlugin): boolean {
  if (!Object.hasOwn(plugin, "extensionApi")) return false;
  return plugin.extensionApi !== undefined;
}

/** `{ major, minor }` and nothing else. */
function readApi(value: unknown): ExtensionApi | undefined {
  if (!isRecord(value)) return undefined;
  const keys = Object.keys(value);
  if (keys.length !== 2) return undefined;
  if (!Object.hasOwn(value, "major") || !Object.hasOwn(value, "minor")) return undefined;
  const major = value.major;
  const minor = value.minor;
  if (typeof major !== "number" || typeof minor !== "number") return undefined;
  return { major, minor };
}

function apiText(value: unknown): string {
  const read = readApi(value);
  if (read === undefined) return JSON.stringify(value);
  return JSON.stringify({ major: read.major, minor: read.minor });
}

function sameApi(pluginApi: ExtensionApi, serviceApi: unknown): boolean {
  const read = readApi(serviceApi);
  if (read === undefined) return false;
  return read.major === pluginApi.major && read.minor === pluginApi.minor;
}

/** The key from this plugin's `provides`, so `tryInject` stays typed. */
function declaredServiceKey(plugin: GwenPlugin, wanted: string): GwenPluginServiceKey | undefined {
  const keys = plugin.provides;
  if (keys === undefined) return undefined;
  return keys.find((key) => key === wanted);
}

function registrationCount(value: unknown): number | undefined {
  if (!isRecord(value)) return undefined;
  const count = value.registrations;
  if (typeof count !== "number") return undefined;
  return count;
}

function qualifies(plugin: GwenPlugin, wanted: string | undefined): boolean {
  if (declaresExtensionApi(plugin)) return true;
  if (wanted === undefined) return false;
  return declaredServiceKey(plugin, wanted) !== undefined;
}

async function checkFactory(
  context: RuntimeCheckContext,
  factory: PluginFactorySpec,
  plugin: GwenPlugin,
  wanted: string | undefined,
): Promise<ConformanceFinding[]> {
  const findings: ConformanceFinding[] = [];
  const label = pluginLabel(context.spec, factory);
  if (!declaresExtensionApi(plugin)) {
    findings.push(rb1(`RB1 ${label} has no extensionApi`));
  }
  const key = wanted === undefined ? undefined : declaredServiceKey(plugin, wanted);
  if (wanted !== undefined && key === undefined) {
    findings.push(rb1(`RB1 ${label} provides lacks ${JSON.stringify(wanted)}`));
  }
  const pluginApi = declaresExtensionApi(plugin) ? readApi(plugin.extensionApi) : undefined;
  if (key === undefined || pluginApi === undefined) return findings;
  return withEngine(context.spec, async (open) => {
    await installPrerequisites(open.engine, context);
    try {
      await open.engine.use(plugin);
    } catch {
      findings.push(rb1(`RB1 ${label} engine.use rejected the base`));
      return findings;
    }
    const injected: unknown = open.engine.tryInject(key);
    const serviceApi = isRecord(injected) ? injected.extensionApi : undefined;
    if (!sameApi(pluginApi, serviceApi)) {
      findings.push(
        rb1(
          `RB1 ${label} service extensionApi ${apiText(serviceApi)} differs from plugin ${apiText(pluginApi)}`,
        ),
      );
    }
    const count = registrationCount(injected);
    if (count !== 0) {
      findings.push(rb1(`RB1 ${label} registrations ${String(count)}`));
    }
    return findings;
  });
}

/**
 * RB1. Runs only when `exports` has `"./extension"`.
 * A factory qualifies when it declares `extensionApi` or provides `<hookNamespace>:extension`.
 * At least one factory must qualify. `registrations` is 0 after `use`.
 */
export async function checkBaseSurface(
  context: RuntimeCheckContext,
): Promise<ConformanceFinding[]> {
  const loaded = await readRuntimeManifest(runtimeRoot(context.spec));
  const namespace = loaded.ok ? loaded.manifest.hookNamespace : undefined;
  const findings: ConformanceFinding[] = [];
  const packageName = JSON.stringify(context.spec.packageName);
  if (namespace === undefined) {
    findings.push(rb1(`RB1 ${packageName} exports ./extension and has no gwen.hookNamespace`));
  }
  const wanted = namespace === undefined ? undefined : `${namespace}:extension`;
  const qualifying: { readonly factory: PluginFactorySpec; readonly plugin: GwenPlugin }[] = [];
  for (const factory of context.spec.factories) {
    const created = callExport(context.entry, factory.export, factory.options);
    if (!isPlugin(created)) continue;
    if (!qualifies(created, wanted)) continue;
    qualifying.push({ factory, plugin: created });
  }
  if (qualifying.length === 0) {
    const keyText = wanted === undefined ? "<hookNamespace>:extension" : wanted;
    findings.push(
      rb1(
        `RB1 ${packageName} exports ./extension and no factory declares extensionApi or provides ${JSON.stringify(keyText)}`,
      ),
    );
  }
  for (const item of qualifying) {
    findings.push(...(await checkFactory(context, item.factory, item.plugin, wanted)));
  }
  return findings;
}
