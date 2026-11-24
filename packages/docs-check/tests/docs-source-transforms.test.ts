import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { KitErrorCodes } from "@gwenjs/kit";
import { ViteErrorCodes } from "../../vite/src/error-codes.js";
import { extractFences, type Fence } from "../src/fences.js";
import { checkFences } from "../src/snippets.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const EN = "docs/kit/source-transforms.md";
const FR = "docs/fr/kit/source-transforms.md";
const PAGES: readonly string[] = [EN, FR];
const FIXTURE_DIR = "packages/vite/tests/fixtures/kit-transform/tint";
const FIXTURES: readonly string[] = ["tint.ts", "module.ts"];
const CONTRACT = "packages/schema/src/source-transform.ts";
const REQUIRED_IDS: readonly string[] = [
  "pipeline-model",
  "example",
  "contract",
  "matching",
  "ordering",
  "errors",
  "testing",
  "limits",
];
const TABLE_CODES: readonly string[] = [
  "KIT:SOURCE_TRANSFORM_INVALID",
  "KIT:SOURCE_TRANSFORM_DUPLICATE",
  "VITE:TRANSFORM_PARSE_FAILED",
  "VITE:TRANSFORM_EDIT_CONFLICT",
  "VITE:TRANSFORM_UNSUPPORTED",
  "VITE:TRANSFORM_UNIT_FAILED",
  "TINT:UNKNOWN_COLOR",
].sort();
const FORBIDDEN_IN_FENCES: readonly string[] = [
  "@gwenjs/vite",
  "oxc-parser",
  "oxc-walker",
  "magic-string",
];
const ROW_CODE = /^\|\s*\[?`([A-Z][A-Z0-9_]*:[A-Z][A-Z0-9_]*)`(?:\]\(([^)]*)\))?\s*\|/;

/** The file text, or "" when the file is absent, so every red is an assertion. */
function text(rel: string): string {
  const full = path.join(root, rel);
  return existsSync(full) ? readFileSync(full, "utf8") : "";
}

function checkFencesOf(rel: string): Fence[] {
  return extractFences(text(rel), rel).filter((fence) => fence.tag === "check");
}

function ids(rel: string): string[] {
  return [...text(rel).matchAll(/\{#([a-z0-9-]+)\}/g)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );
}

/** Lines of one `## ` section, from the heading that holds `{#id}` to the next `## `. */
function section(rel: string, id: string): string[] {
  const lines = text(rel).split("\n");
  const start = lines.findIndex((line) => line.startsWith("## ") && line.includes(`{#${id}}`));
  if (start < 0) return [];
  const body: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.startsWith("## ")) break;
    body.push(line);
  }
  return body;
}

interface TableRow {
  code: string;
  link: string | undefined;
  line: string;
}

function errorRows(rel: string): TableRow[] {
  const rows: TableRow[] = [];
  for (const line of section(rel, "errors")) {
    const match = ROW_CODE.exec(line);
    if (match?.[1] === undefined) continue;
    rows.push({ code: match[1], link: match[2], line });
  }
  return rows;
}

/** Heading lines outside fences. */
function headingCount(rel: string): number {
  let open = false;
  let count = 0;
  for (const line of text(rel).split("\n")) {
    if (line.startsWith("```")) open = !open;
    if (!open && /^#{1,4} /.test(line)) count += 1;
  }
  return count;
}

function kebab(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function interfaceMembers(file: ts.SourceFile, name: string): string[] {
  const names: string[] = [];
  for (const statement of file.statements) {
    if (!ts.isInterfaceDeclaration(statement) || statement.name.text !== name) continue;
    for (const member of statement.members) {
      if (member.name !== undefined && ts.isIdentifier(member.name)) names.push(member.name.text);
    }
  }
  return names;
}

describe("source transforms docs", () => {
  it("the EN and FR pages exist and are in both sidebars", () => {
    for (const rel of PAGES) {
      expect(existsSync(path.join(root, rel)), rel).toBe(true);
    }
    const config = text("docs/.vitepress/config.ts");
    const kitEn = config.slice(
      config.indexOf("text: 'Kit — Extending GWEN'"),
      config.indexOf("text: 'API Reference'"),
    );
    const kitFr = config.slice(
      config.indexOf("text: 'Kit — Étendre GWEN'"),
      config.indexOf("text: 'Référence API'"),
    );
    expect(kitEn).toMatch(/link:\s*['"]\/kit\/source-transforms['"]/);
    expect(kitFr).toMatch(/link:\s*['"]\/fr\/kit\/source-transforms['"]/);
  });

  it("each page holds the example as ts check fences", () => {
    for (const rel of PAGES) {
      const fences = checkFencesOf(rel);
      expect(fences.length, rel).toBe(2);
      expect(fences[0]?.code, rel).toContain("export function defineTint");
      expect(fences[1]?.code, rel).toContain("defineGwenModule({");
    }
  });

  it("the example fences equal the vite fixture files", () => {
    for (const rel of PAGES) {
      const fences = checkFencesOf(rel);
      expect(fences.length, rel).toBe(FIXTURES.length);
      FIXTURES.forEach((name, index) => {
        const fixture = readFileSync(path.join(root, FIXTURE_DIR, name), "utf8");
        const cut = fixture.indexOf("\n");
        const header = fixture.slice(0, cut);
        expect(header.startsWith("/**") && header.endsWith("*/"), `${name} header`).toBe(true);
        expect(fences[index]?.code, `${rel} ${name}`).toBe(fixture.slice(cut + 1).trimEnd());
      });
    }
  });

  it("the example compiles", () => {
    for (const rel of PAGES) {
      const fences = checkFencesOf(rel);
      expect(fences.length, rel).toBeGreaterThan(0);
      expect(checkFences(fences), rel).toEqual([]);
    }
  });

  it("the example imports neither @gwenjs/vite nor an oxc package", () => {
    for (const rel of PAGES) {
      const fences = checkFencesOf(rel);
      expect(fences.length, rel).toBe(2);
      for (const fence of fences) {
        for (const word of FORBIDDEN_IN_FENCES) {
          expect(fence.code.includes(word), `${rel} ${word}`).toBe(false);
        }
      }
      expect(fences[1]?.code, rel).toContain("kit.addSourceTransform(");
      expect(fences[1]?.code, rel).toContain('"TINT:UNKNOWN_COLOR"');
    }
  });

  it("every code in the page's error table is a value of KitErrorCodes or ViteErrorCodes, or the example's TINT:UNKNOWN_COLOR", () => {
    const known = new Set<string>([
      ...Object.values(KitErrorCodes),
      ...Object.values(ViteErrorCodes),
    ]);
    const sets: string[][] = [];
    for (const rel of PAGES) {
      const rows = errorRows(rel);
      const codes = rows.map((row) => row.code).sort();
      expect(codes, rel).toEqual(TABLE_CODES);
      sets.push(codes);
      const prefix = rel === EN ? "/api/errors#" : "/fr/api/errors#";
      const errorsPage = text(rel === EN ? "docs/api/errors.md" : "docs/fr/api/errors.md");
      for (const row of rows) {
        if (row.code.startsWith("TINT:")) {
          expect(row.link, row.code).toBeUndefined();
          continue;
        }
        expect(known.has(row.code), row.code).toBe(true);
        const anchor = row.code.toLowerCase().replace(/[:_]/g, "-");
        expect(row.link, row.code).toBe(`${prefix}${anchor}`);
        expect(errorsPage.includes(`{#${anchor}}`), `${row.code} anchor`).toBe(true);
      }
    }
    expect(sets[1]).toEqual(sets[0]);
  });

  it("the page has a section for each member of the contract", () => {
    const source = readFileSync(path.join(root, CONTRACT), "utf8");
    const file = ts.createSourceFile(CONTRACT, source, ts.ScriptTarget.Latest, true);
    const context = interfaceMembers(file, "GwenTransformContext");
    const transform = interfaceMembers(file, "GwenSourceTransform");
    expect(context).toContain("calls");
    expect(transform).toContain("run");
    const wanted = [
      ...REQUIRED_IDS,
      ...context.map((member) => `ctx-${kebab(member)}`),
      ...transform.map((member) => `transform-${member}`),
    ];
    for (const rel of PAGES) {
      const found = ids(rel);
      for (const id of wanted) expect(found, rel).toContain(id);
    }
  });

  it("the FR page keeps the section ids and the fences of the EN page", () => {
    const en = ids(EN);
    expect(en.length).toBeGreaterThan(0);
    expect(ids(FR)).toEqual(en);
    expect(headingCount(FR)).toBe(headingCount(EN));
    const enFences = extractFences(text(EN), EN).map((fence) => `${fence.language}\n${fence.code}`);
    const frFences = extractFences(text(FR), FR).map((fence) => `${fence.language}\n${fence.code}`);
    expect(enFences.length).toBeGreaterThan(0);
    expect(frFences).toEqual(enFences);
    const spans = (rel: string): string[] =>
      errorRows(rel)
        .flatMap((row) => [...row.line.matchAll(/`([^`]+)`/g)])
        .flatMap((match) => (match[1] === undefined ? [] : [match[1]]))
        .sort();
    expect(spans(EN).length).toBeGreaterThan(0);
    expect(spans(FR)).toEqual(spans(EN));
  });
});
