import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Published `sideEffects` policy. `null` means the key is not declared.
 * One `deepEqual` compares both the values and the package set.
 *
 * @type {Record<string, false | string[] | null>}
 */
const EXPECTED_SIDE_EFFECTS = {
  "@gwenjs/app": false,
  "@gwenjs/camera-core": false,
  // wasm-pack glue: scripts/build-wasm.sh:327 (`--out-name gwen_core`).
  "@gwenjs/core": ["./wasm/**"],
  "@gwenjs/kit": false,
  "@gwenjs/math": false,
  "@gwenjs/physics-core": false,
  "@gwenjs/physics2d": false,
  // BVH worker: self.onmessage at packages/physics3d/src/plugin/bvh-worker.ts:70.
  "@gwenjs/physics3d": ["./dist/**/bvh-worker*.js"],
  // wasm-pack glue: scripts/build-wasm.sh:392 (`--out-name gwen_physics3d_fracture`).
  "@gwenjs/physics3d-fracture": ["./wasm/**"],
  // Node-only tooling whose dist is not verified side-effect free.
  "@gwenjs/plugin-conformance": null,
  "@gwenjs/renderer-core": false,
  "@gwenjs/schema": false,
  // Node-only tooling whose dist is not verified side-effect free.
  "@gwenjs/vite": null,
};

/**
 * @param {Record<string, false | string[] | null>} table
 * @returns {Record<string, false | string[] | null>}
 */
function sortKeys(table) {
  /** @type {Record<string, false | string[] | null>} */
  const sorted = {};
  for (const key of Object.keys(table).sort()) sorted[key] = table[key];
  return sorted;
}

/** @returns {Record<string, false | string[] | null>} */
function publishedSideEffects() {
  /** @type {Record<string, false | string[] | null>} */
  const actual = {};
  const packagesDir = join(root, "packages");
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifest = JSON.parse(
      readFileSync(join(packagesDir, entry.name, "package.json"), "utf8"),
    );
    if (manifest.private === true) continue;
    actual[manifest.name] = manifest.sideEffects ?? null;
  }
  return sortKeys(actual);
}

test("every non-private package declares sideEffects as the table says", () => {
  assert.deepEqual(publishedSideEffects(), sortKeys(EXPECTED_SIDE_EFFECTS));
});
