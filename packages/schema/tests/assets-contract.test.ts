import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(pkgRoot, "src");
const assetsPath = path.join(srcDir, "assets.ts");

/** A line that exports a runtime value. Type-only `export type` / `export interface` do not match. */
const RUNTIME_EXPORT = /^export\s+(?:const|let|var|function|class|enum|default|\{)/m;
const TYPE_EXPORT_NAME = /^export\s+(?:type|interface)\s+([A-Za-z_][A-Za-z0-9_]*)/gm;
const QUOTED_ASSETS_CODE = /["'`]ASSETS:/;

function exportedTypeNames(text: string): string[] {
  const names: string[] = [];
  for (const match of text.matchAll(TYPE_EXPORT_NAME)) {
    const name = match[1];
    if (name !== undefined) names.push(name);
  }
  names.sort();
  return names;
}

describe("assets contract", () => {
  it("src/assets.ts exports types only", () => {
    expect(existsSync(assetsPath)).toBe(true);
    const text = readFileSync(assetsPath, "utf8");
    expect(text.match(RUNTIME_EXPORT)).toBeNull();
    expect(exportedTypeNames(text)).toEqual([
      "AssetKind",
      "AssetRef",
      "AssetValue",
      "AssetValueMap",
      "AssetsService",
    ]);
  });

  it("no ASSETS: code string value in the schema sources", () => {
    const quoted: string[] = [];
    const scanned: string[] = [];
    for (const name of readdirSync(srcDir)) {
      if (!name.endsWith(".ts")) continue;
      scanned.push(name);
      const text = readFileSync(path.join(srcDir, name), "utf8");
      if (QUOTED_ASSETS_CODE.test(text)) quoted.push(name);
    }
    expect(scanned).toContain("assets.ts");
    expect(quoted).toEqual([]);
  });
});
