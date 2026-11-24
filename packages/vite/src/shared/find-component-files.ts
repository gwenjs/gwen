import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// ─── findComponentFiles ───────────────────────────────────────────────────────

/**
 * Recursively find all `.ts` and `.tsx` source files in a directory,
 * excluding test files (`*.test.ts`, `*.test.tsx`) and type declarations (`*.d.ts`).
 *
 * @param dir - The directory to search in.
 * @returns Array of absolute file paths.
 *
 * @example
 * ```ts
 * const files = findComponentFiles('/project/src')
 * // ['/project/src/components/position.ts', ...]
 * ```
 */
export function findComponentFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const result: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      result.push(...findComponentFiles(full));
    } else if (
      (entry.endsWith(".ts") || entry.endsWith(".tsx")) &&
      !entry.endsWith(".test.ts") &&
      !entry.endsWith(".test.tsx") &&
      !entry.endsWith(".d.ts")
    ) {
      result.push(full);
    }
  }
  return result;
}
