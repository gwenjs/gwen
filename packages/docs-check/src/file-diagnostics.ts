import type ts from "typescript";

/** Skeleton: reports nothing. */
export function fileDiagnostics(
  _program: ts.Program,
  _files: readonly ts.SourceFile[],
): readonly ts.Diagnostic[] {
  return [];
}
