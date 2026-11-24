import { GWEN_PLUGIN_KEYS } from "@gwenjs/schema";
import { ConformanceErrorCodes } from "../error-codes.js";
import { isRecord } from "../json.js";
import type { ConformanceFinding } from "../types.js";
import { isPlugin } from "./call-factory.js";
import { thrownMessage } from "./lifecycle.js";
import type { PluginConformanceSpec, PluginFactorySpec, RuntimeCheckContext } from "./types.js";

const ALLOWED_KEYS: ReadonlySet<string> = new Set(GWEN_PLUGIN_KEYS);

function outsideKeys(instance: unknown): string[] {
  if (!isRecord(instance)) return [];
  const keys: string[] = [];
  for (const key of Object.keys(instance)) {
    if (!ALLOWED_KEYS.has(key)) keys.push(key);
  }
  return keys;
}

function shapeFinding(
  spec: PluginConformanceSpec,
  factory: PluginFactorySpec,
  detail: string,
): ConformanceFinding {
  return {
    code: ConformanceErrorCodes.RUNTIME_SHAPE,
    message: `${JSON.stringify(spec.packageName)} export ${JSON.stringify(factory.export)} ${detail}`,
    hint: "Remove that key. A frame hook belongs on a system or an actor, not on the plugin object.",
  };
}

function isFactoryExport(value: unknown): value is (options: unknown) => unknown {
  return typeof value === "function";
}

/**
 * R1. The export is a function, the return is a plugin, and its own keys are
 * in `GWEN_PLUGIN_KEYS`. One finding names the export. No engine.
 */
export async function checkShape(context: RuntimeCheckContext): Promise<ConformanceFinding[]> {
  const findings: ConformanceFinding[] = [];
  for (const factory of context.spec.factories) {
    const exported: unknown = context.entry[factory.export];
    if (!isFactoryExport(exported)) {
      findings.push(shapeFinding(context.spec, factory, "is not a function"));
      continue;
    }
    let instance: unknown;
    try {
      instance = exported(factory.options);
    } catch (error: unknown) {
      findings.push(shapeFinding(context.spec, factory, `threw: ${thrownMessage(error)}`));
      continue;
    }
    if (!isPlugin(instance)) {
      findings.push(shapeFinding(context.spec, factory, "did not return a plugin"));
      continue;
    }
    const keys = outsideKeys(instance);
    if (keys.length === 0) continue;
    findings.push(shapeFinding(context.spec, factory, `has ${keys.join(", ")}`));
  }
  return findings;
}
