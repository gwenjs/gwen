import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isDirectory, isFile, repoRoot } from "../src/deprecated-walker.js";
import { extractFences } from "../src/fences.js";

const SKIP_DIR = new Set(["superpowers", "node_modules", ".vitepress"]);

/** An identifier receiver other than a bare `this`, then a field whose name starts with one underscore. */
const UNDERSCORE_FIELD = /(?<![\w$])(?!this\._)[A-Za-z$][\w$]*\._[A-Za-z]\w*/;

function walkDocs(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIR.has(name)) continue;
    const full = path.join(dir, name);
    if (isDirectory(full)) walkDocs(full, out);
    else if (name.endsWith(".md")) out.push(full);
  }
}

function guideFiles(): string[] {
  const out: string[] = [];
  walkDocs(path.join(repoRoot, "docs"), out);
  out.push(path.join(repoRoot, "CLAUDE.md"));
  const packages = path.join(repoRoot, "packages");
  for (const name of readdirSync(packages)) {
    const readme = path.join(packages, name, "README.md");
    if (isFile(readme)) out.push(readme);
  }
  return out;
}

/** `file:line receiver._field` for each underscore field a ts fence of `markdown` reads or assigns. */
function underscoreHits(markdown: string, file: string): string[] {
  const hits: string[] = [];
  for (const fence of extractFences(markdown, file)) {
    if (fence.language !== "ts" && fence.language !== "typescript") continue;
    fence.code.split("\n").forEach((text, index) => {
      const match = UNDERSCORE_FIELD.exec(text);
      if (match) hits.push(`${file}:${fence.line + 1 + index} ${match[0]}`);
    });
  }
  return hits;
}

describe("underscore fields in docs", () => {
  it("the scanner finds pool._plugin in a ts fence", () => {
    const markdown = ["```ts", "const x = pool._plugin", "```", ""].join("\n");
    expect(underscoreHits(markdown, "guide.md")).toEqual(["guide.md:2 pool._plugin"]);
  });

  it("the scanner finds engine.pool._plugin in a ts fence (chained receiver)", () => {
    const markdown = ["```ts", "const x = engine.pool._plugin", "```", ""].join("\n");
    expect(underscoreHits(markdown, "guide.md")).toEqual(["guide.md:2 pool._plugin"]);
  });

  it("the scanner finds state._x behind a this receiver", () => {
    const markdown = ["```ts", "const x = this.state._x", "```", ""].join("\n");
    expect(underscoreHits(markdown, "guide.md")).toEqual(["guide.md:2 state._x"]);
  });

  it("the scanner ignores this._x", () => {
    const markdown = ["```ts", "const x = this._x", "```", ""].join("\n");
    expect(underscoreHits(markdown, "guide.md")).toEqual([]);
  });

  it("no docs fence reads or assigns an underscore field", () => {
    const hits = guideFiles().flatMap((file) =>
      underscoreHits(readFileSync(file, "utf8"), path.relative(repoRoot, file)),
    );
    expect(hits).toEqual([]);
  });
});
