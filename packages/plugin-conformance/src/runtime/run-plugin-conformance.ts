import { compareFindings } from "../sort-findings.js";
import type { ConformanceFinding } from "../types.js";
import { checkFrames } from "./check-frames.js";
import { checkOptions } from "./check-options.js";
import { checkProvides } from "./check-provides.js";
import { checkRequires } from "./check-requires.js";
import { checkShape } from "./check-shape.js";
import { loadRuntimePackage } from "./load-package.js";
import { validateSpec } from "./spec.js";
import type { PluginConformanceSpec, RuntimeCheckId, RuntimeConformanceReport } from "./types.js";

function sorted(findings: readonly ConformanceFinding[]): ConformanceFinding[] {
  return [...findings].sort(compareFindings);
}

/**
 * Validate `spec`, load the built package, then run shape, requires, provides, frames, and options.
 * Options runs only when a factory sets `invalidOptions`.
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
  if (loaded.rootEntry === undefined) {
    return { checks: [], findings: sorted(loaded.findings) };
  }
  const context = { spec, entry: loaded.rootEntry };
  const checks: RuntimeCheckId[] = ["shape", "requires", "provides", "frames"];
  const findings: ConformanceFinding[] = [
    ...(await checkShape(context)),
    ...(await checkRequires(context)),
    ...(await checkProvides(context)),
    ...(await checkFrames(context)),
  ];
  const withInvalidOptions = spec.factories.filter(
    (factory) => factory.invalidOptions !== undefined,
  );
  if (withInvalidOptions.length > 0) {
    findings.push(...(await checkOptions(context, withInvalidOptions)));
    checks.push("options");
  }
  return { checks, findings: sorted(findings) };
}
