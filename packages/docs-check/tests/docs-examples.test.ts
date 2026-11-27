import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const PAGES = ["docs/guide/quick-start.md", "docs/fr/guide/quick-start.md"];
const EXPECTED = [
  "examples/hello-light/gwen.config.ts",
  "examples/hello-light/src/components/Position.ts",
  "examples/hello-light/src/systems/Movement.ts",
  "examples/hello-light/src/scenes/GameScene.ts",
  "examples/hello-light/src/router.ts",
];

describe("docs examples", () => {
  it("every quick-start code block is an include from examples/hello-light", () => {
    for (const page of PAGES) {
      const text = readFileSync(path.join(repoRoot, page), "utf8");
      const includes = [...text.matchAll(/^<<< @\/\.\.\/(\S+?)\{ts\}$/gm)].flatMap((match) => {
        const file = match[1];
        return file === undefined ? [] : [file];
      });
      expect(includes, page).toEqual(EXPECTED);
      for (const file of EXPECTED) expect(existsSync(path.join(repoRoot, file)), file).toBe(true);
      expect(text, page).not.toMatch(/^```(?:ts|typescript)\b/m);
    }
  });
});
