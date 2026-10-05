#!/usr/bin/env node
/**
 * Turn the storage-bench outputs into one markdown table.
 * Fails only when a required model × metric cell is missing.
 *
 * Reads:
 *   target/criterion/**\/new/estimates.json
 *   target/storage-bench-bytes-rust.json
 *   target/storage-bench-bytes-js.json
 *   target/storage-models.ts.json
 */

import { execSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { cpus, arch, release, type } from "node:os";

const root = join(dirname(new URL(import.meta.url).pathname), "..");
const criterionRoot = join(root, "target/criterion");
const rustBytesPath = join(root, "target/storage-bench-bytes-rust.json");
const jsBytesPath = join(root, "target/storage-bench-bytes-js.json");
const vitestPath = join(root, "target/storage-models.ts.json");
const summaryPath = join(root, "target/storage-bench-summary.md");

const SIZES = [1000, 10000];
const METRICS = ["iter_ns_per_entity", "add_us", "remove_us", "frame_us", "bytes_per_entity"];
const REQUIRED = [
  ["today", "js"],
  ["A", "js"],
  ["B", "js"],
  ["C", "js"],
  ["A.prod", "rust"],
  ["A.direct", "rust"],
  ["B", "rust"],
  ["C", "rust"],
];

function readJson(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

function walkEstimates(dir, out) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      walkEstimates(path, out);
      continue;
    }
    if (entry !== "estimates.json" || !path.endsWith(`${join("new", "estimates.json")}`)) continue;
    // Criterion stores full_id with slashes and a sanitized directory_name.
    const benchmark = readJson(join(dirname(path), "benchmark.json"));
    const id = typeof benchmark?.full_id === "string"
      ? benchmark.full_id
      : relative(criterionRoot, dirname(dirname(path))).split(/[/\\]/).join("/");
    const estimate = readJson(path);
    const median = estimate?.median?.point_estimate;
    if (typeof median === "number") out.set(id, median);
  }
}

function cellKey(model, runtime, size, metric) {
  return `${runtime}|${model}|${size}|${metric}`;
}

function addCell(cells, model, runtime, size, metric, value) {
  if (!Number.isFinite(value)) return;
  cells.set(cellKey(model, runtime, size, metric), value);
}

function formatValue(value) {
  if (value >= 100) return value.toFixed(1);
  if (value >= 1) return value.toFixed(3);
  return value.toPrecision(4);
}

function command(cmd) {
  try {
    return execSync(cmd, { cwd: root, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

const cells = new Map();
const estimates = new Map();
walkEstimates(criterionRoot, estimates);
for (const [id, medianNs] of estimates) {
  const match = id.match(/storage\/rust\/([^/]+)\/E(\d+)\/(iter|add|remove|frame)$/);
  if (!match) continue;
  const model = match[1];
  const size = Number(match[2]);
  const metric = match[3];
  if (metric === "iter") addCell(cells, model, "rust", size, "iter_ns_per_entity", medianNs / size);
  if (metric === "add") addCell(cells, model, "rust", size, "add_us", medianNs / 1e3);
  if (metric === "remove") addCell(cells, model, "rust", size, "remove_us", medianNs / 1e3);
  if (metric === "frame") addCell(cells, model, "rust", size, "frame_us", medianNs / 1e3);
}

const vitest = readJson(vitestPath);
for (const file of vitest?.files ?? []) {
  for (const group of file.groups ?? []) {
    for (const benchmark of group.benchmarks ?? []) {
      const name = benchmark.name ?? "";
      const match = name.match(/^(today|A|B|C)\/E(\d+)\/(iter|add|remove|frame)$/);
      if (!match) continue;
      const model = match[1];
      const size = Number(match[2]);
      const metric = match[3];
      const medianMs = typeof benchmark.median === "number"
        ? benchmark.median
        : typeof benchmark.hz === "number" && benchmark.hz > 0
          ? 1000 / benchmark.hz
          : Number.NaN;
      const medianNs = medianMs * 1e6;
      if (metric === "iter") addCell(cells, model, "js", size, "iter_ns_per_entity", medianNs / size);
      if (metric === "add") addCell(cells, model, "js", size, "add_us", medianNs / 1e3);
      if (metric === "remove") addCell(cells, model, "js", size, "remove_us", medianNs / 1e3);
      if (metric === "frame") addCell(cells, model, "js", size, "frame_us", medianNs / 1e3);
    }
  }
}

for (const payload of [readJson(rustBytesPath), readJson(jsBytesPath)]) {
  if (!payload) continue;
  const runtime = payload.runtime === "js" ? "js" : "rust";
  for (const row of payload.rows ?? []) {
    addCell(cells, row.model, runtime, row.e, "bytes_per_entity", row.bytes / row.e);
  }
}

const missing = [];
for (const [model, runtime] of REQUIRED) {
  for (const size of SIZES) {
    for (const metric of METRICS) {
      if (!cells.has(cellKey(model, runtime, size, metric))) {
        missing.push(`${runtime} ${model} E=${size} ${metric}`);
      }
    }
  }
}

const runId = process.env.GITHUB_RUN_ID;
const repository = process.env.GITHUB_REPOSITORY;
const server = process.env.GITHUB_SERVER_URL ?? "https://github.com";
const ciUrl = runId && repository ? `${server}/${repository}/actions/runs/${runId}` : "local run (no CI URL)";
const cpu = cpus()[0]?.model ?? "unknown";
const lines = [];
lines.push("## Storage bench");
lines.push("");
lines.push(`CPU: ${cpu}`);
lines.push(`OS: ${type()} ${release()} ${arch()}`);
lines.push(`rustc: ${command("rustc --version")}`);
lines.push(`Node: ${process.version}`);
lines.push(`Commit: ${command("git rev-parse HEAD")}`);
lines.push(`CI run: ${ciUrl}`);
lines.push("");
lines.push("Native rows are Rust on the host target (not wasm32). `today` and JS A/B/C are Node.");
lines.push("`A.prod` bytes are component payload visible through the public API, not allocator capacity.");
lines.push("JS A/B/C bytes are the WebAssembly.Memory allocation, rounded up to 64 KiB pages.");
lines.push("");
lines.push("| model | runtime | E | iter_ns_per_entity | add_us | remove_us | frame_us | bytes_per_entity |");
lines.push("| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |");
for (const [model, runtime] of REQUIRED) {
  for (const size of SIZES) {
    const values = METRICS.map((metric) => {
      const value = cells.get(cellKey(model, runtime, size, metric));
      return value === undefined ? "MISSING" : formatValue(value);
    });
    lines.push(`| ${model} | ${runtime === "rust" ? "native Rust" : "JS"} | ${size} | ${values.join(" | ")} |`);
  }
}
if (missing.length > 0) {
  lines.push("");
  lines.push("Missing cells:");
  for (const item of missing) lines.push(`- ${item}`);
}
const markdown = `${lines.join("\n")}\n`;
mkdirSync(dirname(summaryPath), { recursive: true });
writeFileSync(summaryPath, markdown);
const summary = process.env.GITHUB_STEP_SUMMARY;
if (summary) appendFileSync(summary, markdown);
process.stdout.write(markdown);
if (missing.length > 0) {
  process.stderr.write(`storage-bench: ${missing.length} cells missing\n`);
  process.exit(1);
}
