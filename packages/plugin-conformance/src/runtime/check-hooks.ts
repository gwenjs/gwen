import {
  GWEN_FRAMEWORK_HOOK_NAMESPACES,
  GWEN_RESERVED_HOOK_NAMESPACES,
  type GwenPlugin,
} from "@gwenjs/schema";
import { ConformanceErrorCodes } from "../error-codes.js";
import { scanHookSources } from "../hook-sources.js";
import type { ConformanceFinding } from "../types.js";
import { callExport, isPlugin } from "./call-factory.js";
import { startHookRecording } from "./hook-recorder.js";
import { advanceFrames, installProviders, usePlugin } from "./lifecycle.js";
import { runtimeRoot } from "./load-package.js";
import { withEngine } from "./open-engine.js";
import type { RuntimeCheckContext } from "./types.js";

const HINT =
  "Declare it with defineHooks, or in a GwenRuntimeHooks augmentation of @gwenjs/schema.";

function isReservedNamespace(namespace: string): boolean {
  return GWEN_RESERVED_HOOK_NAMESPACES.some((reserved) => reserved === namespace);
}

function isFrameworkNamespace(namespace: string): boolean {
  for (const key of Object.keys(GWEN_FRAMEWORK_HOOK_NAMESPACES)) {
    if (key === namespace) return true;
  }
  return false;
}

/** Core and framework namespaces belong to the static check (`packages/plugin-conformance/src/check-hooks.ts:22`). */
function isIgnoredName(name: string): boolean {
  const colon = name.indexOf(":");
  if (colon === -1) return false;
  const namespace = name.slice(0, colon);
  if (isReservedNamespace(namespace)) return true;
  return isFrameworkNamespace(namespace);
}

function hookFinding(pkg: string, factory: string, name: string): ConformanceFinding {
  return {
    code: ConformanceErrorCodes.HOOK_UNDECLARED,
    message: `${pkg} factory ${JSON.stringify(factory)} emits "${name}" but does not declare it`,
    hint: HINT,
  };
}

function note(
  sink: ConformanceFinding[],
  declared: ReadonlySet<string>,
  pkg: string,
  factory: string,
  name: string,
): void {
  if (isIgnoredName(name)) return;
  if (declared.has(name)) return;
  sink.push(hookFinding(pkg, factory, name));
}

async function checkOne(
  context: RuntimeCheckContext,
  plugin: GwenPlugin,
  factory: string,
  declared: ReadonlySet<string>,
  sink: ConformanceFinding[],
): Promise<void> {
  await withEngine(context.spec, async (open) => {
    await installProviders(open.engine, context.spec);
    const recording = startHookRecording(open.engine, (name) => {
      note(sink, declared, context.spec.packageName, factory, name);
    });
    recording.arm();
    try {
      await usePlugin(open.engine, plugin);
      const fixture = context.spec.fixture;
      if (fixture !== undefined) {
        try {
          await fixture(open.engine);
        } catch {
          // `frames` already reports a thrown fixture (`packages/plugin-conformance/src/runtime/check-frames.ts:134`).
        }
      }
      await advanceFrames(open, context.spec);
    } finally {
      recording.stop();
    }
  });
}

/**
 * R11. One fresh engine per factory. `beforeEach` is installed before `use`
 * and removed when the run ends. A recorded name outside the reserved and
 * framework namespaces, and outside `scanHookSources` declarations
 * (`packages/plugin-conformance/src/hook-sources.ts:247`), is one
 * `HOOK_UNDECLARED` finding.
 */
export async function checkHooks(
  context: RuntimeCheckContext,
  sink: ConformanceFinding[],
): Promise<void> {
  const sources = await scanHookSources(runtimeRoot(context.spec));
  const declared = new Set(sources.declarations.map((declaration) => declaration.name));
  for (const factory of context.spec.factories) {
    const created = callExport(context.entry, factory.export, factory.options);
    if (!isPlugin(created)) continue;
    await checkOne(context, created, factory.export, declared, sink);
  }
}
