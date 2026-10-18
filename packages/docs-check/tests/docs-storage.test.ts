import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extractFences, type Fence } from "../src/fences.js";
import { runSnippet } from "../src/run.js";
import { checkFence, checkFences } from "../src/snippets.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const STORAGE_PAGES = [
  "docs/essentials/components.md",
  "docs/essentials/systems.md",
  "docs/essentials/architecture.md",
  "docs/essentials/actors.md",
  "docs/api/schema.md",
  "CLAUDE.md",
];

function pageFences(file: string): Fence[] {
  return extractFences(readFileSync(path.join(repoRoot, file), "utf8"), file);
}

function markedRun(file: string, marker: string): Fence | undefined {
  return pageFences(file).find((fence) => fence.tag === "run" && fence.code.includes(marker));
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

describe("storage page run fences", () => {
  it("tagged storage fences type-check", () => {
    const tagged = STORAGE_PAGES.flatMap((file) =>
      pageFences(file).filter((fence) => fence.tag === "check" || fence.tag === "run"),
    );
    expect(tagged.length).toBeGreaterThan(0);
    expect(checkFences(tagged)).toEqual([]);
  }, 30_000);

  it("a later system reads 7 from a chunk write in the same frame", async () => {
    const file = "docs/essentials/systems.md";
    const marker = "assert.equal(readBack, 7)";
    await runMarked(file, marker);
    expect(asserted(file, "readBack")).toBe("7");
  }, 30_000);

  it("a destroy inside a chunk loop is alive during the loop and dead after it", async () => {
    const file = "docs/essentials/components.md";
    await runMarked(file, "assert.equal(aliveDuring, true)");
    expect(asserted(file, "aliveDuring")).toBe("true");
    expect(asserted(file, "engine.isAlive(id)")).toBe("false");
  }, 30_000);

  it("engine.memory.epoch is 0 on the light engine", async () => {
    const file = "docs/essentials/architecture.md";
    const marker = "assert.equal(engine.memory.epoch, 0)";
    await runMarked(file, marker);
    expect(asserted(file, "engine.memory.epoch")).toBe("0");
  }, 30_000);

  it("an actor useComponent reads the prefab value 40", async () => {
    const file = "docs/essentials/actors.md";
    const marker = "assert.equal(seen, 40)";
    await runMarked(file, marker);
    expect(asserted(file, "seen")).toBe("40");
  }, 30_000);

  it("a chunk column write is visible to getComponent as 7", async () => {
    const file = "CLAUDE.md";
    const marker = "assert.equal(engine.getComponent(id, Position)?.x, 7)";
    await runMarked(file, marker);
    expect(asserted(file, "engine.getComponent(id, Position)?.x")).toBe("7");
  }, 30_000);
});
