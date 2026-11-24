import { compareFindings } from "../sort-findings.js";
import type { ConformanceFinding } from "../types.js";
import { loadRuntimePackage } from "./load-package.js";
import { validateSpec } from "./spec.js";
import type { PluginConformanceSpec, RuntimeConformanceReport } from "./types.js";

function sorted(findings: readonly ConformanceFinding[]): ConformanceFinding[] {
  return [...findings].sort(compareFindings);
}

/**
 * Validate `spec`, then load the built package.
 * No runtime check runs yet, so `checks` stays empty.
 * An invalid spec is returned without loading the package.
 */
export async function runPluginConformance(
  spec: PluginConformanceSpec,
): Promise<RuntimeConformanceReport> {
  const specFindings = validateSpec(spec);
  if (specFindings.length > 0) {
    return { checks: [], findings: sorted(specFindings) };
  }
  const loaded = await loadRuntimePackage(spec);
  return { checks: [], findings: sorted(loaded.findings) };
}
