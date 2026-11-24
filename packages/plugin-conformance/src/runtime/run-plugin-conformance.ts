import { RUNTIME_CHECK_ORDER, runRequestedChecks } from "./run-checks.js";
import type { PluginConformanceSpec, RuntimeConformanceReport } from "./types.js";

/**
 * Validate `spec`, load the built package, then run shape, requires, provides,
 * frames, remove, reentry, two-engines, stop, options, module, extension, hooks, and composable.
 * Options runs only when a factory sets `invalidOptions`.
 * Module runs only when the loader resolved `exports["./module"]`.
 * Extension runs only when `spec.bases` is non-empty.
 * Hooks runs once per factory. Composable runs once per package.
 * An invalid spec, or a package that cannot be loaded, returns no checks.
 */
export async function runPluginConformance(
  spec: PluginConformanceSpec,
): Promise<RuntimeConformanceReport> {
  return runRequestedChecks(spec, RUNTIME_CHECK_ORDER);
}
