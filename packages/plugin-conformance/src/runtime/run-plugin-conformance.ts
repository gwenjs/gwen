import type { PluginConformanceSpec, RuntimeConformanceReport } from "./types.js";

/** Inert until the loader and the checks exist. Returns no check and no finding. */
export function runPluginConformance(
  spec: PluginConformanceSpec,
): Promise<RuntimeConformanceReport> {
  void spec;
  return Promise.resolve({ checks: [], findings: [] });
}
