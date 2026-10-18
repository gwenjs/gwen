import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extractFences, type Fence } from "../src/fences.js";
import { runSnippet } from "../src/run.js";
import { checkFence, checkFences } from "../src/snippets.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const ENGINE_PAGES = [
  "docs/essentials/engine.md",
  "docs/essentials/hooks.md",
  "docs/essentials/scenes.md",
  "docs/essentials/scene-router.md",
  "docs/advanced/hooks.md",
  "docs/advanced/error-bus.md",
  "docs/advanced/debug-mode.md",
  "docs/advanced/async-context.md",
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

describe("engine page run fences", () => {
  it("tagged engine fences type-check", () => {
    const tagged = ENGINE_PAGES.flatMap((file) =>
      pageFences(file).filter((fence) => fence.tag === "check" || fence.tag === "run"),
    );
    expect(tagged.length).toBeGreaterThan(0);
    expect(checkFences(tagged)).toEqual([]);
  });

  it("a fresh engine reports frameCount 0 and one advance reports deltaTime 1/60", async () => {
    const file = "docs/essentials/engine.md";
    await runMarked(file, "assert.equal(stepped, 1 / 60)");
    expect(asserted(file, "before")).toBe("0");
    expect(asserted(file, "stepped")).toBe("1 / 60");
    expect(asserted(file, "after")).toBe("1");
  });

  it("timeScale 0 keeps deltaTime at 0 and state idle", async () => {
    const file = "docs/essentials/engine.md";
    await runMarked(file, "assert.equal(frozen, 0)");
    expect(asserted(file, "frozen")).toBe("0");
    expect(asserted(file, "engine.state")).toBe('"idle"');
  });

  it("destroyEntity emits entity:destroy with that id", async () => {
    const file = "docs/essentials/hooks.md";
    await runMarked(file, "assert.equal(seen, id)");
    expect(asserted(file, "seen")).toBe("id");
  });

  it("one advance runs tick, before-update, update, after-update, render, afterTick", async () => {
    const file = "docs/advanced/hooks.md";
    const marker =
      'assert.equal(order.join(","), "tick,before-update,update,after-update,render,afterTick")';
    await runMarked(file, marker);
    expect(asserted(file, 'order.join(",")')).toBe(
      '"tick,before-update,update,after-update,render,afterTick"',
    );
  });

  it("getStats omits phaseMs when debug is off", async () => {
    const file = "docs/advanced/debug-mode.md";
    await runMarked(file, "assert.equal(hasPhases, false)");
    expect(asserted(file, "hasPhases")).toBe("false");
  });

  it("reenable of an unknown id is false and the state stays idle", async () => {
    const file = "docs/advanced/error-bus.md";
    await runMarked(file, 'assert.equal(engine.reenable("missing"), false)');
    expect(asserted(file, 'engine.reenable("missing")')).toBe("false");
    expect(asserted(file, "engine.state")).toBe('"idle"');
  });
});
