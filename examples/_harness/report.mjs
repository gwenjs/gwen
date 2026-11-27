import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import { stableGzipBytes } from "../../scripts/stable-gzip.mjs";

/** Core wasm variant each example declares. */
export const VARIANTS = {
  "hello-light": "light",
  "hello-3d": "physics3d",
  "platformer-2d": "physics2d",
};

/** Examples root. Tests set `GWEN_EXAMPLES_DIR` to a temp tree. */
const examplesDir =
  process.env["GWEN_EXAMPLES_DIR"] ??
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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
 * Sizes of the built `dist/` of one example. `wasmGzipBytes` is gzip summed
 * per file, like `scripts/check-wasm-size.mjs`. `jsGzipBytes` is the stable
 * measure, built without the wasm build id and asset hashes. Frame time is
 * not measured here: `fps` and `rawFrameTimeMs` stay `null` until a probe
 * fills them.
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
  /**
   * JS only: the build id and asset hashes of the wasm are replaced first (stable-gzip.mjs).
   * `jsGzipBytes` is the stable measure, built without the wasm build id and asset hashes.
   *
   * @param {string[]} list
   */
  const stableGzipSize = (list) =>
    list.reduce((sum, file) => sum + stableGzipBytes(readFileSync(path.join(dist, file))), 0);
  return {
    example,
    variant,
    wasmFiles,
    jsBytes: size(jsFiles),
    jsGzipBytes: stableGzipSize(jsFiles),
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

/**
 * Markdown table of one report for `$GITHUB_STEP_SUMMARY`.
 * An unmeasured frame time prints `n/a`.
 *
 * @param {{
 *   example: string,
 *   variant: string,
 *   jsGzipBytes: number,
 *   wasmGzipBytes: number,
 *   fps: number | null,
 *   rawFrameTimeMs: number | null,
 * }} report
 */
export function formatSummary(report) {
  const time = (value, unit) => (value === null ? "n/a" : `${value.toFixed(1)} ${unit}`);
  return [
    `### example-smoke: ${report.example} (${report.variant})`,
    "",
    "| js gzip | wasm gzip | fps | frame time |",
    "|---|---|---|---|",
    `| ${report.jsGzipBytes} B | ${report.wasmGzipBytes} B | ${time(report.fps, "fps")} | ${time(report.rawFrameTimeMs, "ms")} |`,
    "",
  ].join("\n");
}

/**
 * Rewrites the report with `dist/probe.json` when the Playwright run wrote it.
 *
 * @param {string} example Directory name under `examples/`, one key of `VARIANTS`.
 */
export function summarize(example) {
  const report = buildReport(example);
  const probeFile = path.join(examplesDir, example, "dist", "probe.json");
  if (existsSync(probeFile)) {
    const probe = JSON.parse(readFileSync(probeFile, "utf8"));
    report.fps = probe.fps;
    report.rawFrameTimeMs = probe.rawFrameTimeMs;
  }
  const file = path.join(examplesDir, example, "dist", "gwen-example-report.json");
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
  return formatSummary(report);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const example = process.argv[2];
  if (example === undefined || !Object.hasOwn(VARIANTS, example)) {
    throw new Error(`Usage: node report.mjs <${Object.keys(VARIANTS).join("|")}>`);
  }
  const dist = path.join(examplesDir, example, "dist");
  if (!existsSync(dist)) {
    process.stdout.write(`### example-smoke: ${example}: no build output\n`);
  } else {
    process.stdout.write(summarize(example));
  }
}
