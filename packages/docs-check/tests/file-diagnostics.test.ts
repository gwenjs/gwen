import ts from "typescript";
import { describe, expect, it } from "vitest";
import { fileDiagnostics, needsFullCheck } from "../src/file-diagnostics.js";

const options: ts.CompilerOptions = {
  strict: true,
  noEmit: true,
  skipLibCheck: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  types: [],
  lib: ["lib.es5.d.ts"],
};

const TYPE_ERROR = 'export const value: number = "text";\n';
const SYNTAX_ERROR = "export const value = ;\n";
const CLEAN = "export const value = 1;\n";

/** A program over in-memory files; the default library is read from disk. */
function programOf(files: Record<string, string>): ts.Program {
  const host = ts.createCompilerHost(options, true);
  const read = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
    const text = files[fileName];
    if (text !== undefined) {
      return ts.createSourceFile(fileName, text, languageVersion, true, ts.ScriptKind.TS);
    }
    return read(fileName, languageVersion, onError, shouldCreateNewSourceFile);
  };
  const exists = host.fileExists.bind(host);
  host.fileExists = (fileName) => fileName in files || exists(fileName);
  const directoryExists = host.directoryExists?.bind(host);
  host.directoryExists = (dir) => dir === "/virtual" || (directoryExists?.(dir) ?? false);
  return ts.createProgram(Object.keys(files), options, host);
}

/** One readable line per diagnostic: file, position, code. */
function summary(diagnostics: readonly ts.Diagnostic[]): string[] {
  return diagnostics.map(
    (diagnostic) =>
      `${diagnostic.file?.fileName ?? "-"}:${diagnostic.start ?? -1}:${diagnostic.code}`,
  );
}

function sourceOf(program: ts.Program, fileName: string): ts.SourceFile {
  const file = program.getSourceFile(fileName);
  if (!file) throw new Error(`${fileName} is not in the program`);
  return file;
}

describe("file diagnostics", () => {
  it("reports the errors of the requested files only", () => {
    const program = programOf({ "/virtual/a.ts": TYPE_ERROR, "/virtual/b.ts": TYPE_ERROR });
    const a = sourceOf(program, "/virtual/a.ts");
    const b = sourceOf(program, "/virtual/b.ts");
    expect(ts.getPreEmitDiagnostics(program).some((diagnostic) => diagnostic.file === b)).toBe(
      true,
    );

    const diagnostics = fileDiagnostics(program, [a]);

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([2322]);
    expect(diagnostics.every((diagnostic) => diagnostic.file === a)).toBe(true);
  });

  it("orders the diagnostics of the requested files like getPreEmitDiagnostics", () => {
    const program = programOf({ "/virtual/a.ts": TYPE_ERROR, "/virtual/b.ts": SYNTAX_ERROR });
    const files = [sourceOf(program, "/virtual/b.ts"), sourceOf(program, "/virtual/a.ts")];
    const expected = ts
      .getPreEmitDiagnostics(program)
      .filter((diagnostic) => diagnostic.file !== undefined && files.includes(diagnostic.file));
    expect(expected.map((diagnostic) => diagnostic.file?.fileName)).toEqual([
      "/virtual/a.ts",
      "/virtual/b.ts",
    ]);

    const diagnostics = fileDiagnostics(program, files);

    expect(summary(diagnostics)).toEqual(summary(expected));
  });

  it("orders the diagnostics of one file by position", () => {
    const program = programOf({
      "/virtual/mixed.ts": `${TYPE_ERROR}export const other = ;\nexport const third: string = 1;\n`,
    });
    const file = sourceOf(program, "/virtual/mixed.ts");
    const expected = ts.getPreEmitDiagnostics(program);
    const starts = expected.map((diagnostic) => diagnostic.start ?? 0);
    expect(starts).toEqual(starts.slice().sort((x, y) => x - y));

    expect(expected).toHaveLength(3);
    expect(summary(fileDiagnostics(program, [file]))).toEqual(summary(expected));
  });

  it("reports nothing for clean files", () => {
    const program = programOf({ "/virtual/clean.ts": CLEAN, "/virtual/broken.ts": TYPE_ERROR });
    const broken = sourceOf(program, "/virtual/broken.ts");
    expect(ts.getPreEmitDiagnostics(program).some((diagnostic) => diagnostic.file === broken)).toBe(
      true,
    );

    expect(fileDiagnostics(program, [sourceOf(program, "/virtual/clean.ts")])).toEqual([]);
  });

  it("skips a requested file that the program does not contain", () => {
    const program = programOf({ "/virtual/a.ts": TYPE_ERROR });
    const stranger = ts.createSourceFile(
      "/virtual/stranger.ts",
      SYNTAX_ERROR,
      ts.ScriptTarget.ES2022,
      true,
      ts.ScriptKind.TS,
    );
    expect(program.getSourceFile("/virtual/stranger.ts")).toBeUndefined();

    expect(fileDiagnostics(program, [stranger])).toEqual([]);
  });

  it("does not return a deferred global diagnostic raised while checking the file", () => {
    const text = `function* g() { yield 1; }\n${TYPE_ERROR}`;
    const raw = programOf({ "/virtual/snippet.ts": text });
    const rawSnippet = sourceOf(raw, "/virtual/snippet.ts");
    const deferred = raw.getSemanticDiagnostics(rawSnippet).filter((d) => d.file === undefined);
    expect(deferred.map((diagnostic) => diagnostic.code)).toEqual([2318]);
    expect(needsFullCheck(rawSnippet)).toBe(false);

    const program = programOf({ "/virtual/snippet.ts": text });
    const snippet = sourceOf(program, "/virtual/snippet.ts");
    const diagnostics = fileDiagnostics(program, [snippet]);

    expect(diagnostics.every((diagnostic) => diagnostic.file === snippet)).toBe(true);
    expect(diagnostics[0]?.code).toBe(2322);
  });

  it("reports an index-signature error of an augmented interface that only the declaring file's check finds", () => {
    const program = programOf({
      "/virtual/lib.ts": "export interface Hooks { [name: string]: (...a: unknown[]) => void }\n",
      "/virtual/snippet.ts":
        'import "./lib";\ndeclare module "./lib" { interface Hooks { bad: number } }\nexport {};\n',
    });
    const snippet = sourceOf(program, "/virtual/snippet.ts");
    const expected = ts.getPreEmitDiagnostics(program).filter((d) => d.file === snippet);
    expect(expected.map((diagnostic) => diagnostic.code)).toContain(2411);

    const fresh = programOf({
      "/virtual/lib.ts": "export interface Hooks { [name: string]: (...a: unknown[]) => void }\n",
      "/virtual/snippet.ts":
        'import "./lib";\ndeclare module "./lib" { interface Hooks { bad: number } }\nexport {};\n',
    });

    expect(summary(fileDiagnostics(fresh, [sourceOf(fresh, "/virtual/snippet.ts")]))).toEqual(
      summary(expected),
    );
  });
});

describe("needsFullCheck", () => {
  it("needsFullCheck is false for a plain module", () => {
    expect(needsFullCheck(parse("import { a } from './a';\nexport const b = a;\n"))).toBe(false);
  });

  it("needsFullCheck is true for a script file", () => {
    expect(needsFullCheck(parse("const value = 1;\ninterface Shared { a: string }\n"))).toBe(true);
  });

  it("needsFullCheck is true for a module augmentation, a declare global block and an ambient module declaration", () => {
    const constructs: Record<string, string> = {
      "module augmentation": 'declare module "./lib" { interface Hooks { bad: number } }',
      "declare global": "declare global { interface Window { shared: number } }",
      "ambient module": 'declare module "ambient-thing" { export const value: number }',
      "nested declare global": "namespace Outer { declare global { var shared: number } }",
      "nested ambient module": 'namespace Outer { declare module "inner" {} }',
    };
    for (const [name, construct] of Object.entries(constructs)) {
      expect(needsFullCheck(parse(`export {};\n${construct}\n`)), name).toBe(true);
    }
  });
});

function parse(text: string): ts.SourceFile {
  return ts.createSourceFile(
    "/virtual/probe.ts",
    text,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS,
  );
}
