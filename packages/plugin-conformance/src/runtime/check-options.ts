import { CoreErrorCodes } from "@gwenjs/core";
import { ConformanceErrorCodes } from "../error-codes.js";
import type { ConformanceFinding } from "../types.js";
import { callExport, isPlugin, thrownCode } from "./call-factory.js";
import { installProviders, thrownMessage } from "./lifecycle.js";
import { withEngine } from "./open-engine.js";
import type { PluginConformanceSpec, PluginFactorySpec, RuntimeCheckContext } from "./types.js";

const OPTIONS_HINT = "Reject those options from definePlugin's options.validate before setup.";

function label(spec: PluginConformanceSpec, factory: PluginFactorySpec): string {
  return `${JSON.stringify(spec.packageName)} export ${JSON.stringify(factory.export)}`;
}

function optionsFinding(
  spec: PluginConformanceSpec,
  factory: PluginFactorySpec,
): ConformanceFinding {
  return {
    code: ConformanceErrorCodes.RUNTIME_OPTIONS,
    message: `${label(spec, factory)} installed instead of rejecting with ${CoreErrorCodes.PLUGIN_OPTIONS_INVALID}`,
    hint: OPTIONS_HINT,
  };
}

function rejectedFinding(
  spec: PluginConformanceSpec,
  factory: PluginFactorySpec,
  error: unknown,
): ConformanceFinding {
  const code = thrownCode(error);
  const named = code === undefined ? thrownMessage(error) : `${code} ${thrownMessage(error)}`;
  return {
    code: ConformanceErrorCodes.RUNTIME_OPTIONS,
    message: `${label(spec, factory)} was rejected by engine.use with ${named}`,
    hint: OPTIONS_HINT,
  };
}

/**
 * R9. Each factory in `factories` was built with `invalidOptions`.
 * `engine.use` must reject with `CORE:PLUGIN_OPTIONS_INVALID`.
 */
export async function checkOptions(
  context: RuntimeCheckContext,
  factories: readonly PluginFactorySpec[],
): Promise<ConformanceFinding[]> {
  return withEngine(context.spec, async (open) => {
    await installProviders(open.engine, context.spec);
    const findings: ConformanceFinding[] = [];
    for (const factory of factories) {
      const created = callExport(context.entry, factory.export, factory.invalidOptions);
      if (!isPlugin(created)) continue;
      try {
        await open.engine.use(created);
        findings.push(optionsFinding(context.spec, factory));
      } catch (error: unknown) {
        if (thrownCode(error) === CoreErrorCodes.PLUGIN_OPTIONS_INVALID) continue;
        findings.push(rejectedFinding(context.spec, factory, error));
      }
    }
    return findings;
  });
}
