import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

type Variant = "light" | "physics2d" | "physics3d";

interface BuildOutputOptions {
  /** Directory name under `examples/`. */
  example: string;
  /** Core wasm variant the example declares. */
  variant: Variant;
  /**
   * When `false`, the report case compares the written report with `dist/`
   * and does not read `bundle-budget.json`. Default `true` keeps the budget gate.
   */
  gate?: boolean;
}

const repoRoot = path.resolve(import.meta.dirname, "../..");
const tscBin = path.join(repoRoot, "node_modules/typescript/bin/tsc");
const bvhWasm = path.join(repoRoot, "packages/physics3d/wasm/bvh/gwen_core_bg.wasm");
const budgetFile = path.join(repoRoot, "packages/vite/tests/fixtures/bundle-budget.json");
const budgetScript = path.join(repoRoot, "scripts/check-wasm-size.mjs");

/** The test fails on an assertion, never on `ENOENT`, when a file is absent. */
function readFile(file: string): Buffer {
  expect(existsSync(file), `${file} is absent`).toBe(true);
  return readFileSync(file);
}

function readText(file: string): string {
  return readFile(file).toString("utf8");
}

const sha256 = (file: string): string => createHash("sha256").update(readFile(file)).digest("hex");
const gzipBytes = (file: string): number => gzipSync(readFile(file), { level: 9 }).length;

/** Every file under `dir`, relative to it and posix-separated. */
function walk(dir: string, base: string = dir): string[] {
  expect(existsSync(dir), `${dir} is absent`).toBe(true);
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full, base));
    else files.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return [...files].sort();
}

function field(source: unknown, key: string): unknown {
  return Reflect.get(Object(source), key);
}

function numberField(source: unknown, key: string): number {
  const value = field(source, key);
  expect(typeof value, `${key} is a number`).toBe("number");
  return typeof value === "number" ? value : Number.NaN;
}

function stringField(source: unknown, key: string): string {
  const value = field(source, key);
  expect(typeof value, `${key} is a string`).toBe("string");
  return typeof value === "string" ? value : "";
}

function stringListField(source: unknown, key: string): string[] {
  const value = field(source, key);
  expect(Array.isArray(value), `${key} is an array`).toBe(true);
  return Array.isArray(value) ? value.map(String) : [];
}

/** `allowedBudget` of `scripts/check-wasm-size.mjs`: the tolerance of the wasm-size gate. */
async function loadAllowedBudget(): Promise<(baseline: number) => number> {
  const loaded: unknown = await import(pathToFileURL(budgetScript).href);
  const allowedBudget = field(loaded, "allowedBudget");
  expect(typeof allowedBudget, "allowedBudget is exported").toBe("function");
  return (baseline) => {
    const allowed: unknown = typeof allowedBudget === "function" ? allowedBudget(baseline) : null;
    expect(typeof allowed, "allowedBudget returns a number").toBe("number");
    return typeof allowed === "number" ? allowed : Number.NaN;
  };
}

/** `tsc` of the repo root, run on `examples/<example>`. */
function runTsc(example: string, flag: string): { status: number | null; stdout: string } {
  expect(existsSync(tscBin), `${tscBin} is absent`).toBe(true);
  const run = spawnSync(
    process.execPath,
    [tscBin, flag, "-p", path.join(repoRoot, "examples", example)],
    { encoding: "utf8" },
  );
  return { status: run.status, stdout: run.stdout };
}

/**
 * Proves the build output of one example: one core wasm of its variant, a usable
 * `index.html`, a clean build log, a size report, strict `tsc` and `@gwenjs/*`
 * resolved through `dist`. The report case also checks `bundle-budget.json` unless
 * `gate` is `false`.
 */
export function describeBuildOutput({ example, variant, gate = true }: BuildOutputOptions): void {
  const exampleDir = path.join(repoRoot, "examples", example);
  const dist = path.join(exampleDir, "dist");
  const coreWasm = path.join(repoRoot, "packages/core/wasm", variant, "gwen_core_bg.wasm");

  describe("build-output", () => {
    it("dist holds one core wasm of the declared variant", () => {
      const bvhSha = sha256(bvhWasm);
      const wasm = walk(dist).filter((file) => file.endsWith(".wasm"));
      const core = wasm.filter((file) => sha256(path.join(dist, file)) !== bvhSha);
      const bvh = wasm.filter((file) => sha256(path.join(dist, file)) === bvhSha);
      expect(core.map((file) => sha256(path.join(dist, file)))).toEqual([sha256(coreWasm)]);
      expect(bvh).toHaveLength(variant === "physics3d" ? 1 : 0);
    });

    it("dist index.html loads the entry chunk and no unresolved /@gwenjs/ specifier", () => {
      const html = readText(path.join(dist, "index.html"));
      expect(html).toMatch(/<script type="module" crossorigin src="\/assets\/index-[\w-]+\.js">/);
      expect(html).not.toContain("/@gwenjs/");
    });

    it("the build log has no gwen-vite line and no VITE: or CORE: code", () => {
      const log = readText(path.join(dist, "build.log"));
      expect(log.trim(), "build.log is empty: the build output was not captured").not.toBe("");
      expect(log).not.toMatch(/\[gwen-vite\]|\b(?:VITE|CORE):[A-Z_]+/);
    });

    it(
      gate
        ? "the report lists the dist wasm files and gzip sizes within bundle-budget.json"
        : "the report lists the dist wasm files and gzip sizes",
      async () => {
        const report: unknown = JSON.parse(readText(path.join(dist, "gwen-example-report.json")));
        const files = walk(dist);
        const wasmFiles = files.filter((file) => file.endsWith(".wasm"));
        const jsFiles = files.filter((file) => file.endsWith(".js"));
        const gzipSum = (list: string[]): number =>
          list.reduce((sum, file) => sum + gzipBytes(path.join(dist, file)), 0);

        expect(stringField(report, "variant")).toBe(variant);
        expect([...stringListField(report, "wasmFiles")].sort()).toEqual(wasmFiles);
        const jsGzip = numberField(report, "jsGzipBytes");
        const wasmGzip = numberField(report, "wasmGzipBytes");
        expect(jsGzip).toBe(gzipSum(jsFiles));
        expect(wasmGzip).toBe(gzipSum(wasmFiles));
        if (!gate) return;

        const budget: unknown = field(JSON.parse(readText(budgetFile)), variant);
        const allowedBudget = await loadAllowedBudget();
        expect(jsGzip).toBeLessThanOrEqual(allowedBudget(numberField(budget, "jsGzipBytes")));
        expect(wasmGzip).toBeLessThanOrEqual(allowedBudget(numberField(budget, "wasmGzipBytes")));
      },
    );

    it("strict tsc passes", () => {
      expect(runTsc(example, "--noEmit")).toEqual({ status: 0, stdout: "" });
    });

    it("tsc resolves @gwenjs packages through dist, never through src", () => {
      const run = runTsc(example, "--listFilesOnly");
      expect(run.status).toBe(0);
      const files = run.stdout.split("\n").filter((line) => line.length > 0);
      expect(files.filter((file) => /\/packages\/[^/]+\/src\//.test(file))).toEqual([]);
      expect(files.some((file) => /\/packages\/[^/]+\/dist\//.test(file))).toBe(true);
    });
  });
}
