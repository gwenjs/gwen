import type { GwenPlugin } from "@gwenjs/schema";
import { ConformanceErrorCodes } from "../error-codes.js";
import type { ConformanceFinding } from "../types.js";
import { callExport, isPlugin, isProvideCode, thrownCode } from "./call-factory.js";
import { installProviders } from "./lifecycle.js";
import { withEngine } from "./open-engine.js";
import type { PluginConformanceSpec, PluginFactorySpec, RuntimeCheckContext } from "./types.js";

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

async function checkOne(
  spec: PluginConformanceSpec,
  factory: PluginFactorySpec,
  plugin: GwenPlugin,
): Promise<ConformanceFinding[]> {
  return withEngine(spec, async (open) => {
    await installProviders(open.engine, spec);
    try {
      await open.engine.use(plugin);
    } catch (error: unknown) {
      const code = thrownCode(error);
      if (!isProvideCode(code)) return [];
      return [providesFinding(spec, factory, code)];
    }
    return [];
  });
}

/** R3. One engine per factory. Install providers, then `use`. A provide rejection is one finding. */
export async function checkProvides(context: RuntimeCheckContext): Promise<ConformanceFinding[]> {
  const findings: ConformanceFinding[] = [];
  for (const factory of context.spec.factories) {
    const created = callExport(context.entry, factory.export, factory.options);
    if (!isPlugin(created)) continue;
    findings.push(...(await checkOne(context.spec, factory, created)));
  }
  return findings;
}
