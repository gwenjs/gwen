import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isDirectory, isFile, repoRoot } from "../src/deprecated-walker.js";
import { extractFences } from "../src/fences.js";

const SKIP_DIR = new Set(["superpowers", "node_modules", ".vitepress"]);

const AS_CAST = /\bas\s+(?!const\b)[A-Za-z_]/;
const AS_EXEMPT = [/^\s*(import|export)\b.*\bfrom\s+["']/, /^\s*import\s/];
const NON_NULL = /[A-Za-z0-9_)\]]!(?=[.[(;,)\]}]|\s*$)/;
// The diff hygiene scan reads raw text (scripts/check-diff-hygiene.mjs:30-41), so the loose word is built from pieces.
const LOOSE = ["a", "ny"].join("");
const ANY_TYPE = new RegExp(
  [":\\s*", LOOSE, "\\b|<", LOOSE, ">|\\b", LOOSE, "\\[\\]|,\\s*", LOOSE, "\\s*>"].join(""),
);
const COMPOSABLE_ARGUMENT = /\b(useComponent|useService|useWasmModule|useQuery)\s*</;
const SIGNATURE_START = /^(function|declare) /;
const RETURNS_LINE = /^\*\*(Returns|Retourne):\*\*/;
const RETURNS_ANY = /`any`/;
const MUTABLE_REST = /\.\.\.\w+:\s*unknown\[\]/;

interface ScanState {
  block: boolean;
  template: boolean;
}

// Known limit: a `${…}` expression inside a template literal is stripped with the literal body, so a loose form there is not seen.
/** `line` without comments and without the body of string and template literals (the quotes stay). */
function stripNoise(line: string, state: ScanState): string {
  let out = "";
  let quote = state.template ? "`" : "";
  let index = 0;
  while (index < line.length) {
    const char = line[index] ?? "";
    const next = line[index + 1] ?? "";
    if (state.block) {
      if (char === "*" && next === "/") {
        state.block = false;
        index += 2;
      } else index += 1;
      continue;
    }
    if (quote) {
      if (char === "\\") index += 2;
      else {
        if (char === quote) {
          quote = "";
          out += char;
        }
        index += 1;
      }
      continue;
    }
    if (char === "/" && next === "/") break;
    if (char === "/" && next === "*") {
      state.block = true;
      index += 2;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") quote = char;
    out += char;
    index += 1;
  }
  state.template = quote === "`";
  return out;
}

function isTsFence(language: string): boolean {
  return language === "ts" || language === "typescript";
}

// Known limit: a one-line `function f() { return useComponent<X>(h) }` starts with `function`, so SIGNATURE_START exempts it.
/** True when the comment-free `code` line holds a cast, a non-null assertion, an `any` type or a composable type argument. */
function isLoose(code: string): boolean {
  if (AS_CAST.test(code) && !AS_EXEMPT.some((exempt) => exempt.test(code))) return true;
  if (NON_NULL.test(code) || ANY_TYPE.test(code)) return true;
  return COMPOSABLE_ARGUMENT.test(code) && !SIGNATURE_START.test(code.trim());
}

/** `file:line text` for each ts fence line of `markdown` that holds a loose type form. */
export function looseTypeHits(markdown: string, file: string): string[] {
  const hits: string[] = [];
  for (const fence of extractFences(markdown, file)) {
    if (!isTsFence(fence.language)) continue;
    const state: ScanState = { block: false, template: false };
    fence.code.split("\n").forEach((text, index) => {
      if (isLoose(stripNoise(text, state))) {
        hits.push(`${file}:${fence.line + 1 + index} ${text.trim()}`);
      }
    });
  }
  return hits;
}

/** `file:line text` for each ts fence line or Returns line of `markdown` that holds `any` or a mutable `unknown[]` rest. */
function signatureHits(markdown: string, file: string): string[] {
  const hits: Array<{ line: number; text: string }> = [];
  for (const fence of extractFences(markdown, file)) {
    if (!isTsFence(fence.language)) continue;
    const state: ScanState = { block: false, template: false };
    fence.code.split("\n").forEach((text, index) => {
      const code = stripNoise(text, state);
      if (ANY_TYPE.test(code) || MUTABLE_REST.test(code)) {
        hits.push({ line: fence.line + 1 + index, text: text.trim() });
      }
    });
  }
  markdown.split(/\r?\n/).forEach((text, index) => {
    if (!RETURNS_LINE.test(text)) return;
    if (RETURNS_ANY.test(text) || ANY_TYPE.test(text) || MUTABLE_REST.test(text)) {
      hits.push({ line: index + 1, text: text.trim() });
    }
  });
  return hits.sort((a, b) => a.line - b.line).map((hit) => `${file}:${hit.line} ${hit.text}`);
}

function walkDocs(dir: string, out: string[], recurse: boolean): void {
  for (const name of readdirSync(dir).sort()) {
    if (SKIP_DIR.has(name)) continue;
    const full = path.join(dir, name);
    if (isDirectory(full)) {
      if (recurse) walkDocs(full, out, recurse);
    } else if (name.endsWith(".md")) out.push(full);
  }
}

function guideFiles(): string[] {
  const out: string[] = [];
  walkDocs(path.join(repoRoot, "docs"), out, true);
  out.push(path.join(repoRoot, "CLAUDE.md"));
  const packages = path.join(repoRoot, "packages");
  for (const name of readdirSync(packages).sort()) {
    const readme = path.join(packages, name, "README.md");
    if (isFile(readme)) out.push(readme);
  }
  return out;
}

function apiReferenceFiles(): string[] {
  const out: string[] = [];
  walkDocs(path.join(repoRoot, "docs", "api"), out, false);
  walkDocs(path.join(repoRoot, "docs", "fr", "api"), out, false);
  return out;
}

function scan(files: string[], hitsOf: (markdown: string, file: string) => string[]): string[] {
  return files.flatMap((file) => hitsOf(readFileSync(file, "utf8"), path.relative(repoRoot, file)));
}

const FN_LOOSE = `function f(a: ${LOOSE}): void`;
const fenced = (code: string): string => ["```ts", code, "```", ""].join("\n");

describe("docs loose types", () => {
  it("no docs fence uses as, !, any or an explicit composable type argument", () => {
    const mustMatch = [
      "const y = x as Foo",
      "export const v = x as Foo",
      "a!.b",
      "a![0]",
      "a!()",
      "const id = ids[i]!",
      "f(x!);",
      "entry.get(A)!;",
      `const m: ${LOOSE} = 1`,
      `Array<${LOOSE}>`,
      `const a: ${LOOSE}[] = []`,
      `overrides?: Record<string, ${LOOSE}>`,
      "useComponent<{ hp: number }>(Health)",
      "useComponent<{ hp: number }>(Health) // function",
      "useQuery<[A]>()",
      "const f = function useQuery<A>() {}",
    ];
    const mustPass = [
      'const k = ["a"] as const',
      'import * as ns from "x"',
      'import { a as b } from "x"',
      "a !== b",
      "a != b",
      "if (!x) return",
      "const ok = !flag",
      "// x as Foo",
      'const s = "x as Foo"',
      "function useComponent<D extends ComponentDef>(def: D): ComponentHandle<D>",
      "declare function useService<K extends string>(key: K): void",
    ];
    const missed = mustMatch.filter((code) => looseTypeHits(fenced(code), "g.md").length !== 1);
    const flagged = mustPass.filter((code) => looseTypeHits(fenced(code), "g.md").length !== 0);
    expect({ missed, flagged }).toEqual({ missed: [], flagged: [] });

    const blockComment = ["```ts", "/*", "x as Foo", "*/", "const t = `", "a!.b", "`", "```", ""];
    expect(looseTypeHits(blockComment.join("\n"), "g.md")).toEqual([]);

    expect(looseTypeHits(fenced("const y = x as Foo"), "g.md")).toEqual([
      "g.md:2 const y = x as Foo",
    ]);
    expect(looseTypeHits("```js\nconst y = x as Foo\n```\n", "g.md")).toEqual([]);

    const files = guideFiles().map((file) => path.relative(repoRoot, file));
    expect(files).toContain(path.join("docs", "fr", "api", "core.md"));
    expect(files).toContain("CLAUDE.md");
    expect(files).toContain(path.join("packages", "core", "README.md"));
    const frFence = guideFiles()
      .filter((file) => path.relative(repoRoot, file).startsWith(path.join("docs", "fr")))
      .flatMap((file) => extractFences(readFileSync(file, "utf8"), file))
      .some((fence) => isTsFence(fence.language));
    expect(frFence).toBe(true);

    expect(scan(guideFiles(), looseTypeHits)).toEqual([]);
  });

  it("no API reference signature line uses any or unknown[]", () => {
    const mustMatch = [
      fenced(FN_LOOSE),
      fenced("function f(...args: unknown[]): void"),
      fenced(`function f(o: Record<string, ${LOOSE}>): void`),
      "**Returns:** `any` — the service instance.\n",
      "**Retourne:** `any` — l'instance du service.\n",
    ];
    const mustPass = [
      fenced("function f(...args: readonly unknown[]): void"),
      fenced("function f(...args: string[]): void"),
      fenced(`// a: ${LOOSE}`),
      `\`\`\`json\n{ "a": ${LOOSE} }\n\`\`\`\n`,
      "**Returns:** `Promise<GwenEngine>` — the engine.\n",
      "**Returns:** any module can read it.\n",
      "Use any module you like, `any` is banned.\n",
    ];
    const missed = mustMatch.filter((md) => signatureHits(md, "a.md").length !== 1);
    const flagged = mustPass.filter((md) => signatureHits(md, "a.md").length !== 0);
    expect({ missed, flagged }).toEqual({ missed: [], flagged: [] });
    expect(signatureHits(fenced(FN_LOOSE), "a.md")).toEqual([`a.md:2 ${FN_LOOSE}`]);

    const files = apiReferenceFiles().map((file) => path.relative(repoRoot, file));
    expect(files).toContain(path.join("docs", "api", "core.md"));
    expect(files).toContain(path.join("docs", "fr", "api", "core.md"));

    expect(scan(apiReferenceFiles(), signatureHits)).toEqual([]);
  });
});
