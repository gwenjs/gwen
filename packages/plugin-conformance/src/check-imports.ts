import type { PackageContext } from "./package-context.js";
import type { ConformanceFinding } from "./types.js";

/** Import rules. */
export async function checkImports(
  context: PackageContext,
): Promise<readonly ConformanceFinding[]> {
  void context;
  return [];
}
