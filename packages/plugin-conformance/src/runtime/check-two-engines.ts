import type { GwenEngine } from "@gwenjs/core";
import type { GwenPlugin } from "@gwenjs/schema";
import { ConformanceErrorCodes } from "../error-codes.js";
import type { ConformanceFinding } from "../types.js";
import { callExport, isPlugin } from "./call-factory.js";
import { installProviders, provideKeys, usePlugin } from "./lifecycle.js";
import { withEngine } from "./open-engine.js";
import type { PluginConformanceSpec, RuntimeCheckContext } from "./types.js";

const HINT = "Create the service inside setup.";

function twoEngines(name: string, message: string): ConformanceFinding {
  return {
    code: ConformanceErrorCodes.RUNTIME_TWO_ENGINES,
    message: `plugin "${name}" ${message}`,
    hint: HINT,
  };
}

/** The second engine still has the plugin and every `provides` key. */
function engineKeeps(engine: GwenEngine, plugin: GwenPlugin): boolean {
  if (!engine.getStats().plugins.includes(plugin.name)) return false;
  for (const key of provideKeys(plugin)) {
    if (engine.tryInject(key) === undefined) return false;
  }
  return true;
}

async function checkPair(
  spec: PluginConformanceSpec,
  left: GwenPlugin,
  right: GwenPlugin,
): Promise<ConformanceFinding[]> {
  return withEngine(spec, async (first) => {
    return withEngine(spec, async (second) => {
      await installProviders(first.engine, spec);
      await installProviders(second.engine, spec);
      await usePlugin(first.engine, left);
      await usePlugin(second.engine, right);
      const findings: ConformanceFinding[] = [];
      for (const key of provideKeys(left)) {
        // Identity: one module-level object is the same value on both engines.
        if (first.engine.tryInject(key) !== second.engine.tryInject(key)) continue;
        findings.push(twoEngines(left.name, `shares service ${JSON.stringify(key)}`));
      }
      // `unuse` on the first engine leaves the second engine's keys and its plugin,
      // then one frame (`packages/core/src/engine/gwen-engine.ts:128`).
      // `advance` swallows a hook throw (`packages/core/src/engine/engine-loop.ts:215`).
      let survived = false;
      await first.engine.unuse(left.name);
      await second.advance(1, 1 / 60);
      if (engineKeeps(second.engine, right)) survived = true;
      if (!survived) {
        findings.push(
          twoEngines(right.name, `lost ${JSON.stringify(right.name)} on the other engine`),
        );
      }
      return findings;
    });
  });
}

/**
 * R7. Two engines, a new factory instance each. `tryInject` objects differ
 * for every `provides` key. `unuse` on the first leaves the second intact.
 */
export async function checkTwoEngines(context: RuntimeCheckContext): Promise<ConformanceFinding[]> {
  const findings: ConformanceFinding[] = [];
  for (const factory of context.spec.factories) {
    // Same module: a module-level value is one object (`packages/plugin-conformance/tests/runtime/two-engines.test.ts:7`).
    const left = callExport(context.entry, factory.export, factory.options);
    const right = callExport(context.entry, factory.export, factory.options);
    if (!isPlugin(left) || !isPlugin(right)) continue;
    findings.push(...(await checkPair(context.spec, left, right)));
  }
  return findings;
}
