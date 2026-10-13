import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Code lines of `export class GwenEngineImpl`.
 * A line counts when it has code. Blank lines and comment-only lines do not.
 * 299 passes. 300 fails.
 */
export function codeLinesOfClass(source: string, className: string): number {
  const marker = `export class ${className}`;
  const start = source.indexOf(marker);
  if (start < 0) {
    throw new Error(`export class ${className} not found`);
  }

  let index = start;
  let depth = 0;
  let opened = false;
  let lineHasCode = false;
  let count = 0;
  let mode: "code" | "line" | "block" | "single" | "double" | "template" = "code";

  const finishLine = (): void => {
    if (lineHasCode) count += 1;
    lineHasCode = false;
  };

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];

    if (mode === "line") {
      if (char === "\n") {
        mode = "code";
        finishLine();
      }
      index += 1;
      continue;
    }

    if (mode === "block") {
      if (char === "*" && next === "/") {
        mode = "code";
        index += 2;
        continue;
      }
      if (char === "\n") finishLine();
      index += 1;
      continue;
    }

    if (mode === "single" || mode === "double" || mode === "template") {
      lineHasCode = true;
      if (char === "\\") {
        index += 2;
        continue;
      }
      const closed =
        (mode === "single" && char === "'") ||
        (mode === "double" && char === '"') ||
        (mode === "template" && char === "`");
      if (closed) mode = "code";
      if (char === "\n") finishLine();
      index += 1;
      continue;
    }

    if (char === "/" && next === "/") {
      mode = "line";
      index += 2;
      continue;
    }
    if (char === "/" && next === "*") {
      mode = "block";
      index += 2;
      continue;
    }
    if (char === "'") {
      mode = "single";
      lineHasCode = true;
      index += 1;
      continue;
    }
    if (char === '"') {
      mode = "double";
      lineHasCode = true;
      index += 1;
      continue;
    }
    if (char === "`") {
      mode = "template";
      lineHasCode = true;
      index += 1;
      continue;
    }
    if (char === "{") {
      depth += 1;
      opened = true;
      lineHasCode = true;
      index += 1;
      continue;
    }
    if (char === "}") {
      lineHasCode = true;
      depth -= 1;
      index += 1;
      if (opened && depth === 0) {
        count += 1;
        return count;
      }
      continue;
    }
    if (char === "\n") {
      finishLine();
      index += 1;
      continue;
    }
    if (char !== " " && char !== "\t" && char !== "\r") lineHasCode = true;
    index += 1;
  }

  throw new Error(`export class ${className} did not close`);
}

const sourcePath = join(dirname(fileURLToPath(import.meta.url)), "../../src/engine/gwen-engine.ts");

describe("GwenEngineImpl", () => {
  it("is under 300 code lines", () => {
    const source = readFileSync(sourcePath, "utf8");
    const lines = codeLinesOfClass(source, "GwenEngineImpl");
    expect(lines).toBeLessThan(300);
  });
});
