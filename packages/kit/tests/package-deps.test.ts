/**
 * @file `@gwenjs/kit` depends on `@gwenjs/schema` only (P-76-5).
 */

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const tscBin = path.join(path.dirname(require.resolve("typescript/package.json")), "bin", "tsc");
const kitRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

interface ManifestDeps {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

function isRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  for (const entry of Object.values(value)) {
    if (typeof entry !== "string") return false;
  }
  return true;
}

function gwenKeys(field: unknown): string[] {
  if (!isRecord(field)) return [];
  return Object.keys(field).filter((key) => key.startsWith("@gwenjs/"));
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/.*$/gm, "$1");
}

function listTypeScriptFiles(dir: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const full = path.join(dir, name);
    const info = statSync(full);
    if (info.isDirectory()) found.push(...listTypeScriptFiles(full));
    else if (name.endsWith(".ts") || name.endsWith(".tsx")) found.push(full);
  }
  return found;
}

/** Import and re-export statements that name `@gwenjs/core`. Comments are already gone. */
function coreImportStatements(source: string): string[] {
  const clean = stripComments(source);
  const hits: string[] = [];
  const pattern = /(?:import|export)\s[\s\S]*?\sfrom\s*(["'])@gwenjs\/core(?:\/[^"']*)?\1/g;
  for (const match of clean.matchAll(pattern)) hits.push(match[0].replace(/\s+/g, " "));
  return hits;
}

function isExecFailure(
  value: unknown,
): value is { status: number; stdout: string; stderr: string } {
  if (typeof value !== "object" || value === null || !("status" in value)) return false;
  return typeof value.status === "number";
}

describe("kit package dependencies", () => {
  it("kit package.json lists @gwenjs/schema as its only @gwenjs dependency", () => {
    const manifest = JSON.parse(
      readFileSync(path.join(kitRoot, "package.json"), "utf8"),
    ) as ManifestDeps;
    const keys = [
      ...gwenKeys(manifest.dependencies),
      ...gwenKeys(manifest.devDependencies),
      ...gwenKeys(manifest.peerDependencies),
    ];
    expect(keys).toEqual(["@gwenjs/schema"]);
  });

  it("no kit src or test file imports @gwenjs/core", () => {
    const hits: string[] = [];
    for (const dir of ["src", "tests"]) {
      for (const file of listTypeScriptFiles(path.join(kitRoot, dir))) {
        const relative = path.relative(kitRoot, file);
        for (const statement of coreImportStatements(readFileSync(file, "utf8"))) {
          hits.push(`${relative}: ${statement}`);
        }
      }
    }
    expect(hits).toEqual([]);
  });

  it("kit's isolated type graph contains no core file", () => {
    const project = path.join(kitRoot, "tsconfig.isolated.json");
    let status = 0;
    let stdout = "";
    try {
      stdout = execFileSync(
        process.execPath,
        [tscBin, "-p", project, "--noEmit", "--listFiles", "--pretty", "false"],
        { encoding: "utf8" },
      );
    } catch (error) {
      if (!isExecFailure(error)) throw error;
      status = error.status;
      stdout = typeof error.stdout === "string" ? error.stdout : "";
    }
    expect(status).toBe(0);
    const coreFiles = stdout.split("\n").filter((line) => line.includes("/packages/core/"));
    expect(coreFiles).toEqual([]);
  }, 120_000);
});
