import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findInertPhrases } from "../src/inert.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");

describe("inert options", () => {
  it("reports a banned phrase in a source file", () => {
    const hits = findInertPhrases(path.join(here, "fixtures/inert-src"));
    expect(hits.some((hit) => hit.includes("not yet implemented"))).toBe(true);
  });

  it("finds no banned phrase under packages src", () => {
    const hits: string[] = [];
    for (const name of readdirSync(path.join(repoRoot, "packages"))) {
      const src = path.join(repoRoot, "packages", name, "src");
      try {
        if (!statSync(src).isDirectory()) continue;
      } catch {
        continue;
      }
      hits.push(...findInertPhrases(src));
    }
    expect(hits).toEqual([]);
  });
});
