import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

/** Core wasm variant each example declares. */
export const VARIANTS = {
  "hello-light": "light",
  "hello-3d": "physics3d",
  "platformer-2d": "physics2d",
};

const examplesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Every file under `dir`, relative to it and posix-separated.
 *
 * @param {string} dir
 * @param {string} [base]
 * @returns {string[]}
 */
function walk(dir, base = dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full, base));
    else files.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return [...files].sort();
}

/**
 * Sizes of the built `dist/` of one example. Gzip is summed per file, like
 * `scripts/check-wasm-size.mjs`. Frame time is not measured here: `fps` and
 * `rawFrameTimeMs` stay `null` until a probe fills them.
 *
 * @param {string} example Directory name under `examples/`, one key of `VARIANTS`.
 */
export function buildReport(example) {
  const variant = VARIANTS[example];
  const dist = path.join(examplesDir, example, "dist");
  const files = walk(dist);
  const wasmFiles = files.filter((file) => file.endsWith(".wasm"));
  const jsFiles = files.filter((file) => file.endsWith(".js"));
  /** @param {string[]} list */
  const size = (list) =>
    list.reduce((sum, file) => sum + readFileSync(path.join(dist, file)).length, 0);
  /** @param {string[]} list */
  const gzipSize = (list) =>
    list.reduce(
      (sum, file) => sum + gzipSync(readFileSync(path.join(dist, file)), { level: 9 }).length,
      0,
    );
  return {
    example,
    variant,
    wasmFiles,
    jsBytes: size(jsFiles),
    jsGzipBytes: gzipSize(jsFiles),
    wasmBytes: size(wasmFiles),
    wasmGzipBytes: gzipSize(wasmFiles),
    fps: null,
    rawFrameTimeMs: null,
  };
}

/**
 * Writes `dist/gwen-example-report.json` of one example.
 *
 * @param {string} example Directory name under `examples/`.
 */
export function writeReport(example) {
  const report = buildReport(example);
  const file = path.join(examplesDir, example, "dist", "gwen-example-report.json");
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}
