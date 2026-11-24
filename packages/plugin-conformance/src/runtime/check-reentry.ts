import type { GwenPlugin } from "@gwenjs/schema";
import { ConformanceErrorCodes } from "../error-codes.js";
import type { ConformanceFinding } from "../types.js";
import { callExport, isPlugin } from "./call-factory.js";
import { installPrerequisites, thrownMessage, usePlugin } from "./lifecycle.js";
import { importFreshEntry } from "./load-package.js";
import { withEngine } from "./open-engine.js";
import type { RuntimeCheckContext } from "./types.js";

const HINT = "Make setup succeed on a second install after unuse.";

let freshToken = 0;

function reentry(name: string, message: string): ConformanceFinding {
  return {
    code: ConformanceErrorCodes.RUNTIME_REENTRY,
    message: `plugin "${name}" ${message}`,
    hint: HINT,
  };
}

async function checkOne(
  context: RuntimeCheckContext,
  plugin: GwenPlugin,
): Promise<ConformanceFinding[]> {
  return withEngine(context.spec, async (open) => {
    await installPrerequisites(open.engine, context);
    const installed = await usePlugin(open.engine, plugin);
    if (!installed) return [];
    await open.engine.unuse(plugin.name);
    try {
      await open.engine.use(plugin);
    } catch (error: unknown) {
      return [reentry(plugin.name, thrownMessage(error))];
    }
    return [];
  });
}

/**
 * R6. `use`, then `unuse`, then `use` again. The second `use` must resolve.
 * A rejection is the finding. A fresh module evaluation keeps a setup flag
 * from earlier checks off this pair
 * (`packages/plugin-conformance/src/runtime/load-package.ts:135`).
 */
export async function checkReentry(context: RuntimeCheckContext): Promise<ConformanceFinding[]> {
  const findings: ConformanceFinding[] = [];
  for (const factory of context.spec.factories) {
    freshToken += 1;
    const entry = await importFreshEntry(context.entryFile, `reentry-${freshToken}`);
    if (entry === undefined) continue;
    const created = callExport(entry, factory.export, factory.options);
    if (!isPlugin(created)) continue;
    findings.push(...(await checkOne(context, created)));
  }
  return findings;
}
