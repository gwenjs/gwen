import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import test from "node:test";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  decideWinner,
  foldRuns,
  includedBenchRows,
  l1Void,
  NON_WASM_MARK,
  rerunFlag,
  sumMedianNs,
} from "./wasm-profile-table.mjs";

/**
 * @param {string} id
 * @param {number} medianNs
 * @param {number} brotli
 * @param {Record<string, unknown>} [extra]
 */
function cell(id, medianNs, brotli, extra = {}) {
  return {
    id,
    level: "L0",
    medianNs,
    brotli,
    voidCell: false,
    raw: 1,
    gzip: 1,
    spreadPct: 0,
    flag: "",
    wasmMissing: false,
    benches: [],
    ...extra,
  };
}

/**
 * One vitest bench JSON. median and p99 are milliseconds, same as vitest 4.1.2.
 * @param {number} median
 * @param {number} p99
 */
function report(median, p99) {
  return {
    files: [
      {
        filepath: "bench/physics-step-wasm.bench.ts",
        groups: [
          {
            fullName: "bench/physics-step-wasm.bench.ts > physics step (real WASM)",
            benchmarks: [
              {
                id: "bench",
                name: "physics2d N=500",
                rank: 1,
                rme: 0,
                samples: [],
                totalTime: 500,
                min: median,
                max: median,
                hz: 1000 / median,
                period: median,
                mean: median,
                p75: median,
                p99,
                p995: p99,
                p999: p99,
                sampleCount: 10,
                median,
              },
            ],
          },
        ],
      },
    ],
  };
}

test("the decision rule picks P3 over P1 only when bench ≤ 0.90 and brotli ≤ 1.15", () => {
  const rows = (medianNs, brotli) => [
    cell("P1:S0", 1000, 1000),
    cell("P3:S0", medianNs, brotli),
    cell("P2:S0", 1000, 100000),
    cell("P1:S1", 1000, 100000),
    cell("P2:S1", 1000, 100000),
    cell("P3:S1", 1000, 100000),
  ];
  assert.equal(decideWinner(rows(900, 1000), "physics2d"), "P3:S0");
  assert.equal(decideWinner(rows(901, 1000), "physics2d"), "P1:S0");
  assert.equal(decideWinner(rows(900, 1150), "physics2d"), "P3:S0");
  assert.equal(decideWinner(rows(900, 1151), "physics2d"), "P1:S0");
});

test("S1 is kept only when bench ≤ 0.90 and brotli ≤ 1.03", () => {
  const rows = (medianNs, brotli) => [
    cell("P1:S0", 1000, 1000),
    cell("P1:S1", medianNs, brotli),
    cell("P3:S0", 1000, 100000),
    cell("P2:S0", 1000, 100000),
    cell("P1:S1R", 1000, 100000),
  ];
  assert.equal(decideWinner(rows(900, 1000), "physics2d"), "P1:S1");
  assert.equal(decideWinner(rows(901, 1000), "physics2d"), "P1:S0");
  assert.equal(decideWinner(rows(900, 1030), "physics2d"), "P1:S1");
  assert.equal(decideWinner(rows(900, 1031), "physics2d"), "P1:S0");
});

test("P2 replaces P3 only when bench ≤ 0.95 and brotli ≤ 1.10", () => {
  const rows = (medianNs, brotli) => [
    cell("P1:S0", 2000, 1000),
    cell("P3:S0", 1000, 1000),
    cell("P2:S0", medianNs, brotli),
    cell("P1:S1", 2000, 100000),
    cell("P2:S1", 2000, 100000),
    cell("P3:S1", 2000, 100000),
  ];
  assert.equal(decideWinner(rows(950, 1000), "physics2d"), "P2:S0");
  assert.equal(decideWinner(rows(951, 1000), "physics2d"), "P3:S0");
  assert.equal(decideWinner(rows(950, 1100), "physics2d"), "P2:S0");
  assert.equal(decideWinner(rows(950, 1101), "physics2d"), "P3:S0");
});

test("S1R is kept only when bench ≤ 0.95 and brotli ≤ 1.05", () => {
  const rows = (medianNs, brotli) => [
    cell("P1:S0", 2000, 1000),
    cell("P1:S1", 1000, 1000),
    cell("P1:S1R", medianNs, brotli),
    cell("P3:S0", 2000, 100000),
    cell("P2:S0", 2000, 100000),
  ];
  assert.equal(decideWinner(rows(950, 1000), "physics2d"), "P1:S1R");
  assert.equal(decideWinner(rows(951, 1000), "physics2d"), "P1:S1");
  assert.equal(decideWinner(rows(950, 1050), "physics2d"), "P1:S1R");
  assert.equal(decideWinner(rows(950, 1051), "physics2d"), "P1:S1");
});

test("a tie goes to the smaller binary", () => {
  assert.equal(
    decideWinner(
      [cell("P1:S0", 1000, 200), cell("P3:S0", 1000, 150), cell("P2:S0", 1000, 9000)],
      "physics2d",
    ),
    "P3:S0",
  );
});

test("a cell with spread > 5 % is flagged re-run", () => {
  assert.equal(rerunFlag(5), "");
  assert.equal(rerunFlag(5.1), "re-run");
});

test("light ignores a winning S1R row", () => {
  const rows = [
    cell("P1:S0", 2000, 1000),
    cell("P1:S1", 1000, 1000),
    cell("P1:S1R", 900, 1000),
    cell("P3:S0", 2000, 100000),
    cell("P2:S0", 2000, 100000),
  ];
  assert.equal(decideWinner(rows, "light"), "P1:S1");
  assert.equal(decideWinner(rows, "physics2d"), "P1:S1R");
});

test("P2 is not picked when it only beats P1", () => {
  assert.equal(
    decideWinner(
      [
        cell("P1:S0", 1000, 1000),
        cell("P3:S0", 950, 1000),
        cell("P2:S0", 500, 1000),
        cell("P1:S1", 1000, 100000),
      ],
      "physics2d",
    ),
    "P1:S0",
  );
  assert.equal(
    decideWinner(
      [cell("P1:S0", 2000, 1000), cell("P3:S0", 1000, 1000), cell("P2:S0", 1000, 100000)],
      "physics2d",
    ),
    "P3:S0",
  );
});

test("a void row is excluded from the winner", () => {
  assert.equal(
    decideWinner(
      [
        cell("P1:S0", 1000, 1000),
        cell("P3:S0", 100, 100, { voidCell: true }),
        cell("P2:S0", 1000, 100000),
      ],
      "physics2d",
    ),
    "P1:S0",
  );
  assert.equal(
    decideWinner([cell("P1:S0", 1000, 1000), cell("P3:S0", 100, 100)], "physics2d"),
    "P3:S0",
  );
});

test("an L1 log counts when it contains -C lto or -C lto=fat", () => {
  assert.equal(l1Void("rustc -C lto=fat -C opt-level=z\n"), false);
  assert.equal(l1Void("rustc -C lto -C opt-level=z\n"), false);
  assert.equal(l1Void("rustc -C opt-level=z -C codegen-units=1\n"), true);
  assert.equal(l1Void("rustc -C lto=thin -C opt-level=z\n"), true);
});

test("the cell metric skips pure JS rows and keeps same bench names apart", () => {
  const mark = NON_WASM_MARK;
  const sample = {
    files: [
      {
        filepath: "bench/simulation-wasm.bench.ts",
        groups: [
          {
            fullName: "bench/simulation-wasm.bench.ts > WASM ECS movement system — 1 frame",
            benchmarks: [{ name: "1 000 entities", median: 1, p99: 1 }],
          },
        ],
      },
      {
        filepath: "bench/shared-memory.bench.ts",
        groups: [
          {
            fullName:
              "bench/shared-memory.bench.ts > Movement 1 frame — A: Chatty WASM ECS (3N crossings, current)",
            benchmarks: [{ name: "1 000 entities", median: 2, p99: 2 }],
          },
          {
            fullName: `bench/shared-memory.bench.ts > Movement 1 frame — B: ${mark} (0 crossings, plugin owns data)`,
            benchmarks: [{ name: "1 000 entities", median: 0.01, p99: 0.01 }],
          },
          {
            fullName: "bench/shared-memory.bench.ts > Side-by-side — 1 000 entities, 1 frame",
            benchmarks: [
              { name: "A — Chatty WASM ECS     (3 000 crossings)", median: 3, p99: 3 },
              { name: `B — ${mark} (0 crossings)   `, median: 0.01, p99: 0.01 },
              { name: "C — WASM linear memory   (0 crossings)   ", median: 4, p99: 4 },
            ],
          },
          {
            fullName: "bench/shared-memory.bench.ts > Sustained 100 frames — 1 000 entities",
            benchmarks: [
              { name: "A — Chatty WASM ECS", median: 5, p99: 5 },
              { name: `B — ${mark}`, median: 0.02, p99: 0.02 },
            ],
          },
          {
            fullName: "bench/shared-memory.bench.ts > Sustained 100 frames — 5 000 entities",
            benchmarks: [{ name: "A — Chatty WASM ECS", median: 6, p99: 6 }],
          },
        ],
      },
    ],
  };
  const rows = includedBenchRows(sample);
  assert.equal(new Set(rows.map((row) => row.key)).size, rows.length);
  assert.equal(rows.filter((row) => row.name === "1 000 entities").length, 2);
  assert.equal(rows.filter((row) => row.name === "A — Chatty WASM ECS").length, 2);
  assert.equal(
    rows.some((row) => row.name.includes(mark) || row.group.includes(mark)),
    false,
  );
  assert.equal(sumMedianNs(rows.map((row) => ({ medianNs: row.median }))), 21);
});

test("measureBuffer is exported and returns raw/gzip/brotli byte counts", async () => {
  const size = await import("./check-wasm-size.mjs");
  assert.equal(typeof size.measureBuffer, "function");
  const buf = Buffer.from("profile-matrix");
  const measured = size.measureBuffer(buf);
  assert.equal(measured.raw, buf.length);
  assert.equal(measured.gzip, gzipSync(buf, { level: 9 }).length);
  assert.equal(
    measured.brotli,
    brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length,
  );
});

test("the table folds three interleaved runs into median ns/op, p99 and spread %", () => {
  const folded = foldRuns([report(1, 4), report(2, 8), report(9, 6)]);
  assert.equal(folded.medianNs, 2_000_000);
  assert.equal(folded.p99Ns, 6_000_000);
  assert.equal(folded.spreadPct, 400);
});

const scriptPath = fileURLToPath(new URL("./wasm-profile-table.mjs", import.meta.url));
const workflowPath = fileURLToPath(
  new URL("../.github/workflows/wasm-profile-matrix.yml", import.meta.url),
);

const LIGHT_L0 = ["P1:S0", "P1:S1", "P2:S0", "P2:S1", "P3:S0", "P3:S1"];

/**
 * @param {string} dir
 * @param {string} id
 * @param {number | undefined} median
 */
function writeRun(dir, id, median) {
  const token = id.replace(":", "-");
  /** @type {Record<string, unknown>} */
  const bench = { name: "physics2d N=500", p99: median ?? 1 };
  if (median !== undefined) bench.median = median;
  writeFileSync(
    path.join(dir, `${token}-r1.json`),
    JSON.stringify({
      files: [
        {
          filepath: "bench/physics-step-wasm.bench.ts",
          groups: [{ fullName: "physics step (real WASM)", benchmarks: [bench] }],
        },
      ],
    }),
  );
}

/**
 * @param {string[]} args
 * @param {(dir: { out: string, cells: string, lto: string }) => void} fill
 */
function runTable(args, fill) {
  const root = mkdtempSync(path.join(tmpdir(), "wasm-profile-"));
  const out = path.join(root, "out");
  const cells = path.join(root, "cells");
  const lto = path.join(root, "lto");
  for (const dir of [out, cells, lto]) mkdirSync(dir);
  try {
    fill({ out, cells, lto });
    return spawnSync(
      process.execPath,
      [scriptPath, "--variant", "light", "--out", out, "--cells", cells, "--lto", lto, ...args],
      { encoding: "utf8" },
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("--winner exits 1 when an L0 row is missing", () => {
  const result = runTable(["--winner"], () => {});
  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing L0 row P1:S0/);
});

test("--winner exits 1 when an L0 wasm file is missing", () => {
  const result = runTable(["--winner"], ({ out, cells }) => {
    for (const id of LIGHT_L0) {
      writeRun(out, id, 1);
      if (id === "P2:S0") continue;
      writeFileSync(path.join(cells, `${id.replace(":", "-")}.wasm`), Buffer.from("wasm"));
    }
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing wasm for P2:S0/);
});

test("--winner exits 1 when a median is missing", () => {
  const result = runTable(["--winner"], ({ out, cells }) => {
    for (const id of LIGHT_L0) {
      writeRun(out, id, id === "P3:S1" ? undefined : 1);
      writeFileSync(path.join(cells, `${id.replace(":", "-")}.wasm`), Buffer.from("wasm"));
    }
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing median for P3:S1/);
});

test("report mode marks a missing cell and does not name a winner", () => {
  const result = runTable([], () => {});
  assert.equal(result.status, 0);
  assert.match(result.stdout, /\| P1:S0 \| L0 \| — \| — \| — \| — \| — \| — \| — \| missing \|/);
  assert.match(result.stdout, /winner: incomplete/);
  assert.equal(result.stdout.includes("winner: P1:S0"), false);
});

test("malformed JSON exits 1", () => {
  const result = runTable(["--winner"], ({ out }) => {
    writeFileSync(path.join(out, "P1-S0-r1.json"), "{");
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /malformed JSON/);
});

/**
 * @param {string} text
 */
function topBlocks(text) {
  /** @type {{ header: string, lines: string[] }[]} */
  const blocks = [];
  let current = null;
  for (const line of text.split("\n")) {
    if (/^\S/.test(line)) {
      current = { header: line, lines: [] };
      blocks.push(current);
      continue;
    }
    if (current) current.lines.push(line);
  }
  return blocks;
}

/**
 * @param {string[]} lines
 */
function indentKeys(lines) {
  /** @type {string[]} */
  const keys = [];
  for (const line of lines) {
    if (/^\s*#/.test(line) || line.trim() === "") continue;
    const match = line.match(/^  ([A-Za-z0-9_-]+):/);
    if (match?.[1]) keys.push(match[1]);
  }
  return keys;
}

/**
 * @param {string} text
 */
function runScripts(text) {
  const lines = text.split("\n");
  /** @type {string[]} */
  const scripts = [];
  for (let i = 0; i < lines.length; i += 1) {
    const header = lines[i]?.match(/^(\s*)run:\s*\|\s*$/);
    if (!header) continue;
    const base = header[1]?.length ?? 0;
    /** @type {string[]} */
    const body = [];
    for (i += 1; i < lines.length; i += 1) {
      const line = lines[i] ?? "";
      if (line.trim() === "") {
        body.push("");
        continue;
      }
      const indent = line.match(/^ */)?.[0].length ?? 0;
      if (indent <= base) {
        i -= 1;
        break;
      }
      body.push(line);
    }
    scripts.push(body.join("\n"));
  }
  return scripts;
}

/**
 * @param {string} script
 */
function stripBashComments(script) {
  return script
    .split("\n")
    .map((line) => line.replace(/#.*/, ""))
    .join("\n");
}

/**
 * @param {string} script
 * @param {number} doAt
 */
function blockEnd(script, doAt) {
  let depth = 1;
  const re = /\b(do|done)\b/g;
  re.lastIndex = doAt + 2;
  let match = re.exec(script);
  while (match) {
    depth += match[1] === "do" ? 1 : -1;
    if (depth === 0) return match.index;
    match = re.exec(script);
  }
  return -1;
}

/**
 * @param {string} script
 */
function cellBodies(script) {
  const clean = stripBashComments(script);
  /** @type {string[]} */
  const bodies = [];
  const runs = /\bfor r in 1 2 3;\s*do\b/g;
  let run = runs.exec(clean);
  while (run) {
    const runEnd = blockEnd(clean, run.index + run[0].lastIndexOf("do"));
    assert.ok(runEnd > run.index);
    const runBody = clean.slice(run.index, runEnd);
    const cell = /\bfor cell in\b[^\n]*\bdo\b/.exec(runBody);
    assert.ok(cell);
    const cellDo = run.index + cell.index + cell[0].lastIndexOf("do");
    const cellEnd = blockEnd(clean, cellDo);
    assert.ok(cellEnd > cellDo && cellEnd < runEnd);
    bodies.push(clean.slice(cellDo, cellEnd));
    run = runs.exec(clean);
  }
  return bodies;
}

/**
 * @param {string} text
 */
function stepsOf(text) {
  const lines = text.split("\n");
  /** @type {{ name: string, uses: string, if: string }[]} */
  const steps = [];
  /** @type {{ name: string, uses: string, if: string } | null} */
  let current = null;
  let stepIndent = -1;
  for (const line of lines) {
    if (/^\s*#/.test(line)) continue;
    const start = line.match(/^(\s*)-\s+(.*)$/);
    if (start && (start[1]?.length ?? 0) === 6) {
      current = { name: "", uses: "", if: "" };
      steps.push(current);
      stepIndent = start[1]?.length ?? 0;
      const rest = start[2] ?? "";
      const inline = rest.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (inline?.[1])
        current[inline[1] === "name" ? "name" : inline[1] === "uses" ? "uses" : "if"] =
          inline[1] === "name" || inline[1] === "uses" || inline[1] === "if"
            ? (inline[2] ?? "")
            : "";
      if (inline?.[1] === "name") current.name = inline[2] ?? "";
      if (inline?.[1] === "uses") current.uses = inline[2] ?? "";
      if (inline?.[1] === "if") current.if = inline[2] ?? "";
      continue;
    }
    if (!current) continue;
    const indent = line.match(/^ */)?.[0].length ?? 0;
    if (line.trim() !== "" && indent <= stepIndent) {
      current = null;
      continue;
    }
    const kv = line.trim().match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!kv || indent !== stepIndent + 2) continue;
    if (kv[1] === "name") current.name = kv[2] ?? "";
    if (kv[1] === "uses") current.uses = kv[2] ?? "";
    if (kv[1] === "if") current.if = kv[2] ?? "";
  }
  return steps;
}

test("the matrix workflow triggers on workflow_dispatch only", () => {
  const text = readFileSync(workflowPath, "utf8");
  const on = topBlocks(text).find((block) => block.header === "on:");
  assert.ok(on);
  assert.deepEqual(indentKeys(on.lines), ["workflow_dispatch"]);
});

test("the matrix workflow interleaves the runs and logs the swapped binary sha256", () => {
  const text = readFileSync(workflowPath, "utf8");
  const bodies = runScripts(text).flatMap((script) => cellBodies(script));
  assert.equal(bodies.length, 2);
  for (const body of bodies) {
    const shaAt = body.search(/sha256sum|shasum -a 256/);
    const benchAt = body.indexOf("vitest bench");
    assert.ok(shaAt !== -1 && benchAt !== -1 && shaAt < benchAt);
  }
});

test("the matrix workflow compares each cell glue before the bench", () => {
  const text = readFileSync(workflowPath, "utf8");
  const bodies = runScripts(text).flatMap((script) => cellBodies(script));
  assert.equal(bodies.length, 2);
  for (const body of bodies) {
    const cmpAt = body.indexOf("cmp -s");
    const glueAt = body.indexOf("gwen_core.js");
    const benchAt = body.indexOf("vitest bench");
    assert.ok(cmpAt !== -1 && glueAt !== -1 && benchAt !== -1);
    assert.ok(cmpAt < benchAt && glueAt < benchAt);
    assert.equal(body.includes("gwen_core_factory"), false);
  }
});

test("every vitest bench call uses --project prod", () => {
  const calls = runScripts(readFileSync(workflowPath, "utf8")).flatMap(
    (script) => script.match(/vitest bench[^\n]*/g) ?? [],
  );
  assert.ok(calls.length >= 2);
  for (const call of calls) assert.match(call, /--project prod/);
});

test("the table and the upload still run when a bench fails", () => {
  const steps = stepsOf(readFileSync(workflowPath, "utf8"));
  const table = steps.find((step) => step.name === "Write the profile table");
  const upload = steps.find((step) => step.uses.startsWith("actions/upload-artifact@"));
  assert.ok(table);
  assert.ok(upload);
  assert.equal(table.if, "always()");
  assert.equal(upload.if, "always()");
});

test("the matrix job is read-only and has a timeout", () => {
  const text = readFileSync(workflowPath, "utf8");
  const permissions = topBlocks(text).find((block) => block.header === "permissions:");
  assert.ok(permissions);
  assert.deepEqual(indentKeys(permissions.lines), ["contents"]);
  assert.ok(permissions.lines.some((line) => line === "  contents: read"));
  const lines = text.split("\n");
  const jobAt = lines.indexOf("  matrix:");
  assert.ok(jobAt !== -1);
  /** @type {string[]} */
  const keys = [];
  for (const line of lines.slice(jobAt + 1)) {
    if (/^  \S/.test(line)) break;
    if (/^\s*#/.test(line)) continue;
    const match = line.match(/^    ([A-Za-z0-9_-]+):/);
    if (match?.[1]) keys.push(match[1]);
  }
  assert.ok(keys.includes("timeout-minutes"));
});

test("the matrix workflow does not run build:ts", () => {
  const code = readFileSync(workflowPath, "utf8")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
  assert.equal(code.includes("pnpm build:ts"), false);
});
