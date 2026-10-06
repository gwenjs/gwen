import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === "node_modules" || entry === "dist" || entry === "__tests__") continue;
      found.push(...sourceFiles(full));
      continue;
    }
    if (!full.endsWith(".ts") || full.endsWith(".test.ts")) continue;
    if (!full.includes(`${path.sep}src${path.sep}`)) continue;
    found.push(full);
  }
  return found;
}

function stripCommentsKeepLines(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("package throws", () => {
  it("throws GwenError instead of Error, TypeError, or RangeError", () => {
    const packages = path.join(repoRoot, "packages");
    const hits: string[] = [];
    const pattern =
      /new (?:Error|TypeError|RangeError)\s*\(|throw (?:Error|TypeError|RangeError)\s*\(/g;
    const subclass = /export class (?!GwenError\b)\w+ extends Error\b/g;
    for (const file of sourceFiles(packages)) {
      const text = stripCommentsKeepLines(readFileSync(file, "utf8"));
      for (const match of text.matchAll(pattern)) {
        const index = match.index ?? 0;
        const line = text.slice(0, index).split("\n").length;
        hits.push(`${path.relative(repoRoot, file)}:${line}`);
      }
      for (const match of text.matchAll(subclass)) {
        const index = match.index ?? 0;
        const line = text.slice(0, index).split("\n").length;
        hits.push(`${path.relative(repoRoot, file)}:${line} extends Error`);
      }
    }
    expect(hits).toEqual([]);
  });
});
