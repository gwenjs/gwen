import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extractFences } from "../src/fences.js";

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/fences.md");

describe("extractFences", () => {
  it("reads tagged fences in a nested list, an indent, and beside a table", () => {
    const fences = extractFences(readFileSync(fixture, "utf8"), "fixtures/fences.md");
    expect(
      fences.map((fence) => ({ tag: fence.tag, language: fence.language, code: fence.code })),
    ).toEqual([
      { tag: "check", language: "ts", code: "const besideTable: number = 1;" },
      { tag: "check", language: "typescript", code: "const nested: number = 2;" },
      { tag: null, language: "ts", code: 'const untagged: number = "bad";' },
      {
        tag: "run",
        language: "ts",
        code: 'import assert from "node:assert/strict";\nassert.equal(engine.state, "idle");',
      },
    ]);
  });
});
