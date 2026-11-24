import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const runtimeEntry = path.join(packageRoot, "src/runtime.ts");
const srcDir = path.join(packageRoot, "src");

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

/** `src/runtime.ts` plus every relative import it reaches under `src`, and their specifiers. */
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
    if (isUnder(file, srcDir)) files.push(file);
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(SPECIFIER)) {
      const specifier = match[1];
      if (specifier === undefined) continue;
      specifiers.push(specifier);
      const resolved = resolveSpecifier(file, specifier);
      if (resolved !== undefined && isUnder(resolved, srcDir)) queue.push(resolved);
    }
  }
  return { files, specifiers };
}

/** Specifiers of `entry` and of the relative chunks it imports. */
function scanBuilt(entry: string): string[] {
  const specifiers: string[] = [];
  const visited = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop();
    if (file === undefined || visited.has(file)) continue;
    visited.add(file);
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(SPECIFIER)) {
      const specifier = match[1];
      if (specifier === undefined) continue;
      specifiers.push(specifier);
      if (!specifier.startsWith(".")) continue;
      const resolved = path.resolve(path.dirname(file), specifier);
      if (existsSync(resolved)) queue.push(resolved);
    }
  }
  return specifiers;
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
    expect(scanned.files.some((file) => file.endsWith(`${path.sep}composable-surface.ts`))).toBe(
      true,
    );
  });

  it("the built runtime entry imports no vitest", () => {
    const built = path.join(packageRoot, "dist/runtime.js");
    expect(existsSync(built), "dist/runtime.js is absent").toBe(true);
    const vitest = scanBuilt(built).filter(
      (specifier) => specifier === "vitest" || specifier.startsWith("vitest/"),
    );
    expect(vitest).toEqual([]);
  });
});
