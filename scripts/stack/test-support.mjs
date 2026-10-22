/**
 * Shared fixture helpers for the stack harness tests.
 * Not a test file: `pnpm test:scripts` only runs `scripts/*.test.mjs`.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanGitEnv } from "./version.mjs";

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
  const result = spawnSync("git", args, { cwd: dir, encoding: "utf8", env: cleanGitEnv() });
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

// semver.org 2.0.0, section "Is there a suggested regular expression" (ECMAScript form).
// A numeric identifier is `0` or a non-zero digit plus digits: a leading zero is invalid.
const numeric = "0|[1-9]\\d*";
const prereleaseId = `(?:${numeric}|\\d*[a-zA-Z-][0-9a-zA-Z-]*)`;
const SEMVER_RE = new RegExp(
  `^(${numeric})\\.(${numeric})\\.(${numeric})(?:-(${prereleaseId}(?:\\.${prereleaseId})*))?(?:\\+([0-9a-zA-Z-]+(?:\\.[0-9a-zA-Z-]+)*))?$`,
);

/**
 * @param {string} text
 * @returns {boolean}
 */
export function isValidSemver(text) {
  return typeof text === "string" && SEMVER_RE.test(text);
}

/**
 * @param {string} text
 * @returns {{ major: number, minor: number, patch: number, prerelease: string[] | null } | null}
 */
function parseSemver(text) {
  const match = SEMVER_RE.exec(text);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] === undefined ? null : match[4].split("."),
  };
}

/**
 * Semver.org precedence for one pre-release identifier.
 * Numeric identifiers compare as numbers and rank below alphanumeric ones.
 * Alphanumeric identifiers compare by ASCII order.
 * @param {string} left
 * @param {string} right
 * @returns {number}
 */
function compareIdentifier(left, right) {
  const leftNum = /^[0-9]+$/.test(left);
  const rightNum = /^[0-9]+$/.test(right);
  if (leftNum && rightNum) return Number(left) - Number(right);
  if (leftNum !== rightNum) return leftNum ? -1 : 1;
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/**
 * A shorter identifier list is lower when every earlier identifier is equal.
 * @param {string[]} left
 * @param {string[]} right
 * @returns {number}
 */
function comparePrerelease(left, right) {
  const count = Math.min(left.length, right.length);
  for (let i = 0; i < count; i++) {
    const diff = compareIdentifier(left[i], right[i]);
    if (diff !== 0) return diff;
  }
  return left.length - right.length;
}

/**
 * Caret check for the base `1.0.0-alpha.0` only.
 * Accepts a valid version `>=1.0.0-alpha.0 <2.0.0`.
 * A prerelease is accepted only when it shares that major.minor.patch tuple.
 * @param {string} text
 * @param {string} base
 * @returns {boolean}
 */
export function satisfiesCaret(text, base) {
  if (base !== "1.0.0-alpha.0") return false;
  const version = parseSemver(text);
  if (!version || version.major !== 1) return false;
  if (version.prerelease === null) return true;
  if (version.minor !== 0 || version.patch !== 0) return false;
  return comparePrerelease(version.prerelease, ["alpha", "0"]) >= 0;
}
