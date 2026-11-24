import { GWEN_PLUGIN_KEYS } from "@gwenjs/schema";
import { ConformanceErrorCodes } from "../error-codes.js";
import { isRecord } from "../json.js";
import type { ConformanceFinding } from "../types.js";
import { callExport } from "./call-factory.js";
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
  keys: readonly string[],
): ConformanceFinding {
  return {
    code: ConformanceErrorCodes.RUNTIME_SHAPE,
    message: `${JSON.stringify(spec.packageName)} export ${JSON.stringify(factory.export)} has ${keys.join(", ")}`,
    hint: "Remove that key. A frame hook belongs on a system or an actor, not on the plugin object.",
  };
}

/** R1. Own keys of each factory return must be in `GWEN_PLUGIN_KEYS`. No engine. */
export async function checkShape(context: RuntimeCheckContext): Promise<ConformanceFinding[]> {
  const findings: ConformanceFinding[] = [];
  for (const factory of context.spec.factories) {
    const instance = callExport(context.entry, factory.export, factory.options);
    const keys = outsideKeys(instance);
    if (keys.length === 0) continue;
    findings.push(shapeFinding(context.spec, factory, keys));
  }
  return findings;
}
