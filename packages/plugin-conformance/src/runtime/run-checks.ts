import { compareFindings } from "../sort-findings.js";
import type { ConformanceFinding } from "../types.js";
import { checkComposable } from "./check-composable.js";
import { checkFrames } from "./check-frames.js";
import { checkHooks } from "./check-hooks.js";
import { checkModule } from "./check-module.js";
import { checkOptions } from "./check-options.js";
import { checkProvides } from "./check-provides.js";
import { checkReentry } from "./check-reentry.js";
import { checkRemove } from "./check-remove.js";
import { checkRequires } from "./check-requires.js";
import { checkShape } from "./check-shape.js";
import { checkStop } from "./check-stop.js";
import { checkTwoEngines } from "./check-two-engines.js";
import { loadRuntimePackage } from "./load-package.js";
import { validateSpec } from "./spec.js";
import type {
  PluginConformanceSpec,
  PluginFactorySpec,
  RuntimeCheckContext,
  RuntimeCheckId,
  RuntimeConformanceReport,
} from "./types.js";

/** Order of the checks {@link runPluginConformance} runs. */
export const RUNTIME_CHECK_ORDER: readonly RuntimeCheckId[] = [
  "shape",
  "requires",
  "provides",
  "frames",
  "remove",
  "reentry",
  "two-engines",
  "stop",
  "options",
  "module",
  "hooks",
  "composable",
];

function sorted(findings: readonly ConformanceFinding[]): ConformanceFinding[] {
  return [...findings].sort(compareFindings);
}

/**
 * The same spec, with `factories` limited to `factory`.
 * Other fields stay, so one row still sees `frames`, `root`, and the providers.
 */
function scopeToFactory(
  spec: PluginConformanceSpec,
  factory: PluginFactorySpec,
): PluginConformanceSpec {
  let scoped: PluginConformanceSpec = {
    packageName: spec.packageName,
    factories: [factory],
  };
  if (spec.root !== undefined) scoped = { ...scoped, root: spec.root };
  if (spec.official !== undefined) scoped = { ...scoped, official: spec.official };
  if (spec.frameworkProviders !== undefined) {
    scoped = { ...scoped, frameworkProviders: spec.frameworkProviders };
  }
  if (spec.fixture !== undefined) scoped = { ...scoped, fixture: spec.fixture };
  if (spec.frames !== undefined) scoped = { ...scoped, frames: spec.frames };
  if (spec.variant !== undefined) scoped = { ...scoped, variant: spec.variant };
  return scoped;
}

/**
 * Run `id` and append its findings.
 * Returns false when that check does not run: `options` with no `invalidOptions`,
 * or `module` when the loader did not resolve `exports["./module"]`.
 */
async function appendCheck(
  id: RuntimeCheckId,
  context: RuntimeCheckContext,
  moduleFile: string | undefined,
  findings: ConformanceFinding[],
): Promise<boolean> {
  switch (id) {
    case "shape":
      findings.push(...(await checkShape(context)));
      return true;
    case "requires":
      findings.push(...(await checkRequires(context)));
      return true;
    case "provides":
      findings.push(...(await checkProvides(context)));
      return true;
    case "frames":
      findings.push(...(await checkFrames(context)));
      return true;
    case "remove":
      findings.push(...(await checkRemove(context)));
      return true;
    case "reentry":
      findings.push(...(await checkReentry(context)));
      return true;
    case "two-engines":
      findings.push(...(await checkTwoEngines(context)));
      return true;
    case "stop":
      findings.push(...(await checkStop(context)));
      return true;
    case "options": {
      const withInvalidOptions = context.spec.factories.filter(
        (factory) => factory.invalidOptions !== undefined,
      );
      if (withInvalidOptions.length === 0) return false;
      findings.push(...(await checkOptions(context, withInvalidOptions)));
      return true;
    }
    case "module": {
      if (moduleFile === undefined) return false;
      findings.push(...(await checkModule(context, moduleFile)));
      return true;
    }
    case "hooks":
      await checkHooks(context, findings);
      return true;
    case "composable":
      findings.push(...(await checkComposable(context)));
      return true;
  }
}

/**
 * Findings of `ids` only.
 * `factory`, when set, limits a per-factory check to that factory.
 * An invalid spec, or a package that cannot be loaded, returns the `INVALID_SPEC` findings.
 */
export async function runRuntimeChecks(
  spec: PluginConformanceSpec,
  ids: readonly RuntimeCheckId[],
  factory?: PluginFactorySpec,
): Promise<readonly ConformanceFinding[]> {
  const report = await runRequestedChecks(spec, ids, factory);
  return report.findings;
}

/** Shared dispatch: the checks in `ids` that actually run, then their findings. */
export async function runRequestedChecks(
  spec: PluginConformanceSpec,
  ids: readonly RuntimeCheckId[],
  factory?: PluginFactorySpec,
): Promise<RuntimeConformanceReport> {
  const scoped = factory === undefined ? spec : scopeToFactory(spec, factory);
  const specFindings = validateSpec(scoped);
  if (specFindings.length > 0) {
    return { checks: [], findings: sorted(specFindings) };
  }
  const loaded = await loadRuntimePackage(scoped);
  if (loaded.rootEntry === undefined || loaded.entryFile === undefined) {
    return { checks: [], findings: sorted(loaded.findings) };
  }
  const context: RuntimeCheckContext = {
    spec: scoped,
    entry: loaded.rootEntry,
    entryFile: loaded.entryFile,
  };
  const checks: RuntimeCheckId[] = [];
  const findings: ConformanceFinding[] = [];
  for (const id of ids) {
    if (await appendCheck(id, context, loaded.moduleFile, findings)) checks.push(id);
  }
  findings.sort(compareFindings);
  return { checks, findings };
}
