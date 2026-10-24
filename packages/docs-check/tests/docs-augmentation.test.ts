import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isDirectory, isFile, repoRoot } from "../src/deprecated-walker.js";
import { extractFences } from "../src/fences.js";

const SKIP_DIR = new Set(["superpowers", "node_modules", ".vitepress"]);

/** The contract interfaces whose only augmentation target is `@gwenjs/schema`. */
const CONTRACTS = [
  "GwenRuntimeHooks",
  "GwenProvides",
  "GwenModuleOptions",
  "GwenPrefabExtensions",
  "GwenSceneExtensions",
  "GwenUIExtensions",
];

const WRONG_TARGET = /declare\s+module\s+['"]@gwenjs\/(?:core|app)['"]/;
const WRONG_BLOCK = /declare\s+module\s+['"]@gwenjs\/(?:core|app)['"]\s*\{/g;
const CONTRACT_DECLARATION = new RegExp(`interface\\s+(?:${CONTRACTS.join("|")})\\b`);

function walkDocs(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIR.has(name)) continue;
    const full = path.join(dir, name);
    if (isDirectory(full)) walkDocs(full, out);
    else if (name.endsWith(".md")) out.push(full);
  }
}

/** docs/**\/*.md (EN and docs/fr), CLAUDE.md and every packages/*\/README.md. */
function scannedFiles(): string[] {
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

/** Index of the `}` that closes the `{` at `open`, or -1. */
function matchBrace(code: string, open: number): number {
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    if (code[i] === "{") depth += 1;
    else if (code[i] === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** `line` of each fenced `declare module "@gwenjs/core|app"` block that declares a contract. */
function fenceHits(markdown: string, file: string): string[] {
  const hits: string[] = [];
  for (const fence of extractFences(markdown, file)) {
    WRONG_BLOCK.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = WRONG_BLOCK.exec(fence.code)) !== null) {
      const open = match.index + match[0].length - 1;
      const close = matchBrace(fence.code, open);
      const body = fence.code.slice(open, close === -1 ? undefined : close);
      if (!CONTRACT_DECLARATION.test(body)) continue;
      const offset = fence.code.slice(0, match.index).split("\n").length;
      hits.push(`${file}:${fence.line + offset}`);
    }
  }
  return hits;
}

/** Prose lines (outside every fence) that name the wrong augmentation target. */
function proseHits(markdown: string, file: string): string[] {
  const inFence = new Set<number>();
  for (const fence of extractFences(markdown, file)) {
    const bodyLines = fence.code === "" ? 0 : fence.code.split("\n").length;
    for (let line = fence.line; line <= fence.line + bodyLines + 1; line += 1) inFence.add(line);
  }
  const hits: string[] = [];
  markdown.split(/\r?\n/).forEach((text, index) => {
    if (!inFence.has(index + 1) && WRONG_TARGET.test(text)) hits.push(`${file}:${index + 1}`);
  });
  return hits;
}

const AVOID_SCHEMA = [
  /do not import @gwenjs\/schema[^\n]*plugin code/i,
  /n['’]importez pas @gwenjs\/schema/i,
  /not published to npm/i,
  /internal workspace (?:package|dependency)/i,
  /non publi[ée]e? sur npm/i,
  /(?:package|paquet|dépendance) interne du workspace/i,
];

/** Lines that tell plugin authors not to use `@gwenjs/schema` (markup stripped first). */
function avoidSchemaHits(markdown: string, file: string): string[] {
  const hits: string[] = [];
  markdown.split(/\r?\n/).forEach((text, index) => {
    const plain = text.replace(/[*`]/g, "");
    if (AVOID_SCHEMA.some((pattern) => pattern.test(plain))) hits.push(`${file}:${index + 1}`);
  });
  return hits;
}

/** Fails when the scanned set misses a file this change fixed (a silent walk would hide it). */
function expectScanned(files: string[]): void {
  const scanned = new Set(files.map((file) => path.relative(repoRoot, file)));
  for (const rel of [
    "CLAUDE.md",
    "packages/schema/README.md",
    "docs/kit/custom-plugin.md",
    "docs/fr/kit/custom-plugin.md",
    "docs/kit/custom-module.md",
    "docs/fr/kit/custom-module.md",
    "docs/guide/installation.md",
    "docs/fr/guide/installation.md",
  ]) {
    expect(scanned.has(rel), `${rel} is scanned`).toBe(true);
  }
}

const BAD_FENCE = [
  "intro",
  "```ts",
  "declare module '@gwenjs/app' {",
  "  interface GwenModuleOptions { foo: string }",
  "}",
  "```",
].join("\n");
const GOOD_FENCE = BAD_FENCE.replace("@gwenjs/app", "@gwenjs/schema");
const UNRELATED_FENCE = BAD_FENCE.replace("GwenModuleOptions", "SomethingElse");

describe("docs augment @gwenjs/schema", () => {
  it("no doc augments @gwenjs/core or @gwenjs/app for a contract", () => {
    // The scanners find a bad sample and ignore good ones.
    expect(fenceHits(BAD_FENCE, "bad.md")).toEqual(["bad.md:3"]);
    expect(fenceHits(GOOD_FENCE, "good.md")).toEqual([]);
    expect(fenceHits(UNRELATED_FENCE, "other.md")).toEqual([]);
    expect(proseHits('Use `declare module "@gwenjs/app"` here.', "p.md")).toEqual(["p.md:1"]);
    expect(proseHits(BAD_FENCE, "bad.md")).toEqual([]);

    const files = scannedFiles();
    expectScanned(files);
    const hits: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      const rel = path.relative(repoRoot, file);
      hits.push(...fenceHits(text, rel), ...proseHits(text, rel));
    }
    expect(hits).toEqual([]);
  });

  it("no doc tells plugin authors to avoid @gwenjs/schema", () => {
    expect(
      avoidSchemaHits(
        "Do **not** import `@gwenjs/schema` in browser bundles or end-user plugin code.",
        "e.md",
      ),
    ).toEqual(["e.md:1"]);
    expect(avoidSchemaHits("N'importez pas `@gwenjs/schema` dans un plugin.", "f.md")).toEqual([
      "f.md:1",
    ]);
    expect(avoidSchemaHits("Import the shared types from `@gwenjs/schema`.", "g.md")).toEqual([]);
    expect(
      avoidSchemaHits("> **Internal workspace package — not published to npm.**", "h.md"),
    ).toEqual(["h.md:1"]);
    expect(
      avoidSchemaHits(
        "This package is an **internal workspace dependency** and is not published to npm.",
        "i.md",
      ),
    ).toEqual(["i.md:1"]);
    expect(avoidSchemaHits("Ce paquet est non publié sur npm.", "j.md")).toEqual(["j.md:1"]);
    expect(avoidSchemaHits("C'est une dépendance interne du workspace.", "k.md")).toEqual([
      "k.md:1",
    ]);
    expect(avoidSchemaHits("Private package. It is not published.", "l.md")).toEqual([]);

    const files = scannedFiles();
    expectScanned(files);
    const hits: string[] = [];
    for (const file of files) {
      hits.push(...avoidSchemaHits(readFileSync(file, "utf8"), path.relative(repoRoot, file)));
    }
    expect(hits).toEqual([]);
  });

  it("the schema README states that instanceof GwenError needs one schema copy", () => {
    const readme = readFileSync(path.join(repoRoot, "packages/schema/README.md"), "utf8")
      .replace(/`/g, "")
      .replace(/\s+/g, " ");
    expect(readme).toContain("instanceof GwenError requires one copy of @gwenjs/schema");
    expect(readme).toMatch(/Do not mix require and import of the schema/);
    expect(readme).toMatch(/do not install two versions/);
  });

  it("the install command lists @gwenjs/schema next to the packages the docs augment through it", () => {
    for (const rel of ["docs/guide/installation.md", "docs/fr/guide/installation.md"]) {
      const lines = readFileSync(path.join(repoRoot, rel), "utf8").split(/\r?\n/);
      const install = lines.filter(
        (line) => line.startsWith("pnpm add ") && line.includes("@gwenjs/core"),
      );
      expect(install, `${rel} has one core install line`).toHaveLength(1);
      expect((install[0] ?? "").split(/\s+/), rel).toContain("@gwenjs/schema");
    }
  });
});
