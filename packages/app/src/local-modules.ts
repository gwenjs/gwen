import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";

/**
 * Infers the module name from its absolute file path and the absolute base directory.
 *
 * Rules:
 * - `<dir>/score.ts`         → `local:score`
 * - `<dir>/score/index.ts`   → `local:score`
 * - The `local:` prefix marks it as a user-local module (avoids npm namespace collisions).
 *
 * @param filePath - Absolute path to the module file.
 * @param dir      - Absolute path to the modules directory.
 * @returns Inferred module name in `local:<slug>` format.
 *
 * @example
 * ```ts
 * inferModuleName('/project/src/modules/score.ts', '/project/src/modules')
 * // => 'local:score'
 * inferModuleName('/project/src/modules/score/index.ts', '/project/src/modules')
 * // => 'local:score'
 * ```
 */
export function inferModuleName(filePath: string, dir: string): string {
  const rel = relative(dir, filePath);
  const parts = rel.split(sep);
  if (parts.length === 2 && (parts[1] === "index.ts" || parts[1] === "index.tsx")) {
    return `local:${parts[0]}`;
  }
  const file = basename(rel);
  const slug = file.replace(/\.tsx?$/, "");
  return `local:${slug}`;
}

/**
 * Scans `dir` for local module source files. Returns flat `.ts`/`.tsx` files
 * and `<name>/index.ts` / `<name>/index.tsx` files one level deep.
 * Excludes test files and type declarations.
 * Returns entries sorted alphabetically by inferred module name.
 *
 * @param dir - Absolute path to the modules directory.
 * @returns Sorted array of absolute file paths.
 *
 * @example
 * ```ts
 * scanLocalModuleFiles('/project/src/modules')
 * // => ['/project/src/modules/audio/index.ts', '/project/src/modules/score.ts']
 * ```
 */
export function scanLocalModuleFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const result: string[] = [];

  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);

    if (stat.isDirectory()) {
      for (const indexName of ["index.ts", "index.tsx"]) {
        const indexPath = join(full, indexName);
        if (existsSync(indexPath)) {
          result.push(indexPath);
          break;
        }
      }
      continue;
    }

    if (
      (entry.endsWith(".ts") || entry.endsWith(".tsx")) &&
      !entry.endsWith(".test.ts") &&
      !entry.endsWith(".test.tsx") &&
      !entry.endsWith(".d.ts")
    ) {
      result.push(full);
    }
  }

  return result.sort((a, b) => {
    const slugA = inferModuleName(a, dir).replace("local:", "");
    const slugB = inferModuleName(b, dir).replace("local:", "");
    return slugA.localeCompare(slugB);
  });
}
