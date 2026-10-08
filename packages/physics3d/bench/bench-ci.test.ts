/**
 * @module bench-ci.test
 * Checks that the physics3d timing gates are wired into the CI Benchmarks job.
 *
 * The gates in `timing-gate.test.ts` skip themselves unless `BENCH_SLOW` is set,
 * so a missing script or workflow step would leave them silently unrun.
 * This file runs in the normal unit suite (no BENCH_SLOW required).
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const benchDir = path.resolve(fileURLToPath(new URL(".", import.meta.url)));
const repoRoot = path.resolve(benchDir, "..", "..", "..");

/** Reads `scripts[name]` from a package.json, or `undefined`. */
function readScript(packageJsonPath: string, name: string): string | undefined {
  const pkg: unknown = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  if (typeof pkg !== "object" || pkg === null || !("scripts" in pkg)) return undefined;
  const scripts = pkg.scripts;
  if (typeof scripts !== "object" || scripts === null || !(name in scripts)) return undefined;
  const value: unknown = Object.entries(scripts).find(([key]) => key === name)?.[1];
  return typeof value === "string" ? value : undefined;
}

/**
 * Lines of one job of a GitHub workflow: from `  <job>:` (two-space indent)
 * to the next line with the same indent.
 */
function jobLines(workflow: string, job: string): string[] {
  const lines = workflow.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `  ${job}:`);
  if (start === -1) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^ {2}\S/.test(line));
  return end === -1 ? rest : rest.slice(0, end);
}

/** The `run:` value of the step named `name` in `lines`, or `undefined`. */
function stepRun(lines: string[], name: string): string | undefined {
  const at = lines.findIndex((line) => line.trim() === `- name: ${name}`);
  if (at === -1) return undefined;
  const next = lines[at + 1]?.trim() ?? "";
  return next.startsWith("run: ") ? next.slice("run: ".length).trim() : undefined;
}

describe("physics3d bench wiring", () => {
  it("bench:ci runs bench/timing-gate.test.ts with BENCH_SLOW set", () => {
    const script = readScript(path.join(benchDir, "..", "package.json"), "bench:ci");
    expect(script).toBeDefined();
    expect(script).toMatch(/^BENCH_SLOW=1 vitest run .*bench\/timing-gate\.test\.ts/);
  });

  it("the root bench:physics3d:ci and bench:ci scripts run the physics3d bench:ci", () => {
    const rootPackage = path.join(repoRoot, "package.json");
    expect(readScript(rootPackage, "bench:physics3d:ci")).toBe(
      "pnpm --filter @gwenjs/physics3d bench:ci",
    );
    expect(readScript(rootPackage, "bench:ci")).toContain(
      "pnpm --filter @gwenjs/physics3d bench:ci",
    );
  });

  it("the CI Benchmarks job has the Physics3D timing gates step", () => {
    const workflow = fs.readFileSync(path.join(repoRoot, ".github", "workflows", "ci.yml"), "utf8");
    const bench = jobLines(workflow, "bench");
    expect(bench.length).toBeGreaterThan(0);
    expect(stepRun(bench, "Physics3D timing gates")).toBe("pnpm bench:physics3d:ci");
  });
});
