import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  deprecatedPublicExports,
  isRecord,
  packageDirs,
  readJsonFile,
  readPackageName,
} from "../../docs-check/src/deprecated-walker.js";

interface SnapEntry {
  readonly values: readonly string[];
  readonly types: readonly string[];
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function isStringList(value: unknown): value is readonly string[] {
  if (!isUnknownArray(value)) return false;
  for (const item of value) {
    if (typeof item !== "string") return false;
  }
  return true;
}

function isSnapEntry(value: unknown): value is SnapEntry {
  if (!isRecord(value)) return false;
  return isStringList(value["values"]) && isStringList(value["types"]);
}

function isSnapFile(value: unknown): value is Record<string, SnapEntry> {
  if (!isRecord(value)) return false;
  for (const entry of Object.values(value)) {
    if (!isSnapEntry(entry)) return false;
  }
  return true;
}

function readSnap(pkgDir: string): Record<string, SnapEntry> {
  const snapPath = path.join(pkgDir, "public-api.snap.json");
  const value = readJsonFile(snapPath);
  if (!isSnapFile(value)) throw new Error(`Unreadable snapshot: ${snapPath}`);
  return value;
}

function readReadme(pkgDir: string): string | null {
  try {
    return readFileSync(path.join(pkgDir, "README.md"), "utf8");
  } catch {
    return null;
  }
}

/** A snapshot name counts only as its own code span, `` `Name` ``. */
function hasCodeSpan(text: string, name: string): boolean {
  return text.includes("`" + name + "`");
}

/** Missing snapshot names, one line per package. A missing README misses every name. */
function missingReadmeLines(): string[] {
  const lines: string[] = [];
  for (const pkgDir of packageDirs()) {
    const packageName = readPackageName(pkgDir);
    const readme = readReadme(pkgDir);
    const missing: string[] = [];
    const seen = new Set<string>();
    for (const entry of Object.values(readSnap(pkgDir))) {
      for (const name of [...entry.values, ...entry.types]) {
        if (seen.has(name)) continue;
        seen.add(name);
        if (readme !== null && hasCodeSpan(readme, name)) continue;
        missing.push(name);
      }
    }
    if (missing.length > 0) lines.push(`${packageName}: ${missing.join(", ")}`);
  }
  return lines;
}

describe("package README public exports", () => {
  it("lists every snapshot export in the package README", () => {
    expect(missingReadmeLines()).toEqual([]);
  });

  it("the only deprecated public export is useComponentFor", () => {
    expect(deprecatedPublicExports()).toEqual(["@gwenjs/core ./system useComponentFor"]);
  });
});
