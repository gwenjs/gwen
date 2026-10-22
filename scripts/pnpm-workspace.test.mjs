import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * pnpm 12 fails `pnpm install --frozen-lockfile` with ERR_PNPM_IGNORED_BUILDS
 * on esbuild's build script. `onlyBuiltDependencies` does not fix it on pnpm 12.
 * @param {string} text
 * @returns {string[]}
 */
function allowBuildsBlock(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line === "allowBuilds:");
  /** @type {string[]} */
  const block = [];
  if (start === -1) return block;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (/^\S/.test(line)) break;
    if (/^\s+\S/.test(line)) block.push(line);
  }
  return block;
}

test("pnpm-workspace.yaml allows only the esbuild build script", () => {
  const text = readFileSync(join(root, "pnpm-workspace.yaml"), "utf8");
  assert.deepEqual(
    allowBuildsBlock(text),
    ["  esbuild: true"],
    "allowBuilds must be exactly esbuild: true so pnpm 12 does not fail with ERR_PNPM_IGNORED_BUILDS",
  );
  assert.equal(/^dangerouslyAllowAllBuilds:/m.test(text), false);
  assert.equal(/^onlyBuiltDependencies:/m.test(text), false);
});
