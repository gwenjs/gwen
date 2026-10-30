#!/usr/bin/env node
/**
 * Fold wasm-profile-matrix bench JSON.
 * One row is one file, one group and one bench name.
 * The cell metric is the sum of the medians of the included rows.
 * Report mode exits 0. A missing cell is a `missing` row and `winner: incomplete`.
 * `--winner` exits 1 when a needed L0 row, its wasm file, or a finite median is missing.
 * Malformed JSON exits 1.
 * A spread above 5% is the flag "re-run".
 *
 * vitest bench JSON (vitest 4.1.2): files[].groups[].benchmarks[]
 * with median and p99 in milliseconds. ns/op = median ms × 1e6.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { measureBuffer } from "./check-wasm-size.mjs";

const P3_BENCH_MAX = 0.9;
const P3_BROTLI_MAX = 1.15;
const S1_BENCH_MAX = 0.9;
const S1_BROTLI_MAX = 1.03;
const P2_BENCH_MAX = 0.95;
const P2_BROTLI_MAX = 1.1;
const S1R_BENCH_MAX = 0.95;
const S1R_BROTLI_MAX = 1.05;

/**
 * Path B never enters the WASM binary.
 * The whole group is `packages/core/bench/shared-memory.bench.ts:265`.
 * Mixed groups repeat that label on the bench name
 * (`packages/core/bench/shared-memory.bench.ts:287`, `packages/core/bench/shared-memory.bench.ts:298`).
 */
export const NON_WASM_MARK = "Flat JS Float32Array";

const FILE_RE = /^(P[123]-S(?:1R|[01]))-(L1-)?(?:sim-|shared-|iter-)?r(\d+)\.json$/;
const LTO_RE = /-C lto(=fat)?(\s|$)/;

/**
 * @param {number[]} values
 * @returns {number}
 */
function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/**
 * @param {{ median?: number }} benchmark
 * @returns {number}
 */
function msOf(benchmark) {
  if (typeof benchmark.median === "number" && Number.isFinite(benchmark.median))
    return benchmark.median;
  return Number.NaN;
}

/**
 * @param {number} spreadPct
 * @returns {string}
 */
export function rerunFlag(spreadPct) {
  if (spreadPct > 5) return "re-run";
  return "";
}

/**
 * @param {string} log
 * @returns {boolean}
 */
export function l1Void(log) {
  return !LTO_RE.test(log);
}

/**
 * @param {{ medianNs: number, brotli: number }} candidate
 * @param {{ medianNs: number, brotli: number }} baseline
 * @param {number} benchMax
 * @param {number} brotliMax
 * @returns {boolean}
 */
function replaces(candidate, baseline, benchMax, brotliMax) {
  if (candidate.medianNs === baseline.medianNs) return candidate.brotli < baseline.brotli;
  return (
    candidate.medianNs <= baseline.medianNs * benchMax &&
    candidate.brotli <= baseline.brotli * brotliMax
  );
}

/**
 * @param {string} variant
 * @returns {string[]}
 */
export function neededL0(variant) {
  const ids = ["P1:S0", "P1:S1", "P2:S0", "P2:S1", "P3:S0", "P3:S1"];
  if (variant !== "light") ids.push("P2:S1R", "P3:S1R");
  return ids;
}

/**
 * @param {{ medianNs: number }[]} benches
 * @returns {number}
 */
export function sumMedianNs(benches) {
  return benches.reduce((sum, bench) => sum + bench.medianNs, 0);
}

/**
 * @param {unknown} report
 * @returns {{ key: string, file: string, group: string, name: string, median: number, p99: number }[]}
 */
export function includedBenchRows(report) {
  if (!report || typeof report !== "object") return [];
  const files = Reflect.get(report, "files");
  if (!Array.isArray(files)) return [];
  /** @type {{ key: string, file: string, group: string, name: string, median: number, p99: number }[]} */
  const found = [];
  for (const file of files) {
    if (!file || typeof file !== "object") continue;
    const fileName = String(Reflect.get(file, "filepath") ?? Reflect.get(file, "name") ?? "");
    const groups = Reflect.get(file, "groups");
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      if (!group || typeof group !== "object") continue;
      const fullName = String(Reflect.get(group, "fullName") ?? "");
      const rows = Reflect.get(group, "benchmarks");
      if (!Array.isArray(rows)) continue;
      for (const bench of rows) {
        if (!bench || typeof bench !== "object") continue;
        const name = String(Reflect.get(bench, "name") ?? "");
        if (`${fileName}\n${fullName}\n${name}`.includes(NON_WASM_MARK)) continue;
        found.push({
          key: `${fileName}\n${fullName}\n${name}`,
          file: fileName,
          group: fullName,
          name,
          median: Number(Reflect.get(bench, "median")),
          p99: Number(Reflect.get(bench, "p99")),
        });
      }
    }
  }
  return found;
}

/**
 * Fold one bench key across vitest JSON runs.
 * Each report is one run. median and p99 on benchmarks[] are milliseconds.
 * @param {unknown[]} reports
 * @returns {{ medianNs: number, p99Ns: number, spreadPct: number }}
 */
export function foldRuns(reports) {
  const key = includedBenchRows(reports[0])[0]?.key ?? "";
  const samples = reports.map((report) => {
    const rows = includedBenchRows(report).filter((bench) => bench.key === key);
    return {
      medianMs: median(rows.map((bench) => msOf(bench))),
      p99Ms: median(rows.map((bench) => bench.p99)),
    };
  });
  const medians = samples.map((sample) => sample.medianMs);
  const medianMs = median(medians);
  const p99Ms = median(samples.map((sample) => sample.p99Ms));
  const spreadPct =
    medianMs === 0 ? 0 : ((Math.max(...medians) - Math.min(...medians)) / medianMs) * 100;
  return { medianNs: medianMs * 1e6, p99Ns: p99Ms * 1e6, spreadPct };
}

/**
 * @param {string} file
 * @returns {unknown}
 */
function readReport(file) {
  let text = "";
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`wasm-profile-table: cannot read ${file}: ${message}\n`);
    process.exit(1);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`wasm-profile-table: malformed JSON in ${file}: ${message}\n`);
    process.exit(1);
  }
}

/**
 * @param {string} outDir
 * @returns {Map<string, Map<string, unknown[]>>}
 */
function runsByCell(outDir) {
  /** @type {Map<string, Map<string, unknown[]>>} */
  const cells = new Map();
  let names = [];
  try {
    names = readdirSync(outDir);
  } catch {
    return cells;
  }
  for (const name of names) {
    const match = FILE_RE.exec(name);
    if (!match) continue;
    const token = match[1] ?? "";
    const level = match[2] ? "L1" : "L0";
    const run = match[3] ?? "";
    const key = `${token}|${level}`;
    const runs = cells.get(key) ?? new Map();
    const list = runs.get(run) ?? [];
    list.push(readReport(path.join(outDir, name)));
    runs.set(run, list);
    cells.set(key, runs);
  }
  return cells;
}

/**
 * @param {string} id
 * @param {string} level
 * @param {string} cellsDir
 * @param {string} ltoDir
 * @param {{ name: string, medianNs: number, p99Ns: number, spreadPct: number }[]} benches
 */
function cellRecord(id, level, cellsDir, ltoDir, benches) {
  const token = id.replace(":", "-");
  const wasmName = level === "L1" ? `${token}-L1.wasm` : `${token}.wasm`;
  const wasmPath = path.join(cellsDir, wasmName);
  let raw = 0;
  let gzip = 0;
  let brotli = 0;
  let wasmMissing = false;
  try {
    const measured = measureBuffer(readFileSync(wasmPath));
    raw = measured.raw;
    gzip = measured.gzip;
    brotli = measured.brotli;
  } catch {
    wasmMissing = true;
  }
  let voidCell = false;
  if (level === "L1") {
    let log = "";
    try {
      log = readFileSync(path.join(ltoDir, `${token}-L1.log`), "utf8");
    } catch {
      log = "";
    }
    voidCell = l1Void(log);
  }
  const spreadPct = benches.reduce((max, bench) => Math.max(max, bench.spreadPct), 0);
  const medianNs = benches.length === 0 ? Number.NaN : sumMedianNs(benches);
  return {
    id,
    level,
    medianNs,
    brotli,
    raw,
    gzip,
    spreadPct,
    voidCell,
    wasmMissing,
    flag: voidCell ? "void" : rerunFlag(spreadPct),
    benches,
  };
}

/**
 * @param {ReturnType<typeof cellRecord>[]} rows
 * @param {string} variant
 * @returns {string}
 */
export function decideWinner(rows, variant) {
  const live = new Map(
    rows.filter((row) => row.level === "L0" && !row.voidCell).map((row) => [row.id, row]),
  );
  const p1 = live.get("P1:S0");
  const p3 = live.get("P3:S0");
  const p2 = live.get("P2:S0");
  let profile = "P1";
  if (p1 && p3 && replaces(p3, p1, P3_BENCH_MAX, P3_BROTLI_MAX)) profile = "P3";
  if (profile === "P3" && p3 && p2 && replaces(p2, p3, P2_BENCH_MAX, P2_BROTLI_MAX)) profile = "P2";
  let simd = "S0";
  const s0 = live.get(`${profile}:S0`);
  const s1 = live.get(`${profile}:S1`);
  if (s0 && s1 && replaces(s1, s0, S1_BENCH_MAX, S1_BROTLI_MAX)) simd = "S1";
  if (simd === "S1" && variant !== "light") {
    const kept = live.get(`${profile}:S1`);
    const s1r = live.get(`${profile}:S1R`);
    if (kept && s1r && replaces(s1r, kept, S1R_BENCH_MAX, S1R_BROTLI_MAX)) simd = "S1R";
  }
  return `${profile}:${simd}`;
}

/**
 * @param {ReturnType<typeof cellRecord>[]} rows
 * @param {string} variant
 * @returns {string[]}
 */
function rowIssues(rows, variant) {
  const l0 = new Map(rows.filter((row) => row.level === "L0").map((row) => [row.id, row]));
  /** @type {string[]} */
  const issues = [];
  for (const id of neededL0(variant)) {
    const row = l0.get(id);
    if (!row) {
      issues.push(`missing L0 row ${id}`);
      continue;
    }
    if (row.wasmMissing) issues.push(`missing wasm for ${id}`);
    if (!Number.isFinite(row.medianNs)) issues.push(`missing median for ${id}`);
  }
  return issues;
}

/**
 * @param {string} outDir
 * @param {string} cellsDir
 * @param {string} ltoDir
 */
function loadRows(outDir, cellsDir, ltoDir) {
  /** @type {ReturnType<typeof cellRecord>[]} */
  const rows = [];
  for (const [key, runs] of runsByCell(outDir)) {
    const [token, level] = key.split("|");
    /** @type {Map<string, { file: string, group: string, name: string }>} */
    const labels = new Map();
    for (const reports of runs.values()) {
      for (const report of reports) {
        for (const bench of includedBenchRows(report)) {
          labels.set(bench.key, { file: bench.file, group: bench.group, name: bench.name });
        }
      }
    }
    /** @type {{ name: string, medianNs: number, p99Ns: number, spreadPct: number }[]} */
    const benches = [];
    for (const [benchKey, label] of labels) {
      const perRun = [...runs.values()].map((group) => {
        const found = group.flatMap((report) =>
          includedBenchRows(report).filter((bench) => bench.key === benchKey),
        );
        const bench = found[0];
        if (!bench) {
          return {
            files: [
              {
                filepath: label.file,
                groups: [{ fullName: label.group, benchmarks: [{ name: label.name }] }],
              },
            ],
          };
        }
        return {
          files: [
            {
              filepath: bench.file,
              groups: [
                {
                  fullName: bench.group,
                  benchmarks: [{ name: bench.name, median: bench.median, p99: bench.p99 }],
                },
              ],
            },
          ],
        };
      });
      const folded = foldRuns(perRun);
      benches.push({ name: `${label.file} | ${label.group} | ${label.name}`, ...folded });
    }
    rows.push(cellRecord(token?.replace("-", ":") ?? "", level ?? "L0", cellsDir, ltoDir, benches));
  }
  return rows;
}

/**
 * @param {ReturnType<typeof cellRecord>} row
 * @returns {boolean}
 */
function rowMissing(row) {
  return row.wasmMissing || !Number.isFinite(row.medianNs);
}

/**
 * @param {ReturnType<typeof cellRecord>[]} rows
 * @param {string} winner
 * @param {string[]} issues
 * @returns {string}
 */
function render(rows, winner, issues) {
  const lines = [
    "| cell | level | bench | median ns/op | p99 ns | spread % | raw | gzip | brotli | flag |",
    "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
  ];
  const seen = new Set(rows.map((row) => `${row.level}|${row.id}`));
  for (const issue of issues) {
    const match = /^missing L0 row (\S+)$/.exec(issue);
    if (!match) continue;
    const id = match[1] ?? "";
    if (seen.has(`L0|${id}`)) continue;
    lines.push(`| ${id} | L0 | — | — | — | — | — | — | — | missing |`);
  }
  for (const row of rows) {
    if (rowMissing(row)) {
      lines.push(`| ${row.id} | ${row.level} | — | — | — | — | — | — | — | missing |`);
      continue;
    }
    const benches =
      row.benches.length > 0
        ? row.benches
        : [{ name: "", medianNs: row.medianNs, p99Ns: 0, spreadPct: row.spreadPct }];
    for (const bench of benches) {
      lines.push(
        `| ${row.id} | ${row.level} | ${bench.name} | ${Math.round(bench.medianNs)} | ${Math.round(bench.p99Ns)} | ${bench.spreadPct.toFixed(2)} | ${row.raw} | ${row.gzip} | ${row.brotli} | ${row.flag} |`,
      );
    }
  }
  lines.push("", `winner: ${winner}`, "");
  lines.push(
    "The cell metric is the sum of the medians of the included rows. Pure JS rows whose name or group contains Flat JS Float32Array are excluded. P2 is compared only to P3. L1 is the winning profile at S0 and at S1. An L1 row whose log does not match `-C lto` or `-C lto=fat` is void.",
  );
  return lines.join("\n");
}

function main() {
  const args = process.argv.slice(2);
  const value = (flag) => {
    const index = args.indexOf(flag);
    return index === -1 ? "" : (args[index + 1] ?? "");
  };
  const variant = value("--variant") || "light";
  const outDir = value("--out") || "out";
  const cellsDir = value("--cells") || "cells";
  const ltoDir = value("--lto") || "lto";
  const rows = loadRows(outDir, cellsDir, ltoDir);
  const issues = rowIssues(rows, variant);
  const winner = issues.length > 0 ? "incomplete" : decideWinner(rows, variant);
  if (args.includes("--winner")) {
    if (issues.length > 0) {
      process.stderr.write(`wasm-profile-table: ${issues.join("; ")}\n`);
      process.exit(1);
    }
    process.stdout.write(`${winner}\n`);
    return;
  }
  process.stdout.write(`${render(rows, winner, issues)}\n`);
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entry === fileURLToPath(import.meta.url)) main();
