/**
 * Shared fixture helpers for the stack harness tests.
 * Not a test file: `pnpm test:scripts` only runs `scripts/*.test.mjs`.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * @param {string} script
 * @param {string[]} args
 * @param {Record<string, string>} [env]
 */
export function runNode(script, args, env = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

/**
 * @param {string} dir
 * @param {string[]} args
 * @returns {string}
 */
export function git(dir, args) {
  const result = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "git failed").trim());
  }
  return (result.stdout || "").trim();
}

/**
 * @param {string} dir
 */
export function initRepo(dir) {
  git(dir, ["init", "-b", "main"]);
  git(dir, ["config", "user.email", "stack@example.com"]);
  git(dir, ["config", "user.name", "stack"]);
}

/**
 * @param {string} root
 * @param {{
 *   dir: string,
 *   name: string,
 *   version?: string,
 *   dependencies?: Record<string, string>,
 *   devDependencies?: Record<string, string>,
 *   scripts?: Record<string, string>,
 *   body?: string,
 * }[]} packages
 */
export function writeWorkspace(root, packages) {
  mkdirSync(join(root, "packages"), { recursive: true });
  writeFileSync(join(root, "pnpm-workspace.yaml"), 'packages:\n  - "packages/*"\n');
  writeFileSync(
    join(root, "package.json"),
    `${JSON.stringify({ name: "stack-fixture-root", private: true })}\n`,
  );
  for (const pkg of packages) {
    const dir = join(root, "packages", pkg.dir);
    mkdirSync(dir, { recursive: true });
    /** @type {Record<string, unknown>} */
    const manifest = {
      name: pkg.name,
      version: pkg.version ?? "0.0.0",
      main: "index.js",
    };
    if (pkg.dependencies) manifest.dependencies = pkg.dependencies;
    if (pkg.devDependencies) manifest.devDependencies = pkg.devDependencies;
    if (pkg.scripts) manifest.scripts = pkg.scripts;
    writeFileSync(join(dir, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    writeFileSync(join(dir, "index.js"), pkg.body ?? 'module.exports = "ok";\n');
  }
}
