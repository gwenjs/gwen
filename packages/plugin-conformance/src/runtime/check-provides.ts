import { CoreErrorCodes } from "@gwenjs/core";
import { ConformanceErrorCodes } from "../error-codes.js";
import type { ConformanceFinding } from "../types.js";
import { callExport, isPlugin, thrownCode } from "./call-factory.js";
import { withEngine } from "./open-engine.js";
import type { PluginConformanceSpec, PluginFactorySpec, RuntimeCheckContext } from "./types.js";

function provideRejection(error: unknown): string | undefined {
  const code = thrownCode(error);
  if (code === CoreErrorCodes.PLUGIN_PROVIDE_MISSING) return code;
  if (code === CoreErrorCodes.PLUGIN_PROVIDE_UNDECLARED) return code;
  return undefined;
}

function providesFinding(
  spec: PluginConformanceSpec,
  factory: PluginFactorySpec,
  code: string,
): ConformanceFinding {
  return {
    code: ConformanceErrorCodes.RUNTIME_PROVIDES,
    message: `${JSON.stringify(spec.packageName)} export ${JSON.stringify(factory.export)} was rejected by engine.use with ${code}`,
    hint: "Provide every declared key in setup, and declare every key you provide.",
  };
}

/** R3. `engine.use` must accept the plugin. A provide rejection is one finding. */
export async function checkProvides(context: RuntimeCheckContext): Promise<ConformanceFinding[]> {
  return withEngine(context.spec, async (open) => {
    const findings: ConformanceFinding[] = [];
    for (const factory of context.spec.factories) {
      const created = callExport(context.entry, factory.export, factory.options);
      if (!isPlugin(created)) continue;
      try {
        await open.engine.use(created);
      } catch (error: unknown) {
        const code = provideRejection(error);
        if (code === undefined) continue;
        findings.push(providesFinding(context.spec, factory, code));
      }
    }
    return findings;
  });
}
