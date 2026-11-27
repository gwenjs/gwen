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

  it("every quick-start include renders as a code block and not as text", async () => {
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
        const shown = renderedCode(html);
        for (const file of EXPECTED) {
          const source = readFileSync(path.join(repoRoot, file), "utf8").trim();
          expect(shown, `${page} ${file}`).toContain(source);
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
    if (isVitepressDocs(loaded) === false) {
      throw new Error("vitepress did not export createMarkdownRenderer");
    }
    return loaded;
  });
}

function isVitepressDocs(value: unknown): value is VitepressDocs {
  if (typeof value === "object") {
    if (value === null) return false;
  } else {
    return false;
  }
  if ("createMarkdownRenderer" in value === false) return false;
  if ("disposeMdItInstance" in value === false) return false;
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

/** Text of every `<pre>` block, tags removed and HTML entities decoded. */
function renderedCode(html: string): string {
  return decodeHtml(
    codeBlocks(html)
      .map((block) => block.replace(/<[^>]+>/g, ""))
      .join("\n"),
  );
}

function decodeHtml(text: string): string {
  return text.replace(/&(?:#[xX][0-9a-fA-F]+|#\d+|lt|gt|amp|quot);/g, (entity: string) => {
    if (entity.startsWith("&#x") || entity.startsWith("&#X")) {
      return fromCodePoint(Number.parseInt(entity.slice(3, -1), 16), entity);
    }
    if (entity.startsWith("&#")) {
      return fromCodePoint(Number.parseInt(entity.slice(2, -1), 10), entity);
    }
    if (entity === "&lt;") return "<";
    if (entity === "&gt;") return ">";
    if (entity === "&amp;") return "&";
    if (entity === "&quot;") return '"';
    return entity;
  });
}

function fromCodePoint(value: number, entity: string): string {
  const inRange =
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 0x10ffff &&
    (value < 0xd800 || value > 0xdfff);
  if (inRange === false) return entity;
  return String.fromCodePoint(value);
}
