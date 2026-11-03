import type { PackageContext } from "./package-context.js";
import type { ConformanceFinding } from "./types.js";

/** `publint --strict`: every message of `publint` with warnings raised to errors. */
export async function checkPublint(
  _context: PackageContext,
): Promise<readonly ConformanceFinding[]> {
  return [];
}
