import type { PackageContext } from "./package-context.js";
import type { ConformanceFinding } from "./types.js";

export async function checkAugment(
  _context: PackageContext,
): Promise<readonly ConformanceFinding[]> {
  return [];
}
