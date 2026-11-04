import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extractFences } from "../src/fences.js";
import { checkFence, checkFences } from "../src/snippets.js";

const here = path.dirname(fileURLToPath(import.meta.url));

describe("docs snippets", () => {
  it("compiles a tagged fence and skips an untagged type error", () => {
    const fences = extractFences(
      readFileSync(path.join(here, "fixtures/fences.md"), "utf8"),
      "fixtures/fences.md",
    );
    expect(checkFences(fences)).toEqual([]);
  });

  it("names the file, the line, and the tsc diagnostic when a fence does not compile", () => {
    const failure = checkFence({
      file: "docs/sample.md",
      line: 10,
      language: "ts",
      tag: "check",
      code: 'const value: number = "no";',
    });
    expect(failure?.message).toContain("docs/sample.md:");
    expect(failure?.message).toContain("not assignable to type 'number'");
  });

  it("reports a missing import symbol", () => {
    const failure = checkFence({
      file: "docs/sample.md",
      line: 4,
      language: "ts",
      tag: "check",
      code: 'import { ThisSymbolDoesNotExist } from "@gwenjs/core";',
    });
    expect(failure?.message).toContain("ThisSymbolDoesNotExist");
  });
});
