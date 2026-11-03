import path from "node:path";
import ts from "typescript";
import { ConformanceErrorCodes } from "./error-codes.js";
import { isRecord } from "./json.js";
import type { PackageContext } from "./package-context.js";
import {
  isStringLiteralLike,
  lineOf,
  listTestFiles,
  parseSource,
  readDirectory,
  readSourceText,
} from "./source-files.js";
import type { SourceFile } from "./source-files.js";
import type { ConformanceFinding } from "./types.js";

const MOCK_METHODS: ReadonlySet<string> = new Set(["mock", "doMock"]);
const CONFIG_FILE = /^(vitest|vite)\.config(\.[\w-]+)*\.(ts|mts|cts|js|mjs|cjs)$/;
/** Leading specifier characters of a regular expression body; `\/` and `\.` are escaped ones. */
const REGEX_SPECIFIER = /^(?:[@\w/-]|\\[./-])*/;

function packageName(manifest: unknown): string {
  return isRecord(manifest) && typeof manifest.name === "string" ? manifest.name : "";
}

/** An `@gwenjs/…` specifier other than the package's own name and its subpaths. */
function isOtherGwenPackage(specifier: string, own: string): boolean {
  if (!specifier.startsWith("@gwenjs/")) return false;
  return own === "" || (specifier !== own && !specifier.startsWith(`${own}/`));
}

/**
 * The name, as a node, of a property written in a way that reads statically: an identifier, a
 * string, or a computed string (`["@gwenjs/kit"]`).
 */
function staticName(name: ts.PropertyName): ts.Identifier | ts.StringLiteralLike | undefined {
  if (ts.isIdentifier(name) || isStringLiteralLike(name)) return name;
  if (ts.isComputedPropertyName(name) && isStringLiteralLike(name.expression)) {
    return name.expression;
  }
  return undefined;
}

function hasName(name: ts.PropertyName, expected: string): boolean {
  return staticName(name)?.text === expected;
}

/** The `@gwenjs/…` text of a regular expression literal: `^`, then the specifier it starts with. */
function regexSpecifier(literal: string): string {
  const body = literal.slice(1, literal.lastIndexOf("/")).replace(/^\^/, "");
  return (REGEX_SPECIFIER.exec(body)?.[0] ?? "").replace(/\\(.)/g, "$1");
}

/** The `@gwenjs/…` text of an alias key, a string or a regular expression literal. */
function aliasSpecifier(node: ts.Node, own: string): string | undefined {
  if (isStringLiteralLike(node)) {
    return isOtherGwenPackage(node.text, own) ? node.text : undefined;
  }
  if (ts.isRegularExpressionLiteral(node)) {
    return isOtherGwenPackage(regexSpecifier(node.text), own) ? node.text : undefined;
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
  "Use the real package. To get an engine, boot one with createRealEngine from @gwenjs/core/testing.";

/** `vi`, and every local name that `import { vi as … } from "vitest"` binds to it. */
function viNames(source: ts.SourceFile): ReadonlySet<string> {
  const names = new Set(["vi"]);
  for (const statement of source.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !isStringLiteralLike(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== "vitest"
    ) {
      continue;
    }
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      if ((element.propertyName ?? element.name).text === "vi") names.add(element.name.text);
    }
  }
  return names;
}

/** `mock` or `doMock` when `callee` is `vi.mock`, `vi.doMock` or `vi["mock"]` (or a renamed `vi`). */
function mockMethod(callee: ts.Expression, vi: ReadonlySet<string>): string | undefined {
  let method: string | undefined;
  if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)) {
    if (vi.has(callee.expression.text)) method = callee.name.text;
  } else if (
    ts.isElementAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    isStringLiteralLike(callee.argumentExpression)
  ) {
    if (vi.has(callee.expression.text)) method = callee.argumentExpression.text;
  }
  return method !== undefined && MOCK_METHODS.has(method) ? method : undefined;
}

/** The specifier a mock names: a string, or the typed form `import("…")`. */
function mockTarget(argument: ts.Expression | undefined): string | undefined {
  if (argument === undefined) return undefined;
  if (isStringLiteralLike(argument)) return argument.text;
  if (ts.isCallExpression(argument) && argument.expression.kind === ts.SyntaxKind.ImportKeyword) {
    const [specifier] = argument.arguments;
    return specifier !== undefined && isStringLiteralLike(specifier) ? specifier.text : undefined;
  }
  return undefined;
}

function scanMocks(file: SourceFile, text: string, own: string): ConformanceFinding[] {
  const source = parseSource(file, text);
  const vi = viNames(source);
  const findings: ConformanceFinding[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const method = mockMethod(node.expression, vi);
      const target = method === undefined ? undefined : mockTarget(node.arguments[0]);
      if (method !== undefined && target !== undefined && isOtherGwenPackage(target, own)) {
        findings.push(
          mockFinding(
            file,
            lineOf(source, node),
            `vi.${method} replaces "${target}", an @gwenjs package`,
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

/**
 * Reports each `@gwenjs/…` key of an alias table: an object (keys, computed strings, and the
 * object literals or same-file `const` objects it spreads) or an array of `{ find }` entries.
 * `seen` stops a table that spreads itself.
 */
function scanAliasTable(
  source: ts.SourceFile,
  table: ts.Expression,
  report: (node: ts.Node, specifier: string) => void,
  own: string,
  seen: Set<ts.Expression>,
): void {
  if (seen.has(table)) return;
  seen.add(table);
  if (ts.isObjectLiteralExpression(table)) {
    for (const property of table.properties) {
      if (ts.isSpreadAssignment(property)) {
        const spread = ts.isIdentifier(property.expression)
          ? findLiteral(source, property.expression.text)
          : property.expression;
        if (spread !== undefined && ts.isObjectLiteralExpression(spread)) {
          scanAliasTable(source, spread, report, own, seen);
        }
        continue;
      }
      const key = property.name === undefined ? undefined : staticName(property.name);
      const text = key === undefined ? undefined : aliasSpecifier(key, own);
      if (key !== undefined && text !== undefined) report(key, text);
    }
  } else if (ts.isArrayLiteralExpression(table)) {
    for (const element of table.elements) {
      if (!ts.isObjectLiteralExpression(element)) continue;
      for (const property of element.properties) {
        if (ts.isPropertyAssignment(property) && hasName(property.name, "find")) {
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
        `alias for ${specifier} replaces an @gwenjs package`,
        MOCK_HINT,
      ),
    );
  };
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node) && hasName(node.name, "alias")) {
      const value = node.initializer;
      const table = ts.isIdentifier(value) ? findLiteral(source, value.text) : value;
      if (table !== undefined) scanAliasTable(source, table, report, own, new Set());
    } else if (ts.isShorthandPropertyAssignment(node) && node.name.text === "alias") {
      const table = findLiteral(source, "alias");
      if (table !== undefined) scanAliasTable(source, table, report, own, new Set());
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return findings;
}

async function listConfigFiles(root: string): Promise<readonly SourceFile[]> {
  const entries = await readDirectory(root);
  return entries
    .filter((entry) => entry.isFile() && CONFIG_FILE.test(entry.name))
    .map((entry) => ({
      relative: entry.name,
      full: path.join(root, entry.name),
    }))
    .sort((left, right) => (left.relative < right.relative ? -1 : 1));
}

/**
 * Mock rules: `mock` and `doMock` calls of `vi` on an `@gwenjs` package in a test file, and a
 * `resolve.alias` or `test.alias` key of `vitest.config.*` or `vite.config.*` that names one.
 * The package's own name is never reported.
 */
export async function checkTestMocks(
  context: PackageContext,
): Promise<readonly ConformanceFinding[]> {
  const own = packageName(context.manifest);
  const findings: ConformanceFinding[] = [];
  for (const file of await listTestFiles(context.root)) {
    const text = await readSourceText(file);
    if (text !== undefined) findings.push(...scanMocks(file, text, own));
  }
  for (const file of await listConfigFiles(context.root)) {
    const text = await readSourceText(file);
    if (text !== undefined) findings.push(...scanConfig(file, text, own));
  }
  return findings;
}
