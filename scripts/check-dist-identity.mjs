#!/usr/bin/env node
/**
 * Each shared runtime class ships in exactly one package's dist, so `instanceof` holds
 * across packages. Today that is `GwenError` (packages/schema). Core, kit and math must
 * import it from `@gwenjs/schema`, never bundle a second copy of it.
 *
 * Two checks, both on BUILT dists (run after `pnpm build:ts` and `fix-dts-extensions.mjs`):
 *   1. the class marker occurs only in the owner package's dist;
 *   2. runtime probe: `new core.GwenContextError("probe") instanceof schema.GwenError`.
 *
 * Run: node scripts/check-dist-identity.mjs [--root <repo>]
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * @typedef {{ pkg: string, path: string, text: string }} DistFile
 * @typedef {{ name: string, pattern: RegExp, owner: string }} Marker
 */

/**
 * One row per class (or module) that must exist once. `owner` is the directory under
 * `packages/` whose dist may hold it. The pattern matches the constructor form
 * (`this.name = "GwenError"`), the minified CJS form (`this.name=\`GwenError\``) and the
 * class-field form (`name = "GwenError"`, not preceded by `.` or a word character).
 * P-76-5 adds the kit markers (`GwenContextError`, `GwenComposableError`, the scope slot).
 * @type {Marker[]}
 */
export const MARKERS = [
  {
    name: "GwenError",
    pattern: /(?:this\.|(?<![\w$.]))name\s*=\s*["'`]GwenError["'`]/,
    owner: "schema",
  },
];

/**
 * @param {DistFile[]} distFiles
 * @param {Marker[]} [markers]
 * @returns {string[]} one line per dist file that holds a marker it does not own
 */
export function judge(distFiles, markers = MARKERS) {
  /** @type {string[]} */
  const problems = [];
  for (const file of distFiles) {
    for (const marker of markers) {
      if (file.pkg === marker.owner) continue;
      if (marker.pattern.test(file.text)) {
        problems.push(
          `${file.path}: bundles ${marker.name}, which only packages/${marker.owner}/dist may hold`,
        );
      }
    }
  }
  return problems;
}

/**
 * @param {string} dir
 * @param {string[]} found
 */
function walk(dir, found) {
  for (const name of readdirSync(dir).sort()) {
    if (name === "node_modules") continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, found);
    else if (name.endsWith(".js") || name.endsWith(".cjs")) found.push(full);
  }
}

/**
 * @param {string} root
 * @returns {DistFile[]}
 */
export function collectDistFiles(root) {
  const packagesDir = path.join(root, "packages");
  /** @type {DistFile[]} */
  const files = [];
  for (const pkg of readdirSync(packagesDir).sort()) {
    const dist = path.join(packagesDir, pkg, "dist");
    try {
      if (!statSync(dist).isDirectory()) continue;
    } catch {
      continue;
    }
    /** @type {string[]} */
    const found = [];
    walk(dist, found);
    for (const full of found) {
      files.push({
        pkg,
        path: path.relative(root, full).split(path.sep).join("/"),
        text: readFileSync(full, "utf8"),
      });
    }
  }
  return files;
}

/**
 * Loads the built entry points and checks that core's error class extends schema's.
 * @param {string} root
 * @returns {Promise<string[]>}
 */
export async function probe(root) {
  const entry = (pkg) => pathToFileURL(path.join(root, "packages", pkg, "dist", "index.js")).href;
  try {
    const core = await import(entry("core"));
    const schema = await import(entry("schema"));
    if (typeof core.GwenContextError !== "function" || typeof schema.GwenError !== "function") {
      return ["probe: core.GwenContextError or schema.GwenError is not exported by the built dist"];
    }
    if (!(new core.GwenContextError("probe") instanceof schema.GwenError)) {
      return ["probe: core.GwenContextError is not instanceof the GwenError of schema/dist"];
    }
    return [];
  } catch (error) {
    return [
      `probe: cannot load the built dists (${error instanceof Error ? error.message : error})`,
    ];
  }
}

async function main() {
  const rootFlag = process.argv.indexOf("--root");
  const root =
    rootFlag === -1
      ? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
      : path.resolve(process.argv[rootFlag + 1] ?? ".");
  const files = collectDistFiles(root);
  const problems = [...judge(files), ...(await probe(root))];
  if (problems.length > 0) {
    console.error(`Dist identity failed (${problems.length}):`);
    for (const problem of problems) console.error(`  ${problem}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `Dist identity ok: ${files.length} dist files, GwenError only in packages/schema/dist, core.GwenContextError instanceof schema.GwenError`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
