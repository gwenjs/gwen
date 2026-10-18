import { describe, expect, it } from "vitest";
import { runSnippet } from "../src/run.js";

describe("docs run blocks", () => {
  it("runs an assert against the pre-bound engine and disposes it", async () => {
    let state = "";
    await runSnippet(
      'import assert from "node:assert/strict";\nassert.equal(engine.state, "idle");',
      "docs/run.md",
      3,
      {
        onDisposed: (next) => {
          state = next;
        },
      },
    );
    expect(state).toBe("stopped");
  });

  it("fails when the block throws", async () => {
    await expect(runSnippet('throw new Error("boom");', "docs/run.md", 8)).rejects.toThrow("boom");
  });

  it("fails when an assert fails", async () => {
    await expect(
      runSnippet(
        'import assert from "node:assert/strict";\nassert.equal(1, 2);',
        "docs/run.md",
        12,
      ),
    ).rejects.toThrow("1 !== 2");
  });

  it("fails when the block stops the engine", async () => {
    await expect(runSnippet("await engine.stop();", "docs/run.md", 20)).rejects.toThrow(
      "docs/run.md:20 the block stopped the engine",
    );
  });

  it("disposes a started engine after the block returns", async () => {
    let state = "";
    await runSnippet("await engine.start();", "docs/run.md", 30, {
      onDisposed: (next) => {
        state = next;
      },
    });
    expect(state).toBe("stopped");
  });
});
