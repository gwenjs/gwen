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
  if (fence.tag !== "check" && fence.tag !== "run") return null;
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
  const program = ts.createProgram(roots, options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program).filter((diagnostic) => {
    const name = diagnostic.file?.fileName;
    return name !== undefined && path.resolve(name) === snippetName;
  });
  const first = diagnostics[0];
  if (!first) return null;
  const start = first.start ?? 0;
  const position = first.file?.getLineAndCharacterOfPosition(start);
  const tscLine = (position?.line ?? 0) + 1;
  const line = fence.line + tscLine;
  const text = ts.flattenDiagnosticMessageText(first.messageText, "\n");
  return { file: fence.file, line, message: `${fence.file}:${line} ${text}` };
}

export function checkFences(fences: Fence[]): SnippetFailure[] {
  return fences.flatMap((fence) => {
    const failure = checkFence(fence);
    return failure === null ? [] : [failure];
  });
}

function aliasPaths(): Record<string, string[]> {
  const paths: Record<string, string[]> = {};
  for (const alias of gwenSourceAliases()) {
    const spec = alias.find.source.replace(/^\^/, "").replace(/\$$/, "").replace(/\\(.)/g, "$1");
    paths[spec] = [path.relative(repoRoot, alias.replacement)];
  }
  return paths;
}
