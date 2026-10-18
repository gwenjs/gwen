import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { gwenSourceAliases } from "../../../vitest.aliases.js";
import type { Fence } from "./fences.js";

export interface SnippetFailure {
  file: string;
  line: number;
  message: string;
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const packageRoot = path.join(repoRoot, "packages/docs-check");

/**
 * Type-check one tagged fence. Untagged fences are skipped.
 * `run` fences see the pre-bound `engine`. Nothing else is declared.
 */
export function checkFence(fence: Fence): SnippetFailure | null {
  return typecheck(fence).failure;
}

function typecheck(
  fence: Fence,
  oldProgram?: ts.Program,
): { failure: SnippetFailure | null; program?: ts.Program } {
  if (fence.tag !== "check" && fence.tag !== "run") return { failure: null };
  const sourceText = `${fence.code}\n`;
  const snippetName = path.join(packageRoot, "__docs_snippet__.ts");
  const engineName = path.join(packageRoot, "__docs_engine__.d.ts");
  const engineText = 'declare const engine: import("@gwenjs/core").GwenEngine;\n';
  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    baseUrl: repoRoot,
    paths: aliasPaths(),
    verbatimModuleSyntax: true,
    ignoreDeprecations: "6.0",
    types: ["node"],
    typeRoots: [path.join(packageRoot, "node_modules/@types")],
  };
  const host = ts.createCompilerHost(options, true);
  const read = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
    const resolved = path.resolve(fileName);
    if (resolved === snippetName) {
      return ts.createSourceFile(fileName, sourceText, languageVersion, true, ts.ScriptKind.TS);
    }
    if (resolved === engineName) {
      return ts.createSourceFile(fileName, engineText, languageVersion, true, ts.ScriptKind.TS);
    }
    return read(fileName, languageVersion, onError, shouldCreateNewSourceFile);
  };
  const exists = host.fileExists.bind(host);
  host.fileExists = (fileName) => {
    const resolved = path.resolve(fileName);
    return resolved === snippetName || resolved === engineName || exists(fileName);
  };
  const roots = fence.tag === "run" ? [snippetName, engineName] : [snippetName];
  const program = ts.createProgram(roots, options, host, oldProgram);
  const diagnostics = ts.getPreEmitDiagnostics(program).filter((diagnostic) => {
    const name = diagnostic.file?.fileName;
    return name !== undefined && path.resolve(name) === snippetName;
  });
  const first = diagnostics[0];
  if (!first) return { failure: null, program };
  const start = first.start ?? 0;
  const position = first.file?.getLineAndCharacterOfPosition(start);
  const tscLine = (position?.line ?? 0) + 1;
  const line = fence.line + tscLine;
  const text = ts.flattenDiagnosticMessageText(first.messageText, "\n");
  return {
    failure: { file: fence.file, line, message: `${fence.file}:${line} ${text}` },
    program,
  };
}

export function checkFences(fences: Fence[]): SnippetFailure[] {
  const failures: SnippetFailure[] = [];
  let previous: ts.Program | undefined;
  for (const fence of fences) {
    const result = typecheck(fence, previous);
    if (result.program) previous = result.program;
    if (result.failure) failures.push(result.failure);
  }
  return failures;
}

function aliasPaths(): Record<string, string[]> {
  const paths: Record<string, string[]> = {};
  for (const alias of gwenSourceAliases()) {
    const spec = alias.find.source.replace(/^\^/, "").replace(/\$$/, "").replace(/\\(.)/g, "$1");
    paths[spec] = [path.relative(repoRoot, alias.replacement)];
  }
  return paths;
}
