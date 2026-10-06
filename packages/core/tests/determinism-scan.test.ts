import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

/** `performance.now()` sites the 1.0 statement allows. Paths are repo-relative. */
const PERFORMANCE_NOW_ALLOWLIST = new Set([
  "packages/core/src/engine/gwen-engine.ts",
  "packages/core/src/logger/gwen-logger.ts",
  "packages/core/src/logger/console-logger.ts",
  "packages/kit/src/observability.ts",
]);

const FORBIDDEN: readonly { readonly name: string; readonly pattern: RegExp }[] = [
  { name: "Math.random", pattern: /\bMath\.random\s*\(/ },
  { name: "Date.now", pattern: /\bDate\.now\s*\(/ },
  { name: "crypto.getRandomValues", pattern: /\bcrypto\.getRandomValues\s*\(/ },
  { name: "performance.now", pattern: /\bperformance\.now\s*\(/ },
];

function toPosix(path: string): string {
  return path.split(sep).join("/");
}

function isRuntimeSource(fileName: string): boolean {
  if (!fileName.endsWith(".ts") && !fileName.endsWith(".tsx")) return false;
  if (fileName.endsWith(".test.ts") || fileName.endsWith(".spec.ts")) return false;
  if (fileName.endsWith(".d.ts")) return false;
  return true;
}

function codeOfLine(line: string, inBlock: { value: boolean }): string {
  let code = "";
  let index = 0;
  while (index < line.length) {
    if (inBlock.value) {
      const end = line.indexOf("*/", index);
      if (end === -1) return code;
      inBlock.value = false;
      index = end + 2;
      continue;
    }
    if (line.startsWith("//", index)) break;
    if (line.startsWith("/*", index)) {
      inBlock.value = true;
      index += 2;
      continue;
    }
    code += line[index];
    index += 1;
  }
  return code;
}

function forbiddenCallsIn(source: string, repoPath: string): string[] {
  const hits: string[] = [];
  const inBlock = { value: false };
  const lines = source.split("\n");
  for (let lineNumber = 0; lineNumber < lines.length; lineNumber += 1) {
    const code = codeOfLine(lines[lineNumber] ?? "", inBlock);
    for (const rule of FORBIDDEN) {
      if (!rule.pattern.test(code)) continue;
      if (rule.name === "performance.now" && PERFORMANCE_NOW_ALLOWLIST.has(repoPath)) continue;
      hits.push(`${repoPath}:${lineNumber + 1} ${rule.name}`);
    }
  }
  return hits;
}

function walkRuntimeSources(dir: string, hits: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === "__tests__") continue;
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      walkRuntimeSources(path, hits);
      continue;
    }
    if (!isRuntimeSource(entry)) continue;
    const repoPath = toPosix(relative(REPO_ROOT, path));
    const source = readFileSync(path, "utf8");
    hits.push(...forbiddenCallsIn(source, repoPath));
  }
}

describe("determinism call scan", () => {
  it("flags forbidden calls and keeps the performance.now allowlist", () => {
    expect(forbiddenCallsIn("const n = Math.random();", "packages/core/src/x.ts")).toEqual([
      "packages/core/src/x.ts:1 Math.random",
    ]);
    expect(forbiddenCallsIn("const n = Date.now();", "packages/core/src/x.ts")).toEqual([
      "packages/core/src/x.ts:1 Date.now",
    ]);
    expect(forbiddenCallsIn("crypto.getRandomValues(bytes);", "packages/core/src/x.ts")).toEqual([
      "packages/core/src/x.ts:1 crypto.getRandomValues",
    ]);
    expect(
      forbiddenCallsIn("const t = performance.now();", "packages/core/src/engine/gwen-engine.ts"),
    ).toEqual([]);
    expect(forbiddenCallsIn("const t = performance.now();", "packages/core/src/schema.ts")).toEqual(
      ["packages/core/src/schema.ts:1 performance.now"],
    );
    expect(forbiddenCallsIn("/* Math.random() */\nconst n = 1;", "packages/core/src/x.ts")).toEqual(
      [],
    );
  });

  it("finds no forbidden calls in runtime packages/*/src", () => {
    const packagesDir = join(REPO_ROOT, "packages");
    const hits: string[] = [];
    for (const name of readdirSync(packagesDir)) {
      const src = join(packagesDir, name, "src");
      try {
        if (!statSync(src).isDirectory()) continue;
      } catch {
        continue;
      }
      walkRuntimeSources(src, hits);
    }
    expect(hits).toEqual([]);
  });
});
