import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

/** `src` files ship in the package. `test` files are test code and may import test-only entries. */
export type SourceScope = "src" | "test";

export interface SourceFile {
  /** Path from the package root, with `/` separators. */
  readonly relative: string;
  readonly full: string;
  readonly scope: SourceScope;
}

const SOURCE_FILE = /\.(ts|tsx|mts|cts)$/;
const TEST_FILE = /\.test\./;

function readErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const code = error.code;
  return typeof code === "string" ? code : undefined;
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/** Every file under `directory` that `accept` takes, skipping `node_modules`. Missing means empty. */
async function listFiles(
  directory: string,
  accept: (name: string) => boolean,
): Promise<readonly string[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    // A missing or unreadable directory holds no source.
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") files.push(...(await listFiles(full, accept)));
    } else if (entry.isFile() && accept(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

function isSourceName(name: string): boolean {
  return SOURCE_FILE.test(name) && !name.endsWith(".d.ts");
}

function toRelative(root: string, full: string): string {
  return path.relative(root, full).split(path.sep).join("/");
}

function scopeOf(relative: string): SourceScope {
  const first = relative.split("/")[0];
  return first === "tests" || first === "test" || TEST_FILE.test(path.posix.basename(relative))
    ? "test"
    : "src";
}

/**
 * The TypeScript files of a package, in path order: everything under `src`, `tests` and `test`
 * (not `*.d.ts`, not `node_modules`), and the `*.test.*` files at the root.
 */
export async function listSourceFiles(root: string): Promise<readonly SourceFile[]> {
  const rootEntries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const rootTests = rootEntries
    .filter((entry) => entry.isFile() && isSourceName(entry.name) && TEST_FILE.test(entry.name))
    .map((entry) => path.join(root, entry.name));
  const groups = await Promise.all([
    listFiles(path.join(root, "src"), isSourceName),
    listFiles(path.join(root, "tests"), isSourceName),
    listFiles(path.join(root, "test"), isSourceName),
  ]);
  const found = new Set([...rootTests, ...groups.flat()]);
  return [...found]
    .map((full) => {
      const relative = toRelative(root, full);
      return { relative, full, scope: scopeOf(relative) };
    })
    .sort((left, right) => compareText(left.relative, right.relative));
}

/**
 * Text of `file`, or `undefined` when it disappeared since the listing. Any other read error
 * rejects: a silent pass would hide a violation.
 */
export async function readSourceText(file: SourceFile): Promise<string | undefined> {
  try {
    return await readFile(file.full, "utf8");
  } catch (error) {
    if (readErrorCode(error) === "ENOENT") return undefined;
    throw error;
  }
}

export function parseSource(file: SourceFile, text: string): ts.SourceFile {
  return ts.createSourceFile(file.relative, text, ts.ScriptTarget.Latest, true);
}

/** 1-based line where `node` starts. */
export function lineOf(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

export function isStringLiteralLike(
  node: ts.Node,
): node is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
}
