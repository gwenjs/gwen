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
const ENGINE_TEXT = 'declare const engine: import("@gwenjs/core").GwenEngine;\n';

/**
 * Type-check one tagged fence. Untagged fences are skipped.
 * `run` fences see the pre-bound `engine`. Nothing else is declared.
 */
export function checkFence(fence: Fence): SnippetFailure | null {
  return typecheck(fence).failure;
}

function typecheck(fence: Fence): { failure: SnippetFailure | null; program?: ts.Program } {
  if (fence.tag !== "check" && fence.tag !== "run") return { failure: null };
  const sourceText = `${fence.code}\n`;
  const snippetName = path.join(packageRoot, "__docs_snippet__.ts");
  const engineName = path.join(packageRoot, "__docs_engine__.d.ts");
  const options = compilerOptions();
  const host = ts.createCompilerHost(options, true);
  const read = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
    const resolved = path.resolve(fileName);
    if (resolved === snippetName) {
      return ts.createSourceFile(fileName, sourceText, languageVersion, true, ts.ScriptKind.TS);
    }
    if (resolved === engineName) {
      return ts.createSourceFile(fileName, ENGINE_TEXT, languageVersion, true, ts.ScriptKind.TS);
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

/**
 * Type-check every tagged fence in one program.
 * Fences from the same file share that program instead of one program each.
 * `export {}` keeps each fence in its own module, so script-shaped examples
 * do not collide. A `run` fence gets `engine` on its first line.
 */
export function checkFences(fences: Fence[]): SnippetFailure[] {
  const tagged = fences.filter((fence) => fence.tag === "check" || fence.tag === "run");
  if (tagged.length === 0) return [];

  const entries = tagged.map((fence, index) => {
    const fileName = path.join(packageRoot, `__docs_snippet_${index}.ts`);
    const preamble = fence.tag === "run" ? ENGINE_TEXT : "";
    return {
      fence,
      fileName,
      text: `${preamble}${fence.code}\nexport {};\n`,
      preambleLines: preamble === "" ? 0 : 1,
    };
  });
  const byName = new Map(entries.map((entry) => [path.resolve(entry.fileName), entry]));
  const options = compilerOptions();
  const host = ts.createCompilerHost(options, true);
  const read = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
    const hit = byName.get(path.resolve(fileName));
    if (hit) {
      return ts.createSourceFile(fileName, hit.text, languageVersion, true, ts.ScriptKind.TS);
    }
    return read(fileName, languageVersion, onError, shouldCreateNewSourceFile);
  };
  const exists = host.fileExists.bind(host);
  host.fileExists = (fileName) => byName.has(path.resolve(fileName)) || exists(fileName);

  const program = ts.createProgram(
    entries.map((entry) => entry.fileName),
    options,
    host,
  );
  const seen = new Set<string>();
  const failures: SnippetFailure[] = [];
  for (const diagnostic of ts.getPreEmitDiagnostics(program)) {
    const name = diagnostic.file?.fileName;
    if (name === undefined) continue;
    const hit = byName.get(path.resolve(name));
    if (!hit || seen.has(hit.fileName)) continue;
    seen.add(hit.fileName);
    const start = diagnostic.start ?? 0;
    const position = diagnostic.file?.getLineAndCharacterOfPosition(start);
    const tscLine = (position?.line ?? 0) + 1;
    const line = hit.fence.line + tscLine - hit.preambleLines;
    const text = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
    failures.push({ file: hit.fence.file, line, message: `${hit.fence.file}:${line} ${text}` });
  }
  return failures;
}

function compilerOptions(): ts.CompilerOptions {
  return {
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
}

function aliasPaths(): Record<string, string[]> {
  const paths: Record<string, string[]> = {};
  for (const alias of gwenSourceAliases()) {
    const spec = alias.find.source.replace(/^\^/, "").replace(/\$$/, "").replace(/\\(.)/g, "$1");
    paths[spec] = [path.relative(repoRoot, alias.replacement)];
  }
  return paths;
}
