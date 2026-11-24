import type { GwenPlugin } from "@gwenjs/schema";
import { ConformanceErrorCodes } from "../error-codes.js";
import type { ConformanceFinding } from "../types.js";
import { callExport, isPlugin } from "./call-factory.js";
import { baselineOf, extraNames, installProviders, provideKeys, usePlugin } from "./lifecycle.js";
import { withEngine } from "./open-engine.js";
import type { RuntimeCheckContext } from "./types.js";

const HINT = "Register hooks and provide on the engine argument of setup.";

function teardown(message: string): ConformanceFinding {
  return { code: ConformanceErrorCodes.RUNTIME_TEARDOWN, message, hint: HINT };
}

async function checkOne(
  context: RuntimeCheckContext,
  plugin: GwenPlugin,
): Promise<ConformanceFinding[]> {
  return withEngine(context.spec, async (open) => {
    await installProviders(open.engine, context.spec);
    const baseline = baselineOf(open.engine);
    await usePlugin(open.engine, plugin);
    // `stop` tears every plugin down, including `frameworkProviders`, and does
    // not call `removeAllHooks` (`packages/core/src/engine/gwen-engine.ts:276`,
    // `packages/core/src/engine/plugin-registry.ts:461`,
    // `packages/core/src/engine/hook-dispatch.ts:254`). The count can fall
    // below the post-provider baseline. A leak is a count above it.
    await open.engine.stop();
    const after = baselineOf(open.engine);
    const findings: ConformanceFinding[] = [];
    if (after.hookListeners > baseline.hookListeners) {
      const left = after.hookListeners - baseline.hookListeners;
      findings.push(
        teardown(
          `plugin "${plugin.name}" left ${left} hook listeners after stop (baseline ${baseline.hookListeners}, after ${after.hookListeners})`,
        ),
      );
    }
    const extras = extraNames(baseline.plugins, after.plugins);
    if (extras.length > 0) {
      findings.push(
        teardown(
          `plugin "${plugin.name}" left plugins after stop (baseline ${JSON.stringify(baseline.plugins)}, after ${JSON.stringify(after.plugins)})`,
        ),
      );
    }
    for (const key of provideKeys(plugin)) {
      if (open.engine.tryInject(key) === undefined) continue;
      findings.push(
        teardown(
          `plugin "${plugin.name}" left service ${JSON.stringify(key)} injectable after stop`,
        ),
      );
    }
    return findings;
  });
}

/**
 * R8. One fresh engine per factory. After `engine.stop()`, `hookListeners`
 * is not above the baseline from before `use`, no plugin name was added
 * past that baseline, and every `provides` key is not injectable.
 * `getStats()` stays readable (`packages/core/src/engine/gwen-engine.ts:566`).
 */
export async function checkStop(context: RuntimeCheckContext): Promise<ConformanceFinding[]> {
  const findings: ConformanceFinding[] = [];
  for (const factory of context.spec.factories) {
    const created = callExport(context.entry, factory.export, factory.options);
    if (!isPlugin(created)) continue;
    findings.push(...(await checkOne(context, created)));
  }
  return findings;
}
