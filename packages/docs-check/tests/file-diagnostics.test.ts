import ts from "typescript";
import { describe, expect, it } from "vitest";
import { fileDiagnostics } from "../src/file-diagnostics.js";

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
});
