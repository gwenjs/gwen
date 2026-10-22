import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Lowest version of each package that carries the fix for a high advisory. */
const PATCHED = {
  "source-map-js": { min: "1.2.2", advisory: "GHSA-68fv-2mgg-jv7q" },
};

function lockedVersions(lock, name) {
  const found = new Set();
  const entry = new RegExp(`^ {2}'?${name.replace(/[/@]/g, "\\$&")}@(\\d+\\.\\d+\\.\\d+)'?:`, "gm");
  for (const match of lock.matchAll(entry)) found.add(match[1]);
  return [...found];
}

function atLeast(version, min) {
  const a = version.split(".").map(Number);
  const b = min.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return true;
}

test("the lockfile resolves no package below its patched version", () => {
  const lock = readFileSync(join(root, "pnpm-lock.yaml"), "utf8");
  for (const [name, { min, advisory }] of Object.entries(PATCHED)) {
    const versions = lockedVersions(lock, name);
    assert.ok(versions.length > 0, `${name} is locked`);
    const stale = versions.filter((version) => !atLeast(version, min));
    assert.deepEqual(stale, [], `${name} below ${min} (${advisory})`);
  }
});
