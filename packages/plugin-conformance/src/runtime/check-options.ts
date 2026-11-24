import { CoreErrorCodes } from "@gwenjs/core";
import { ConformanceErrorCodes } from "../error-codes.js";
import type { ConformanceFinding } from "../types.js";
import { isPlugin, thrownCode } from "./call-factory.js";
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

function isFactoryExport(value: unknown): value is (options: unknown) => unknown {
  return typeof value === "function";
}

function threwFinding(
  spec: PluginConformanceSpec,
  factory: PluginFactorySpec,
  error: unknown,
): ConformanceFinding {
  return {
    code: ConformanceErrorCodes.RUNTIME_OPTIONS,
    message: `${label(spec, factory)} threw: ${thrownMessage(error)}`,
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
 * A throw while building the plugin is one finding.
 * Otherwise `engine.use` must reject with `CORE:PLUGIN_OPTIONS_INVALID`.
 */
export async function checkOptions(
  context: RuntimeCheckContext,
  factories: readonly PluginFactorySpec[],
): Promise<ConformanceFinding[]> {
  return withEngine(context.spec, async (open) => {
    await installProviders(open.engine, context.spec);
    const findings: ConformanceFinding[] = [];
    for (const factory of factories) {
      const exported: unknown = context.entry[factory.export];
      if (!isFactoryExport(exported)) continue;
      let created: unknown;
      try {
        created = exported(factory.invalidOptions);
      } catch (error: unknown) {
        findings.push(threwFinding(context.spec, factory, error));
        continue;
      }
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
