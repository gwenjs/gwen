import { readdir } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { ConformanceErrorCodes } from "./error-codes.js";
import { isRecord } from "./json.js";
import type { PackageContext } from "./package-context.js";
import {
  isStringLiteralLike,
  lineOf,
  listSourceFiles,
  parseSource,
  readSourceText,
} from "./source-files.js";
import type { SourceFile } from "./source-files.js";
import type { ConformanceFinding } from "./types.js";

const MOCK_METHODS: ReadonlySet<string> = new Set(["mock", "doMock"]);
const CONFIG_FILE = /^(vitest|vite)\.config\.(ts|mts|cts|js|mjs|cjs)$/;
/** Source of a regular expression literal that starts at an `@gwenjs/` specifier. */
const FRAMEWORK_PATTERN = /^\^?@gwenjs(\\\/|\/)/;

function packageName(manifest: unknown): string {
  return isRecord(manifest) && typeof manifest.name === "string" ? manifest.name : "";
}

function isFrameworkSpecifier(specifier: string, own: string): boolean {
  if (!specifier.startsWith("@gwenjs/")) return false;
  return own === "" || (specifier !== own && !specifier.startsWith(`${own}/`));
}

function propertyKey(name: ts.PropertyName): ts.StringLiteralLike | undefined {
  return ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name) ? name : undefined;
}

/** The `@gwenjs/…` text of an alias key, a string or a regular expression literal. */
function aliasSpecifier(node: ts.Node, own: string): string | undefined {
  if (isStringLiteralLike(node)) {
    return isFrameworkSpecifier(node.text, own) ? node.text : undefined;
  }
  if (ts.isRegularExpressionLiteral(node)) {
    const body = node.text.slice(1, node.text.lastIndexOf("/"));
    return FRAMEWORK_PATTERN.test(body) ? node.text : undefined;
  }
  return undefined;
}

function mockFinding(
  file: SourceFile,
  line: number,
  what: string,
  hint: string,
): ConformanceFinding {
  return {
    code: ConformanceErrorCodes.TEST_MOCKS_FRAMEWORK,
    message: what,
    hint,
    file: file.relative,
    line,
  };
}

const MOCK_HINT =
  "Test against the real framework: boot an engine with createRealEngine from @gwenjs/core/testing.";

function scanMocks(file: SourceFile, text: string, own: string): ConformanceFinding[] {
  const source = parseSource(file, text);
  const findings: ConformanceFinding[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "vi" &&
      MOCK_METHODS.has(node.expression.name.text)
    ) {
      const [target] = node.arguments;
      if (
        target !== undefined &&
        isStringLiteralLike(target) &&
        isFrameworkSpecifier(target.text, own)
      ) {
        findings.push(
          mockFinding(
            file,
            lineOf(source, node),
            `vi.${node.expression.name.text} replaces "${target.text}", a framework package`,
            MOCK_HINT,
          ),
        );
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return findings;
}

/** `const name = { … }` or `[ … ]` anywhere in `source`, so `alias` can name one. */
function findLiteral(source: ts.SourceFile, name: string): ts.Expression | undefined {
  let found: ts.Expression | undefined;
  const visit = (node: ts.Node): void => {
    if (
      found === undefined &&
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer !== undefined &&
      (ts.isObjectLiteralExpression(node.initializer) ||
        ts.isArrayLiteralExpression(node.initializer))
    ) {
      found = node.initializer;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function scanAliasTable(
  table: ts.Expression,
  report: (node: ts.Node, specifier: string) => void,
  own: string,
): void {
  if (ts.isObjectLiteralExpression(table)) {
    for (const property of table.properties) {
      const key = property.name === undefined ? undefined : propertyKey(property.name);
      const text = key === undefined ? undefined : aliasSpecifier(key, own);
      if (key !== undefined && text !== undefined) report(key, text);
    }
  } else if (ts.isArrayLiteralExpression(table)) {
    for (const element of table.elements) {
      if (!ts.isObjectLiteralExpression(element)) continue;
      for (const property of element.properties) {
        if (
          ts.isPropertyAssignment(property) &&
          ts.isIdentifier(property.name) &&
          property.name.text === "find"
        ) {
          const text = aliasSpecifier(property.initializer, own);
          if (text !== undefined) report(property.initializer, text);
        }
      }
    }
  }
}

function scanConfig(file: SourceFile, text: string, own: string): ConformanceFinding[] {
  const source = parseSource(file, text);
  const findings: ConformanceFinding[] = [];
  const report = (node: ts.Node, specifier: string): void => {
    findings.push(
      mockFinding(
        file,
        lineOf(source, node),
        `alias for ${specifier} replaces a framework package`,
        MOCK_HINT,
      ),
    );
  };
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === "alias") {
      const value = node.initializer;
      const table = ts.isIdentifier(value) ? findLiteral(source, value.text) : value;
      if (table !== undefined) scanAliasTable(table, report, own);
    } else if (ts.isShorthandPropertyAssignment(node) && node.name.text === "alias") {
      const table = findLiteral(source, "alias");
      if (table !== undefined) scanAliasTable(table, report, own);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return findings;
}

async function listConfigFiles(root: string): Promise<readonly SourceFile[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isFile() && CONFIG_FILE.test(entry.name))
    .map((entry) => ({
      relative: entry.name,
      full: path.join(root, entry.name),
      scope: "test" as const,
    }))
    .sort((left, right) => (left.relative < right.relative ? -1 : 1));
}

/**
 * Mock rules: `mock` and `doMock` calls of `vi` on a framework package in a test file, and a
 * `resolve.alias` or `test.alias` key of `vitest.config.*` or `vite.config.*` that names one.
 * The package's own name is never reported.
 */
export async function checkTestMocks(
  context: PackageContext,
): Promise<readonly ConformanceFinding[]> {
  const own = packageName(context.manifest);
  const findings: ConformanceFinding[] = [];
  const tests = (await listSourceFiles(context.root)).filter((file) => file.scope === "test");
  for (const file of tests) {
    const text = await readSourceText(file);
    if (text !== undefined) findings.push(...scanMocks(file, text, own));
  }
  for (const file of await listConfigFiles(context.root)) {
    const text = await readSourceText(file);
    if (text !== undefined) findings.push(...scanConfig(file, text, own));
  }
  return findings;
}
