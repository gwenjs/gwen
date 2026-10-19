import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { deprecatedNames, isDirectory, isFile, repoRoot } from "../src/deprecated-walker.js";

const SKIP_DIR = new Set(["superpowers", "node_modules", ".vitepress"]);

function walkDocs(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIR.has(name)) continue;
    const full = path.join(dir, name);
    if (isDirectory(full)) walkDocs(full, out);
    else if (name.endsWith(".md")) out.push(full);
  }
}

function mentionFiles(): string[] {
  const out: string[] = [];
  walkDocs(path.join(repoRoot, "docs"), out);
  const rootReadme = path.join(repoRoot, "README.md");
  if (isFile(rootReadme)) out.push(rootReadme);
  out.push(path.join(repoRoot, "CLAUDE.md"));
  const packages = path.join(repoRoot, "packages");
  for (const name of readdirSync(packages)) {
    const readme = path.join(packages, name, "README.md");
    if (isFile(readme)) out.push(readme);
  }
  return out;
}

/** True when the sentence that contains `index` begins with `Deprecated:`. */
function sentenceBeginsDeprecated(text: string, index: number): boolean {
  let start = 0;
  const boundary = /[.!?][ \t]*(?:\n|$)|[.!?][ \t]+/g;
  let match: RegExpExecArray | null;
  while ((match = boundary.exec(text)) !== null) {
    const end = match.index + match[0].length;
    if (end <= index) start = end;
    else break;
  }
  const paragraph = text.lastIndexOf("\n\n", index);
  if (paragraph !== -1 && paragraph + 2 > start && paragraph + 2 <= index) start = paragraph + 2;
  return text.slice(start).trimStart().startsWith("Deprecated:");
}

/** Names from `deprecatedPublicExports` outside a sentence that begins `Deprecated:`. */
export function deprecatedMentions(): string[] {
  const names = deprecatedNames();
  const hits: string[] = [];
  for (const file of mentionFiles()) {
    const text = readFileSync(file, "utf8");
    const seen = new Set<string>();
    for (const name of names) {
      const pattern = new RegExp(`(?<![A-Za-z0-9_])${name}(?![A-Za-z0-9_])`, "g");
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(text)) !== null) {
        if (sentenceBeginsDeprecated(text, match.index)) continue;
        const line = text.slice(0, match.index).split("\n").length;
        const row = `${path.relative(repoRoot, file)}:${line} ${name}`;
        if (seen.has(row)) continue;
        seen.add(row);
        hits.push(row);
      }
    }
  }
  return hits;
}

describe("deprecated public exports in docs", () => {
  it("the walked set holds a deprecated export and a deprecated interface member", () => {
    const names = deprecatedNames();
    expect(names.length).toBeGreaterThan(0);
    expect(names).toContain("useComponentFor");
    expect(names).toContain("createLiveQuery");
  });

  it("a deprecated name is only named in a sentence that begins Deprecated:", () => {
    expect(deprecatedMentions()).toEqual([]);
  });
});
