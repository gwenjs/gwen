/**
 * Check each package's public-api.snap.json against its built types, through checkSnapshot of
 * @gwenjs/plugin-conformance (the library the packages' public-api tests use).
 *
 * The findings in snapshot-known-findings.json are known and must be reported exactly: a finding
 * missing from that file fails, and so does an entry that is no longer reported, and so does a
 * key that names no scanned package.
 * `--root <dir>` scans `<dir>/packages` instead of this repository.
 * `--known <file>` reads the known findings from `<file>` instead of snapshot-known-findings.json.
 * The snapshot is never written here: run `gwen-conformance check --write` for that.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkSnapshot } from "../packages/plugin-conformance/dist/index.js";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const rootFlag = process.argv.indexOf("--root");
const rootArg = rootFlag === -1 ? path.dirname(scriptsDir) : process.argv[rootFlag + 1];
const knownFlag = process.argv.indexOf("--known");
const knownArg =
  knownFlag === -1
    ? path.join(scriptsDir, "snapshot-known-findings.json")
    : process.argv[knownFlag + 1];
if (rootArg === undefined || knownArg === undefined) {
  console.error("usage: node scripts/public-api-types.mjs [--root <dir>] [--known <file>]");
  process.exit(2);
}
const root = path.resolve(rootArg);
const known = JSON.parse(readFileSync(path.resolve(knownArg), "utf8"));

const packages = readdirSync(path.join(root, "packages")).filter((dir) =>
  existsSync(path.join(root, "packages", dir, "package.json")),
);

let failed = false;
const visited = new Set();
for (const dir of packages) {
  const pkgDir = path.join(root, "packages", dir);
  const manifest = JSON.parse(readFileSync(path.join(pkgDir, "package.json"), "utf8"));
  if (!manifest.exports || !existsSync(path.join(pkgDir, "public-api.snap.json"))) continue;
  visited.add(manifest.name);
  const report = await checkSnapshot(pkgDir);
  const actual = report.findings.map((finding) => `${finding.code} ${finding.message}`);
  const pinned = known[manifest.name] ?? [];
  const unexpected = actual.filter((entry) => !pinned.includes(entry));
  const stale = pinned.filter((entry) => !actual.includes(entry));
  for (const entry of unexpected) console.error(`${manifest.name}: ${entry}`);
  for (const entry of stale) {
    console.error(`${manifest.name}: known finding no longer reported: ${entry}`);
  }
  if (unexpected.length > 0 || stale.length > 0) failed = true;
}

const unvisited = Object.keys(known).filter((name) => !visited.has(name));
for (const name of unvisited) {
  console.error(`${name}: known findings name no scanned package`);
}
if (unvisited.length > 0) failed = true;

if (failed) process.exit(1);
