import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const tscBin = path.join(path.dirname(require.resolve("typescript/package.json")), "bin", "tsc");
const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = path.join(here, "fixtures", "augment-project");
const fixturesDir = path.join(here, "fixtures");

interface HooksSource {
  exportNames: string[];
  importPath: string;
}

function isHooksGenerator(value: unknown): value is (sources: HooksSource[]) => string {
  return typeof value === "function";
}

/**
 * Dev and prod vitest projects run this file at the same time. Each run copies
 * the fixture to its own sibling so one `finally` cannot delete the other's `.gwen`.
 */
function copyFixtureRun(): string {
  const runDir = path.join(fixturesDir, `run-${randomUUID()}`);
  cpSync(fixtureRoot, runDir, {
    recursive: true,
    filter: (source) => path.basename(source) !== ".gwen",
  });
  return runDir;
}

/**
 * `@gwenjs/vite` does not export `generateHooksDts` (packages/vite/src/index.ts).
 * The vite tests import `packages/vite/src/plugins/hooks.ts` by relative path.
 */
async function writeHooksDts(runDir: string): Promise<void> {
  const href = new URL("../../vite/src/plugins/hooks.ts", import.meta.url).href;
  const loaded: unknown = await import(href);
  if (typeof loaded !== "object" || loaded === null || !("generateHooksDts" in loaded)) {
    throw new Error("packages/vite/src/plugins/hooks.ts does not export generateHooksDts");
  }
  const generate = loaded.generateHooksDts;
  if (!isHooksGenerator(generate)) {
    throw new Error("generateHooksDts is not a function");
  }
  const gwenDir = path.join(runDir, ".gwen");
  mkdirSync(gwenDir, { recursive: true });
  writeFileSync(
    path.join(gwenDir, "hooks.d.ts"),
    generate([{ exportNames: ["fixtureHooks"], importPath: "../src/hooks" }]),
  );
}

function isExecFailure(
  value: unknown,
): value is { status: number; stdout: string; stderr: string } {
  if (typeof value !== "object" || value === null || !("status" in value)) return false;
  return typeof value.status === "number";
}

function runTsc(projectDir: string): { status: number; stdout: string } {
  const project = path.join(projectDir, "tsconfig.json");
  try {
    const stdout = execFileSync(process.execPath, [tscBin, "-p", project, "--pretty", "false"], {
      encoding: "utf8",
    });
    return { status: 0, stdout };
  } catch (error) {
    if (!isExecFailure(error)) throw error;
    const stdout = typeof error.stdout === "string" ? error.stdout : "";
    return { status: error.status, stdout };
  }
}

describe("schema augmentation fixture", () => {
  it("a project that augments @gwenjs/schema type-checks against core, app and vite", async () => {
    const runDir = copyFixtureRun();
    try {
      await writeHooksDts(runDir);
      const result = runTsc(runDir);
      expect(result.status).toBe(0);
      expect(result.stdout).toBe("");
    } finally {
      rmSync(runDir, { recursive: true, force: true });
    }
  }, 120_000);

  it("a wrong service type in the fixture is a type error", async () => {
    const runDir = copyFixtureRun();
    try {
      await writeHooksDts(runDir);
      const result = runTsc(path.join(runDir, "bad"));
      expect(result.status).not.toBe(0);
      expect(result.stdout).toContain("wrong.ts");
      expect(result.stdout).toContain("TS2322");
    } finally {
      rmSync(runDir, { recursive: true, force: true });
    }
  }, 120_000);
});
