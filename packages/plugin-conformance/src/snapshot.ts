import type { ConformanceReport } from "./types.js";

/** Skeleton: compares nothing yet. */
export async function checkSnapshot(_pkgRoot: string): Promise<ConformanceReport> {
  return { checks: [], findings: [] };
}
