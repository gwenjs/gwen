import type { CheckPluginPackageOptions, ConformanceReport } from "./types.js";

export async function checkPluginPackage(
  _opts: CheckPluginPackageOptions,
): Promise<ConformanceReport> {
  return { checks: [], findings: [] };
}
