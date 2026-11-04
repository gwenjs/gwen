import ts from "typescript";

/**
 * The syntactic and semantic diagnostics of the requested files only, sorted
 * the way `ts.getPreEmitDiagnostics` sorts them (by file path, then position).
 * Files outside the list are never type-checked. A file that is not part of the
 * program is skipped. Options and global diagnostics have no file and are not
 * returned.
 */
export function fileDiagnostics(
  program: ts.Program,
  files: readonly ts.SourceFile[],
): readonly ts.Diagnostic[] {
  const inProgram = files.filter((file) => program.getSourceFile(file.fileName) === file);
  const diagnostics = [
    ...inProgram.flatMap((file) => program.getSyntacticDiagnostics(file)),
    ...inProgram.flatMap((file) => program.getSemanticDiagnostics(file)),
  ];
  return ts.sortAndDeduplicateDiagnostics(diagnostics);
}

/** Skeleton. */
export function needsFullCheck(_file: ts.SourceFile): boolean {
  return false;
}
