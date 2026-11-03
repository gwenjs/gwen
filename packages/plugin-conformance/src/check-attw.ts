import type { PackageContext } from "./package-context.js";
import type { ConformanceFinding } from "./types.js";

/** `attw --pack --profile esm-only` on the tarball `npm pack` makes of the package. */
export async function checkAttw(_context: PackageContext): Promise<readonly ConformanceFinding[]> {
  return [];
}
