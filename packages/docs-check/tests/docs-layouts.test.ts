import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extractFences } from "../src/fences.js";
import { runSnippet } from "../src/run.js";
import { checkFences } from "../src/snippets.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const PAGES = ["docs/essentials/layouts.md", "docs/fr/essentials/layouts.md"];

function pageFences(page: string) {
  return extractFences(readFileSync(path.join(repoRoot, page), "utf8"), page);
}

describe.each(PAGES)("%s run fences", (page) => {
  it("tagged fences type-check", () => {
    const tagged = pageFences(page).filter((fence) => fence.tag === "check" || fence.tag === "run");
    expect(tagged.length).toBeGreaterThan(0);
    expect(checkFences(tagged)).toEqual([]);
  });

  it("the chunkSize fence spawns two, four, then five entities over three frames", async () => {
    const fence = pageFences(page).find(
      (candidate) => candidate.tag === "run" && candidate.code.includes("chunkSize: 2"),
    );
    expect(fence).toBeDefined();
    if (!fence) return;
    expect(fence.code).toContain("assert.equal(alive() - base, 2);");
    expect(fence.code).toContain("assert.equal(alive() - base, 4);");
    expect(fence.code).toContain("assert.equal(alive() - base, 5);");
    await runSnippet(fence.code, fence.file, fence.line);
  });
});
