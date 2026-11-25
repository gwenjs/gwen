/**
 * @file The browser entry must not reach the framework provider table (FP-1, #280).
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../src");

/** Absolute path of a relative specifier, or undefined for a package import. */
function localFile(from: string, specifier: string): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const base = resolve(dirname(from), specifier.replace(/\.(js|ts)$/, ""));
  return [`${base}.ts`, resolve(base, "index.ts")].find((file) => existsSync(file));
}

/**
 * Every file `entry` reaches through relative `import` and `export ... from` specifiers.
 * `import type` and `export type ... from` are skipped: a build erases those edges.
 */
function reachable(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];
  for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
    if (seen.has(file)) continue;
    seen.add(file);
    const text = readFileSync(file, "utf8");
    const statements = [
      ...text.matchAll(/^(?:import|export)\s+(?!type\b)[^;"']*?\bfrom\s*["']([^"']+)["']/gm),
      ...text.matchAll(/^import\s*["']([^"']+)["']/gm),
    ];
    for (const match of statements) {
      const next = localFile(file, match[1] ?? "");
      if (next !== undefined) queue.push(next);
    }
  }
  return seen;
}

describe("@gwenjs/app browser entry", () => {
  it("src/index.ts does not reach framework-providers.ts", () => {
    const table = resolve(SRC, "framework-providers.ts");
    expect(existsSync(table)).toBe(true);
    expect(reachable(resolve(SRC, "index.ts")).has(table)).toBe(false);
  });

  it("src/resolve.ts reaches framework-providers.ts through GwenApp", () => {
    expect(reachable(resolve(SRC, "resolve.ts")).has(resolve(SRC, "framework-providers.ts"))).toBe(
      true,
    );
  });
});
