import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";
import type { Fence } from "../src/fences.js";
import { SourceCache } from "../src/shared-sources.js";
import { checkFence, checkFences, snippetSourceCache } from "../src/snippets.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const schemaIndex = path.join(repoRoot, "packages/schema/src/index.ts");

const options: ts.CompilerOptions = {
  strict: true,
  noEmit: true,
  skipLibCheck: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  types: [],
};

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "gwen-shared-sources-"));
  tempDirs.push(dir);
  return dir;
}

/** A program whose synthetic files are served first and every other file through the cache. */
function programOver(
  cache: SourceCache,
  roots: string[],
  synthetic: Map<string, string> = new Map(),
): ts.Program {
  const host = ts.createCompilerHost(options, true);
  const cached = cache.through(host.getSourceFile.bind(host));
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
    const text = synthetic.get(path.resolve(fileName));
    if (text !== undefined) {
      return ts.createSourceFile(fileName, text, languageVersion, true, ts.ScriptKind.TS);
    }
    return cached(fileName, languageVersion, onError, shouldCreateNewSourceFile);
  };
  const exists = host.fileExists.bind(host);
  host.fileExists = (fileName) => synthetic.has(path.resolve(fileName)) || exists(fileName);
  return ts.createProgram(roots, options, host);
}

function messages(program: ts.Program): string[] {
  return ts
    .getPreEmitDiagnostics(program)
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
}

describe("shared parsed sources", () => {
  it("parses a real file once and serves the second program from the cache", () => {
    const cache = new SourceCache();
    const first = programOver(cache, [schemaIndex]);
    const parsed = cache.parses;
    expect(parsed).toBeGreaterThan(0);
    const second = programOver(cache, [schemaIndex]);
    expect(cache.parses).toBe(parsed);
    expect(messages(second)).toEqual(messages(first));
  });

  it("parses a file again after its content changes", () => {
    const file = path.join(tempDir(), "value.ts");
    writeFileSync(file, "export const value = 1;\n");
    const cache = new SourceCache();
    const first = programOver(cache, [file]);
    expect(first.getSourceFile(file)?.text).toBe("export const value = 1;\n");
    const parsed = cache.parses;

    writeFileSync(file, 'export const value = "changed";\n');
    utimesSync(file, new Date(2031, 0, 1), new Date(2031, 0, 1));
    const second = programOver(cache, [file]);
    expect(second.getSourceFile(file)?.text).toBe('export const value = "changed";\n');
    expect(cache.parses).toBe(parsed + 1);
  });

  it("does not share a file between two language versions", () => {
    const cache = new SourceCache();
    const read = cache.through(ts.createCompilerHost(options, true).getSourceFile);
    const es2020 = read(schemaIndex, ts.ScriptTarget.ES2020);
    const es2022 = read(schemaIndex, ts.ScriptTarget.ES2022);
    expect(es2020?.languageVersion).toBe(ts.ScriptTarget.ES2020);
    expect(es2022?.languageVersion).toBe(ts.ScriptTarget.ES2022);
    expect(cache.parses).toBe(2);
    expect(read(schemaIndex, ts.ScriptTarget.ES2022)).toBe(es2022);
    expect(cache.parses).toBe(2);
  });

  it("never caches a synthetic file", () => {
    const name = path.resolve("/virtual/gwen-shared-sources/synthetic.ts");
    const cache = new SourceCache();
    const first = programOver(cache, [name], new Map([[name, "export const v = 1;\n"]]));
    expect(first.getSourceFile(name)?.text).toBe("export const v = 1;\n");
    const parsed = cache.parses;
    expect(parsed).toBeGreaterThan(0);
    const second = programOver(cache, [name], new Map([[name, 'export const v = "two";\n']]));
    expect(second.getSourceFile(name)?.text).toBe('export const v = "two";\n');
    expect(cache.parses).toBe(parsed);

    let text = "export const w = 1;\n";
    const direct = new SourceCache();
    const read = direct.through((fileName, languageVersion) =>
      ts.createSourceFile(fileName, text, languageVersion, true, ts.ScriptKind.TS),
    );
    const missing = path.resolve("/virtual/gwen-shared-sources/not-on-disk.ts");
    expect(read(missing, ts.ScriptTarget.ES2022)?.text).toBe("export const w = 1;\n");
    text = "export const w = 2;\n";
    expect(read(missing, ts.ScriptTarget.ES2022)?.text).toBe("export const w = 2;\n");
    expect(direct.parses).toBe(0);
  });

  it("clear forgets every file", () => {
    const cache = new SourceCache();
    programOver(cache, [schemaIndex]);
    const parsed = cache.parses;
    programOver(cache, [schemaIndex]);
    expect(cache.parses).toBe(parsed);
    cache.clear();
    programOver(cache, [schemaIndex]);
    expect(cache.parses).toBe(parsed * 2);
  });

  it("checkFence reuses the parsed framework files between two fences", () => {
    const fence = (code: string): Fence => ({
      file: "docs/sample.md",
      line: 1,
      language: "ts",
      tag: "check",
      code,
    });
    const before = snippetSourceCache().parses;
    expect(checkFence(fence('import { defineComponent } from "@gwenjs/core";'))).toBeNull();
    const first = snippetSourceCache().parses;
    expect(first).toBeGreaterThan(before);
    expect(checkFence(fence('import { createEngine } from "@gwenjs/core";'))).toBeNull();
    expect(snippetSourceCache().parses).toBe(first);

    expect(checkFences([fence('import { useDynamicBody } from "@gwenjs/physics2d";')])).toEqual([]);
    const batch = snippetSourceCache().parses;
    expect(batch).toBeGreaterThan(first);
    expect(checkFences([fence('import { useStaticBody } from "@gwenjs/physics2d";')])).toEqual([]);
    expect(snippetSourceCache().parses).toBe(batch);
  });
});
