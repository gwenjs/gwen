import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const HELPER = "packages/docs-check/src/deprecated-walker.ts";
const IMPORT_FROM_HELPER = /from "[./]+(?:docs-check\/)?src\/deprecated-walker(?:\.js)?"/;

function read(file: string): string {
  return readFileSync(path.join(repoRoot, file), "utf8");
}

function expectSharedNotCopied(file: string): void {
  expect(existsSync(path.join(repoRoot, HELPER))).toBe(true);
  const text = read(file);
  expect(text).toMatch(IMPORT_FROM_HELPER);
  expect(text).not.toContain("function walkExports(");
  expect(text).not.toContain("function hasDeprecatedTag(");
  expect(text).not.toContain("ts.createSourceFile(");
}

describe("the deprecated-export walker is shared, not copied", () => {
  it("docs-deprecated.test.ts imports the walker and does not define it", () => {
    expectSharedNotCopied("packages/docs-check/tests/docs-deprecated.test.ts");
  });

  it("readme-public-exports.test.ts imports the walker and does not define it", () => {
    expectSharedNotCopied("packages/core/tests/readme-public-exports.test.ts");
  });

  it("the helper module defines the walker once", () => {
    expect(existsSync(path.join(repoRoot, HELPER))).toBe(true);
    const text = read(HELPER);
    expect(text).toContain("export function deprecatedPublicExports(");
    expect(text).toContain("export function deprecatedPublicMembers(");
  });
});
