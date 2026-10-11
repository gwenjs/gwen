#!/usr/bin/env node
/**
 * ABAB sample of measureEngineFrame() on HEAD and one baseline commit.
 *
 * From the repo root:
 *   node scripts/engine-frame-ratio.mjs 1b9fcf9e
 *   node scripts/engine-frame-ratio.mjs 1b9fcf9e --rounds 5
 *
 * Odd rounds run the baseline, then HEAD. Even rounds run HEAD, then the
 * baseline. Rounds must be at least 5. The baseline checkout runs this
 * HEAD's packages/core/bench/engine-frame.bench.ts. The stdout line
 * ENGINE_FRAME_MS is measureEngineFrame(), not the Vitest hz column.
 * Gate: HEAD median <= 1.05 times the baseline median. This script does
 * not edit a threshold file.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const GATE = 1.05;
const BENCH = "packages/core/bench/engine-frame.bench.ts";

function fail(message) {
  throw new Error(message);
}

function git(args, cwd) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    fail((result.stderr || result.stdout || "git failed").trim());
  }
  return (result.stdout || "").trim();
}

function parseArgs(argv) {
  const positional = [];
  let rounds = 5;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--rounds") {
      rounds = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    positional.push(arg);
  }
  if (positional.length !== 1 || !Number.isInteger(rounds) || rounds < 5) {
    fail("usage: node scripts/engine-frame-ratio.mjs <baseline-commit> [--rounds 5]");
  }
  return { baseline: positional[0], rounds };
}

function linkNodeModules(fromRoot, toRoot) {
  const packageDirs = [fromRoot];
  const packages = path.join(fromRoot, "packages");
  if (existsSync(packages)) {
    for (const name of readdirSync(packages)) {
      packageDirs.push(path.join(packages, name));
    }
  }
  for (const dir of packageDirs) {
    const source = path.join(dir, "node_modules");
    if (!existsSync(source)) continue;
    const destinationDir = path.join(toRoot, path.relative(fromRoot, dir));
    mkdirSync(destinationDir, { recursive: true });
    const destination = path.join(destinationDir, "node_modules");
    if (existsSync(destination)) continue;
    symlinkSync(source, destination);
  }
}

function sample(repo) {
  const core = path.join(repo, "packages/core");
  const vitest = path.join(core, "node_modules", ".bin", "vitest");
  const result = spawnSync(
    vitest,
    ["bench", "--run", "--project", "prod", "bench/engine-frame.bench.ts"],
    { cwd: core, encoding: "utf8", timeout: 180000 },
  );
  const text = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const matches = [...text.matchAll(/ENGINE_FRAME_MS\s+([0-9]+(?:\.[0-9]+)?)/g)];
  if (result.status !== 0 || matches.length !== 1) {
    fail(
      `bench failed in ${repo} status ${result.status} matches ${matches.length}\n${text.slice(-4000)}`,
    );
  }
  return Number(matches[0][1]);
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[(sorted.length - 1) >> 1];
}

let repoRoot = process.cwd();
try {
  const { baseline, rounds } = parseArgs(process.argv.slice(2));
  repoRoot = git(["rev-parse", "--show-toplevel"], process.cwd());
  const head = git(["rev-parse", "HEAD"], repoRoot);
  const baselineSha = git(["rev-parse", baseline], repoRoot);
  const worktree = path.join(os.tmpdir(), `gwen-frame-ratio-${baselineSha.slice(0, 12)}`);
  spawnSync("git", ["worktree", "remove", "--force", worktree], { cwd: repoRoot });
  rmSync(worktree, { recursive: true, force: true });
  git(["worktree", "add", "--detach", worktree, baselineSha], repoRoot);
  runRatio({ repoRoot, head, baselineSha, worktree, rounds });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function runRatio({ repoRoot, head, baselineSha, worktree, rounds }) {
  try {
    linkNodeModules(repoRoot, worktree);
    cpSync(path.join(repoRoot, BENCH), path.join(worktree, BENCH));
    const samples = { head: [], baseline: [] };
    for (let round = 1; round <= rounds; round += 1) {
      const order = round % 2 === 1 ? ["baseline", "head"] : ["head", "baseline"];
      for (const side of order) {
        const repo = side === "head" ? repoRoot : worktree;
        const value = sample(repo);
        samples[side].push(value);
        process.stdout.write(`round ${round} ${side} ENGINE_FRAME_MS ${value}\n`);
      }
    }
    const headMedian = median(samples.head);
    const baselineMedian = median(samples.baseline);
    const ratio = headMedian / baselineMedian;
    const cpu = os.cpus()[0]?.model ?? "unknown";
    process.stdout.write(`cpu ${cpu}\n`);
    process.stdout.write(`node ${process.version}\n`);
    process.stdout.write(`head ${head}\n`);
    process.stdout.write(`baseline ${baselineSha}\n`);
    process.stdout.write(`rounds ${rounds}\n`);
    process.stdout.write(`head samples ${samples.head.join(", ")}\n`);
    process.stdout.write(`baseline samples ${samples.baseline.join(", ")}\n`);
    process.stdout.write(`head median ${headMedian}\n`);
    process.stdout.write(`baseline median ${baselineMedian}\n`);
    process.stdout.write(`ratio ${ratio}\n`);
    process.stdout.write(`gate ${GATE}\n`);
    if (!(ratio <= GATE)) fail(`ratio ${ratio} is above ${GATE}`);
  } finally {
    git(["worktree", "remove", "--force", worktree], repoRoot);
    rmSync(worktree, { recursive: true, force: true });
  }
}
