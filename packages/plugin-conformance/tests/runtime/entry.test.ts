import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const runtimeEntry = path.join(packageRoot, "src/runtime.ts");
const runtimeDir = path.join(packageRoot, "src/runtime");

const SPECIFIER = /(?:from|import)\s*(?:\(\s*)?["']([^"']+)["']/g;

function isUnder(file: string, dir: string): boolean {
  const relative = path.relative(dir, file);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function resolveSpecifier(fromFile: string, specifier: string): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const raw = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [raw, raw.replace(/\.js$/, ".ts"), `${raw}.ts`, path.join(raw, "index.ts")];
  return candidates.find((candidate) => existsSync(candidate));
}

/** `src/runtime.ts` plus every file it reaches under `src/runtime/`, and their specifiers. */
function scanRuntimeEntry(): {
  readonly files: readonly string[];
  readonly specifiers: readonly string[];
} {
  const specifiers: string[] = [];
  const files: string[] = [];
  const visited = new Set<string>();
  const queue = [runtimeEntry];
  while (queue.length > 0) {
    const file = queue.pop();
    if (file === undefined || visited.has(file)) continue;
    visited.add(file);
    if (isUnder(file, runtimeDir)) files.push(file);
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(SPECIFIER)) {
      const specifier = match[1];
      if (specifier === undefined) continue;
      specifiers.push(specifier);
      const resolved = resolveSpecifier(file, specifier);
      if (resolved !== undefined && isUnder(resolved, runtimeDir)) queue.push(resolved);
    }
  }
  return { files, specifiers };
}

describe("runtime entry", () => {
  it("the runtime entry imports neither vitest nor the root entry", () => {
    const scanned = scanRuntimeEntry();
    const vitest = scanned.specifiers.filter(
      (specifier) => specifier === "vitest" || specifier.startsWith("vitest/"),
    );
    const rootEntry = scanned.specifiers.filter((specifier) =>
      specifier.includes("run-composable-surface-suite"),
    );
    expect(vitest).toEqual([]);
    expect(rootEntry).toEqual([]);
    expect(scanned.files.length).toBeGreaterThanOrEqual(5);
  });
});
