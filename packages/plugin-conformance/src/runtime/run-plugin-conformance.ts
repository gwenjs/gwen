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
import type { PluginConformanceSpec, RuntimeCheckId, RuntimeConformanceReport } from "./types.js";

function sorted(findings: readonly ConformanceFinding[]): ConformanceFinding[] {
  return [...findings].sort(compareFindings);
}

/** A fresh findings list for one run. */
function newFindings(): ConformanceFinding[] {
  return [];
}

/**
 * Validate `spec`, load the built package, then run shape, requires, provides,
 * frames, remove, reentry, two-engines, stop, options, module, hooks, and composable.
 * Options runs only when a factory sets `invalidOptions`.
 * Module runs only when the loader resolved `exports["./module"]`.
 * Hooks runs once per factory. Composable runs once per package.
 * An invalid spec, or a package that cannot be loaded, returns no checks.
 */
export async function runPluginConformance(
  spec: PluginConformanceSpec,
): Promise<RuntimeConformanceReport> {
  const specFindings = validateSpec(spec);
  if (specFindings.length > 0) {
    return { checks: [], findings: sorted(specFindings) };
  }
  const loaded = await loadRuntimePackage(spec);
  if (loaded.rootEntry === undefined || loaded.entryFile === undefined) {
    return { checks: [], findings: sorted(loaded.findings) };
  }
  const context = { spec, entry: loaded.rootEntry, entryFile: loaded.entryFile };
  const checks: RuntimeCheckId[] = [
    "shape",
    "requires",
    "provides",
    "frames",
    "remove",
    "reentry",
    "two-engines",
    "stop",
  ];
  const findings = newFindings();
  findings.push(
    ...(await checkShape(context)),
    ...(await checkRequires(context)),
    ...(await checkProvides(context)),
    ...(await checkFrames(context)),
    ...(await checkRemove(context)),
    ...(await checkReentry(context)),
    ...(await checkTwoEngines(context)),
    ...(await checkStop(context)),
  );
  const withInvalidOptions = spec.factories.filter(
    (factory) => factory.invalidOptions !== undefined,
  );
  if (withInvalidOptions.length > 0) {
    findings.push(...(await checkOptions(context, withInvalidOptions)));
    checks.push("options");
  }
  if (loaded.moduleFile !== undefined) {
    findings.push(...(await checkModule(context, loaded.moduleFile)));
    checks.push("module");
  }
  await checkHooks(context, findings);
  checks.push("hooks");
  findings.push(...(await checkComposable(context)));
  checks.push("composable");
  findings.sort(compareFindings);
  return { checks, findings };
}
