import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

export interface SourceFile {
  /** Path from the package root, with `/` separators. */
  readonly relative: string;
  readonly full: string;
}

const SCRIPT_FILE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const DECLARATION_FILE = /\.d\.[mc]?ts$/;
const DIST_FILE = /\.([cm]?js|d\.[cm]?ts)$/;
const TEST_NAME = /\.(test|spec)\./;
const SETUP_NAME = /\.setup\./;
const TEST_DIRECTORIES: ReadonlySet<string> = new Set(["tests", "test", "__tests__"]);

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

/** Entries of `directory`. A missing directory is empty; any other error rejects. */
export async function readDirectory(directory: string): Promise<readonly Dirent[]> {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch (error) {
    const code = readErrorCode(error);
    if (code === "ENOENT" || code === "ENOTDIR") return [];
    throw error;
  }
}

function isSkippedDirectory(name: string): boolean {
  return name === "node_modules" || name === "dist" || name.startsWith(".");
}

/** Every file under `directory`, skipping `node_modules`, `dist` and dot directories. */
async function listFiles(directory: string): Promise<readonly string[]> {
  const files: string[] = [];
  for (const entry of await readDirectory(directory)) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!isSkippedDirectory(entry.name)) files.push(...(await listFiles(full)));
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
  return files;
}

function toRelative(root: string, full: string): string {
  return path.relative(root, full).split(path.sep).join("/");
}

/**
 * A test file is a script (not a declaration file) that is named `*.test.*` or `*.spec.*`, sits
 * below a `tests`, `test` or `__tests__` directory, or is a `*.setup.*` file at the package root.
 */
function isTestFile(relative: string): boolean {
  const segments = relative.split("/");
  const name = segments[segments.length - 1] ?? "";
  if (!SCRIPT_FILE.test(name) || DECLARATION_FILE.test(name)) return false;
  if (TEST_NAME.test(name)) return true;
  if (segments.slice(0, -1).some((directory) => TEST_DIRECTORIES.has(directory))) return true;
  return segments.length === 1 && SETUP_NAME.test(name);
}

/**
 * The test files of a package, in path order, wherever they sit (see {@link isTestFile}). A file
 * of `src` that is not a test file is not listed. `node_modules`, `dist` and dot directories are
 * not walked.
 */
export async function listTestFiles(root: string): Promise<readonly SourceFile[]> {
  return (await listFiles(root))
    .map((full) => ({ relative: toRelative(root, full), full }))
    .filter((file) => isTestFile(file.relative))
    .sort((left, right) => compareText(left.relative, right.relative));
}

/**
 * The script files of `src` (not `*.d.ts`), in path order, whether they are test files or not.
 * `node_modules`, `dist` and dot directories are not walked.
 */
export async function listRuntimeFiles(root: string): Promise<readonly SourceFile[]> {
  return (await listFiles(path.join(root, "src")))
    .map((full) => ({ relative: toRelative(root, full), full }))
    .filter((file) => SCRIPT_FILE.test(file.relative) && !DECLARATION_FILE.test(file.relative))
    .sort((left, right) => compareText(left.relative, right.relative));
}

/** The `.js`, `.mjs`, `.cjs`, `.d.ts`, `.d.mts` and `.d.cts` files under `dist`, in path order. */
export async function listDistFiles(root: string): Promise<readonly SourceFile[]> {
  return (await listFiles(path.join(root, "dist")))
    .map((full) => ({ relative: toRelative(root, full), full }))
    .filter((file) => DIST_FILE.test(file.relative))
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

/**
 * Text of the file at `full`, or `undefined` when it, or a directory above it, is missing. Any
 * other read error rejects.
 */
export async function readTextIfPresent(full: string): Promise<string | undefined> {
  try {
    return await readFile(full, "utf8");
  } catch (error) {
    const code = readErrorCode(error);
    if (code === "ENOENT" || code === "ENOTDIR") return undefined;
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
