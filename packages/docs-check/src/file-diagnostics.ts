import ts from "typescript";

/**
 * The diagnostics of the requested files: exactly what `ts.getPreEmitDiagnostics(program)`
 * returns for them, in the same order (by file path, then position). A diagnostic
 * with no file (options, global) is never returned; a caller that wants those adds
 * `program.getOptionsDiagnostics()` and `program.getGlobalDiagnostics()` itself,
 * after this call, so the global diagnostics deferred by the check are included.
 * A requested file that is not part of the program is skipped.
 *
 * When every requested file passes `needsFullCheck` false, only those files are
 * checked, and the other files of the program are never type-checked. Otherwise the
 * whole program is checked and the result is filtered, because the checker may place
 * an error in a requested file only while it checks another file.
 */
export function fileDiagnostics(
  program: ts.Program,
  files: readonly ts.SourceFile[],
): readonly ts.Diagnostic[] {
  const inProgram = files.filter((file) => program.getSourceFile(file.fileName) === file);
  if (inProgram.some(needsFullCheck)) {
    return ofFiles(ts.getPreEmitDiagnostics(program), inProgram);
  }
  const diagnostics = [
    ...inProgram.flatMap((file) => program.getSyntacticDiagnostics(file)),
    ...inProgram.flatMap((file) => program.getSemanticDiagnostics(file)),
  ];
  return ts.sortAndDeduplicateDiagnostics(ofFiles(diagnostics, inProgram));
}

/**
 * Whether the diagnostics of a file can depend on the check of another file, so
 * that only the whole program gives them all. A module that has no module
 * augmentation, no `declare global` and no ambient module declaration declares
 * nothing that another file shares, and the checker reports its errors while it
 * checks that module. A script file (no import or export) adds to the global scope.
 * An augmentation, a `declare global` block and an ambient module declaration
 * merge into declarations of other files, and the checker may report an error of
 * the merge (for example an index signature constraint) in the file it checks first.
 */
export function needsFullCheck(file: ts.SourceFile): boolean {
  return !ts.isExternalModule(file) || declaresSharedScope(file);
}

function declaresSharedScope(node: ts.Node): boolean {
  if (ts.isModuleDeclaration(node)) {
    const global = (node.flags & ts.NodeFlags.GlobalAugmentation) !== 0;
    if (global || ts.isStringLiteral(node.name)) return true;
  }
  return ts.forEachChild(node, declaresSharedScope) === true;
}

function ofFiles(
  diagnostics: readonly ts.Diagnostic[],
  files: readonly ts.SourceFile[],
): ts.Diagnostic[] {
  return diagnostics.filter((diagnostic) => {
    const owner = diagnostic.file;
    return owner !== undefined && files.includes(owner);
  });
}
