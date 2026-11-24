import type { GwenPlugin } from "@gwenjs/schema";
import { ConformanceErrorCodes } from "../error-codes.js";
import type { ConformanceFinding } from "../types.js";
import { callExport, isPlugin } from "./call-factory.js";
import { baselineOf, installProviders, provideKeys, sameNames, usePlugin } from "./lifecycle.js";
import { withEngine } from "./open-engine.js";
import type { RuntimeCheckContext } from "./types.js";

const HINT =
  "Register hooks and provide on the engine argument of setup, and export a system as its own factory.";

function leak(message: string): ConformanceFinding {
  return { code: ConformanceErrorCodes.RUNTIME_REMOVE_LEAK, message, hint: HINT };
}

async function checkOne(
  context: RuntimeCheckContext,
  plugin: GwenPlugin,
): Promise<ConformanceFinding[]> {
  return withEngine(context.spec, async (open) => {
    await installProviders(open.engine, context.spec);
    // After providers, before use (`packages/core/src/engine/gwen-engine.ts:566`).
    const baseline = baselineOf(open.engine);
    await usePlugin(open.engine, plugin);
    await open.engine.unuse(plugin.name);
    const findings: ConformanceFinding[] = [];
    for (const key of provideKeys(plugin)) {
      // `tryInject` is `undefined` when the key is not registered (`packages/schema/src/plugin.ts:170`).
      if (open.engine.tryInject(key) === undefined) continue;
      findings.push(
        leak(`plugin "${plugin.name}" left service ${JSON.stringify(key)} injectable after unuse`),
      );
    }
    const after = baselineOf(open.engine);
    if (after.hookListeners !== baseline.hookListeners) {
      const left = after.hookListeners - baseline.hookListeners;
      findings.push(
        leak(
          `plugin "${plugin.name}" left ${left} hook listeners after unuse (baseline ${baseline.hookListeners}, after ${after.hookListeners})`,
        ),
      );
    }
    if (!sameNames(baseline.plugins, after.plugins)) {
      findings.push(
        leak(
          `plugin "${plugin.name}" left plugins after unuse (baseline ${JSON.stringify(baseline.plugins)}, after ${JSON.stringify(after.plugins)})`,
        ),
      );
    }
    // One more frame. `advance` swallows a hook throw (`packages/core/src/engine/engine-loop.ts:215`).
    await open.advance(1, 1 / 60);
    return findings;
  });
}

/**
 * R5. One fresh engine per factory. After `unuse(name)`, every `provides` key
 * is not injectable, and `hookListeners` and `plugins` equal the baseline.
 * Then one frame at `1/60`.
 */
export async function checkRemove(context: RuntimeCheckContext): Promise<ConformanceFinding[]> {
  const findings: ConformanceFinding[] = [];
  for (const factory of context.spec.factories) {
    const created = callExport(context.entry, factory.export, factory.options);
    if (!isPlugin(created)) continue;
    findings.push(...(await checkOne(context, created)));
  }
  return findings;
}
