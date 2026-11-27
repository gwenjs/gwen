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

const MARKERS: ReadonlyArray<{ file: string; token: string }> = [
  { file: "examples/hello-light/gwen.config.ts", token: "maxEntities" },
  { file: "examples/hello-light/src/components/Position.ts", token: "f32" },
  { file: "examples/hello-light/src/systems/Movement.ts", token: "useQuery" },
  { file: "examples/hello-light/src/scenes/GameScene.ts", token: "useSystem" },
  { file: "examples/hello-light/src/router.ts", token: "AppRouter" },
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

  it("every quick-start include renders as a code block and not as text", async () => {
    for (const marker of MARKERS) {
      const source = readFileSync(path.join(repoRoot, marker.file), "utf8");
      expect(source, marker.file).toContain(marker.token);
      for (const other of MARKERS) {
        if (other.file === marker.file) continue;
        const otherSource = readFileSync(path.join(repoRoot, other.file), "utf8");
        expect(otherSource, `${marker.file} ${marker.token}`).not.toContain(marker.token);
      }
    }

    const docsDir = path.resolve(repoRoot, "docs");
    const vitepress = await loadVitepress("vitepress");
    const md = await vitepress.createMarkdownRenderer(docsDir);
    try {
      for (const page of PAGES) {
        const pagePath = path.join(repoRoot, page);
        const html = md.render(readFileSync(pagePath, "utf8"), {
          path: pagePath,
          realPath: pagePath,
        });
        expect(html, page).not.toContain("&lt;&lt;&lt;");
        const blocks = codeBlocks(html);
        for (const marker of MARKERS) {
          const held = blocks.some((block) => block.includes(marker.token));
          expect(held, `${page} ${marker.file}`).toBe(true);
        }
      }
    } finally {
      vitepress.disposeMdItInstance();
    }
  });
});

type MarkdownPage = {
  render: (src: string, env: { path: string; realPath: string }) => string;
};

type VitepressDocs = {
  createMarkdownRenderer: (srcDir: string) => Promise<MarkdownPage>;
  disposeMdItInstance: () => void;
};

function loadVitepress(specifier: string): Promise<VitepressDocs> {
  return import(specifier).then((loaded: unknown) => {
    if (!isVitepressDocs(loaded)) {
      throw new Error("vitepress did not export createMarkdownRenderer");
    }
    return loaded;
  });
}

function isVitepressDocs(value: unknown): value is VitepressDocs {
  if (typeof value !== "object" || value === null) return false;
  if (!("createMarkdownRenderer" in value) || !("disposeMdItInstance" in value)) return false;
  return (
    typeof value.createMarkdownRenderer === "function" &&
    typeof value.disposeMdItInstance === "function"
  );
}

function codeBlocks(html: string): string[] {
  return [...html.matchAll(/<pre\b[\s\S]*?<\/pre>/g)].flatMap((match) => {
    const block = match[0];
    return block === undefined ? [] : [block];
  });
}
