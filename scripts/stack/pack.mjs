#!/usr/bin/env node
/**
 * Pack every non-private packages/* at one integration stamp.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { currentStamp, stampVersion } from "./version.mjs";

/**
 * @typedef {{ dir: string, name: string, version: string }} FrameworkPackage
 */

/**
 * @param {string} root
 * @returns {FrameworkPackage[]}
 */
export function listFrameworkPackages(root) {
  const packagesDir = path.join(root, "packages");
  /** @type {import("node:fs").Dirent[]} */
  let entries;
  try {
    entries = readdirSync(packagesDir, { withFileTypes: true });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      throw new Error("STACK:NO_PACKAGES");
    }
    throw error;
  }
  /** @type {FrameworkPackage[]} */
  const found = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(packagesDir, entry.name);
    const file = path.join(dir, "package.json");
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT")
        continue;
      throw error;
    }
    const pkg = JSON.parse(text);
    if (pkg.private === true) continue;
    found.push({ dir, name: pkg.name, version: pkg.version });
  }
  if (found.length === 0) throw new Error("STACK:NO_PACKAGES");
  /** @type {Set<string>} */
  const names = new Set();
  for (const pkg of found) {
    if (names.has(pkg.name)) throw new Error(`STACK:DUPLICATE_PACKAGE: ${pkg.name}`);
    names.add(pkg.name);
  }
  found.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
  return found;
}

/**
 * pnpm 10 `pnpm pack` without install exits ERR_PNPM_CANNOT_RESOLVE_WORKSPACE_PROTOCOL for workspace:^ and workspace:*, so those ranges are rewritten to the stamp before packing.
 * @param {Record<string, unknown>} pkg
 * @param {string} version
 */
function rewriteWorkspaceRanges(pkg, version) {
  for (const sectionName of [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ]) {
    const section = pkg[sectionName];
    if (!section || typeof section !== "object") continue;
    for (const [name, range] of Object.entries(section)) {
      if (range === "workspace:^") section[name] = `^${version}`;
      else if (range === "workspace:*") section[name] = version;
    }
  }
  const packageName = typeof pkg.name === "string" ? pkg.name : "unknown";
  for (const sectionName of [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ]) {
    const section = pkg[sectionName];
    if (!section || typeof section !== "object") continue;
    for (const [name, range] of Object.entries(section)) {
      if (typeof range === "string" && range.startsWith("workspace:")) {
        throw new Error(`STACK:UNRESOLVED_WORKSPACE_RANGE: ${packageName}: ${name} ${range}`);
      }
    }
  }
}

/**
 * @param {string} version
 * @returns {string}
 */
function shaFromStamp(version) {
  const match = /\.g([0-9a-fA-F]{7})$/.exec(version);
  if (!match || !match[1]) throw new Error(`STACK:INVALID_STAMP: ${version}`);
  return match[1];
}

/**
 * @param {{ root: string, out: string, version: string }} options
 */
export function packFramework({ root, out, version }) {
  const packages = listFrameworkPackages(root);
  /** @type {[string, Buffer][]} */
  const originals = packages.map((pkg) => {
    const file = path.join(pkg.dir, "package.json");
    return [file, readFileSync(file)];
  });
  const tarballDir = path.join(out, "tarballs");
  mkdirSync(out, { recursive: true });
  rmSync(tarballDir, { recursive: true, force: true });
  rmSync(path.join(out, "stack-manifest.json"), { force: true });
  mkdirSync(tarballDir, { recursive: true });
  try {
    for (const [file] of originals) {
      const json = JSON.parse(readFileSync(file, "utf8"));
      json.version = version;
      rewriteWorkspaceRanges(json, version);
      writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
    }
    /** @type {{ name: string, file: string }[]} */
    const packed = [];
    for (const pkg of packages) {
      const before = new Set(readdirSync(tarballDir));
      const result = spawnSync("pnpm", ["pack", "--pack-destination", tarballDir], {
        cwd: pkg.dir,
        encoding: "utf8",
      });
      if (result.status !== 0) {
        const reason = `${result.stderr || ""}${result.stdout || ""}`.trim();
        throw new Error(`STACK:PACK_FAILED: ${pkg.name}: ${reason}`);
      }
      const created = readdirSync(tarballDir).filter(
        (name) => name.endsWith(".tgz") && !before.has(name),
      );
      const file = created[0];
      if (created.length !== 1 || !file) {
        throw new Error(
          `STACK:PACK_FAILED: ${pkg.name}: expected one tarball, got ${created.length}`,
        );
      }
      packed.push({ name: pkg.name, file });
    }
    const manifest = { version, sha: shaFromStamp(version), packages: packed };
    writeFileSync(path.join(out, "stack-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  } finally {
    for (const [file, bytes] of originals) writeFileSync(file, bytes);
  }
}

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  /** @type {{ root?: string, out?: string, sha?: string, now?: string }} */
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (next === undefined) throw new Error(`STACK:INVALID_ARG: ${arg}`);
    if (arg === "--root") parsed.root = next;
    else if (arg === "--out") parsed.out = next;
    else if (arg === "--sha") parsed.sha = next;
    else if (arg === "--now") parsed.now = next;
    else throw new Error(`STACK:INVALID_ARG: ${arg}`);
    index += 1;
  }
  return parsed;
}

function repoRoot() {
  return fileURLToPath(new URL("../..", import.meta.url));
}

function main() {
  try {
    const parsed = parseArgs(process.argv.slice(2));
    const root = parsed.root ?? repoRoot();
    const out = parsed.out ?? path.join(root, "stack");
    const date = parsed.now ? new Date(parsed.now) : new Date();
    if (Number.isNaN(date.getTime())) throw new Error(`STACK:INVALID_DATE: ${parsed.now}`);
    const version = parsed.sha
      ? stampVersion(parsed.sha, date)
      : currentStamp({ cwd: root, now: date });
    packFramework({ root, out, version });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entry === fileURLToPath(import.meta.url)) main();
