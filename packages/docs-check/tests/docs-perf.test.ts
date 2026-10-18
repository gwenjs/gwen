import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extractFences, type Fence } from "../src/fences.js";
import { runSnippet } from "../src/run.js";
import { checkFence } from "../src/snippets.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function pageText(file: string): string {
  return readFileSync(path.join(repoRoot, file), "utf8");
}

function markedRun(file: string, marker: string): Fence | undefined {
  return extractFences(pageText(file), file).find(
    (fence) => fence.tag === "run" && fence.code.includes(marker),
  );
}

/** Right-hand side of `assert.equal(left, value)` inside a run fence. */
function asserted(file: string, left: string): string | undefined {
  const needle = `assert.equal(${left}, `;
  const fence = markedRun(file, needle);
  if (!fence) return undefined;
  const rest = fence.code.slice(fence.code.indexOf(needle) + needle.length);
  const end = rest.indexOf(")");
  if (end < 0) return undefined;
  return rest.slice(0, end).trim();
}

async function runMarked(file: string, marker: string): Promise<void> {
  const fence = markedRun(file, marker);
  if (!fence) return;
  expect(checkFence(fence)).toBeNull();
  await runSnippet(fence.code, fence.file, fence.line);
}

const PERF_PAGES = ["docs/advanced/performance.md", "docs/fr/advanced/performance.md"];
const POOL_PAGES = ["docs/advanced/actor-pool.md", "docs/fr/advanced/actor-pool.md"];
const TWEEN_PAGES = ["docs/advanced/tween.md", "docs/fr/advanced/tween.md"];

describe("performance pages", () => {
  it("a chunk loop on the performance page writes 11", async () => {
    const file = "docs/advanced/performance.md";
    const marker = "assert.equal(readBack, 11)";
    await runMarked(file, marker);
    expect(asserted(file, "readBack")).toBe("11");
    for (const page of PERF_PAGES) {
      const text = pageText(page);
      expect(text, page).not.toContain("zero overhead");
      expect(text, page).not.toContain("zéro overhead");
      expect(text, page).not.toContain("100+");
      expect(text, page).not.toContain("buffer reallocation");
      expect(text, page).not.toContain("réallocation de buffer");
      expect(text, page).not.toContain("useComponent(entity.id");
      expect(text, page).not.toContain("useComponent(self.id");
      expect(text, page).not.toContain("vite.config.ts");
      expect(text, page).not.toContain("allocation-free");
      expect(text, page).not.toContain("sans allocation");
      expect(text, page).not.toContain("2 WASM");
    }
  });

  it("actor pool pages drop the indexed component writes and the no-allocation bullets", () => {
    for (const page of POOL_PAGES) {
      const text = pageText(page);
      expect(text, page).not.toContain("Position.x[id]");
      expect(text, page).not.toContain("Position.y[id]");
      expect(text, page).not.toContain("Velocity.vx[id]");
      expect(text, page).not.toContain("nothing is allocated");
      expect(text, page).not.toContain("rien n'est alloué");
      expect(text, page).not.toContain("near-zero cost");
      expect(text, page).not.toContain("quasi-gratuits");
    }
  });

  it("tween pages drop the no-allocation and unbenched speed claims", () => {
    for (const page of TWEEN_PAGES) {
      const text = pageText(page);
      expect(text, page).not.toContain("no allocations happen during gameplay");
      expect(text, page).not.toContain("aucune allocation ne se produit");
      expect(text, page).not.toContain("extremely efficient");
      expect(text, page).not.toContain("extrêmement efficaces");
      expect(text, page).not.toContain("performance remains smooth");
      expect(text, page).not.toContain("performances restent fluides");
      expect(text, page).not.toContain("Scale.x[id]");
      expect(text, page).not.toContain("Scale.y[id]");
    }
  });
});
