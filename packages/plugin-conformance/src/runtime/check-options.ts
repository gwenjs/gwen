import { CoreErrorCodes } from "@gwenjs/core";
import { ConformanceErrorCodes } from "../error-codes.js";
import type { ConformanceFinding } from "../types.js";
import { callExport, isPlugin, thrownCode } from "./call-factory.js";
import { withEngine } from "./open-engine.js";
import type { PluginConformanceSpec, PluginFactorySpec, RuntimeCheckContext } from "./types.js";

function optionsFinding(
  spec: PluginConformanceSpec,
  factory: PluginFactorySpec,
): ConformanceFinding {
  return {
    code: ConformanceErrorCodes.RUNTIME_OPTIONS,
    message: `${JSON.stringify(spec.packageName)} export ${JSON.stringify(factory.export)} installed instead of rejecting with ${CoreErrorCodes.PLUGIN_OPTIONS_INVALID}`,
    hint: "Reject those options from definePlugin's options.validate before setup.",
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
    const findings: ConformanceFinding[] = [];
    for (const factory of factories) {
      const created = callExport(context.entry, factory.export, factory.invalidOptions);
      if (!isPlugin(created)) continue;
      try {
        await open.engine.use(created);
        findings.push(optionsFinding(context.spec, factory));
      } catch (error: unknown) {
        if (thrownCode(error) !== CoreErrorCodes.PLUGIN_OPTIONS_INVALID) {
          findings.push(optionsFinding(context.spec, factory));
        }
      }
    }
    return findings;
  });
}
