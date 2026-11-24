import { ConformanceErrorCodes } from "../error-codes.js";
import { compareFindings } from "../sort-findings.js";
import type { ConformanceCode, ConformanceFinding } from "../types.js";
import { thrownMessage } from "./lifecycle.js";
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
  "requirement-form",
  "extension",
  "base-surface",
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
  if (spec.bases !== undefined) scoped = { ...scoped, bases: spec.bases };
  return scoped;
}

function codeOf(id: RuntimeCheckId): ConformanceCode {
  switch (id) {
    case "shape":
      return ConformanceErrorCodes.RUNTIME_SHAPE;
    case "requires":
      return ConformanceErrorCodes.RUNTIME_REQUIRES;
    case "provides":
      return ConformanceErrorCodes.RUNTIME_PROVIDES;
    case "frames":
      return ConformanceErrorCodes.RUNTIME_FRAME_EVENT;
    case "remove":
      return ConformanceErrorCodes.RUNTIME_REMOVE_LEAK;
    case "reentry":
      return ConformanceErrorCodes.RUNTIME_REENTRY;
    case "two-engines":
      return ConformanceErrorCodes.RUNTIME_TWO_ENGINES;
    case "stop":
      return ConformanceErrorCodes.RUNTIME_TEARDOWN;
    case "options":
      return ConformanceErrorCodes.RUNTIME_OPTIONS;
    case "module":
      return ConformanceErrorCodes.RUNTIME_MODULE;
    case "hooks":
      return ConformanceErrorCodes.HOOK_UNDECLARED;
    case "composable":
      return ConformanceErrorCodes.RUNTIME_COMPOSABLE_CONTEXT;
    case "requirement-form":
    case "extension":
    case "base-surface":
      // The check body lands in a later pair. A throw until then uses this code.
      return ConformanceErrorCodes.INVALID_SPEC;
  }
}

function thrownCheck(id: RuntimeCheckId, error: unknown): ConformanceFinding {
  return {
    code: codeOf(id),
    message: `${id} ${thrownMessage(error)}`,
    hint: "The check threw. The message names the check and the thrown text.",
  };
}

/**
 * Run `id` and append its findings.
 * Returns false when that check does not run: `options` with no `invalidOptions`,
 * or `module` when the loader did not resolve `exports["./module"]`.
 * A throw becomes one finding in that check's code.
 */
async function appendCheck(
  id: RuntimeCheckId,
  context: RuntimeCheckContext,
  moduleFile: string | undefined,
  findings: ConformanceFinding[],
): Promise<boolean> {
  try {
    return await dispatchCheck(id, context, moduleFile, findings);
  } catch (error: unknown) {
    findings.push(thrownCheck(id, error));
    return true;
  }
}

async function dispatchCheck(
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
    case "requirement-form":
    case "extension": {
      const bases = context.spec.bases;
      if (bases === undefined || bases.length === 0) return false;
      // The check lands in a later pair. The id stays out of `checks` until then.
      return false;
    }
    case "base-surface":
      if (!context.extensionExport) return false;
      // The check lands in a later pair. The id stays out of `checks` until then.
      return false;
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
    packageFactories: spec.factories,
    entry: loaded.rootEntry,
    entryFile: loaded.entryFile,
    bases: loaded.bases,
    extensionExport: loaded.extensionExport,
  };
  const checks: RuntimeCheckId[] = [];
  const findings: ConformanceFinding[] = [];
  for (const id of ids) {
    if (await appendCheck(id, context, loaded.moduleFile, findings)) checks.push(id);
  }
  findings.sort(compareFindings);
  return { checks, findings };
}
