/**
 * AST scan of the GWEN error grammar (P-64-1b).
 * `scanSource` is pure. Repo cases walk each package `src` tree.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { errorDocsAnchor } from "../src/errors.js";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export type RuleId = "R1" | "R2" | "R3" | "R4" | "R5" | "R7" | "R8" | "R9";
export interface Finding {
  rule: RuleId;
  file: string;
  line: number;
  message: string;
  hard?: boolean;
}
export interface CollectedCode {
  code: string;
  file: string;
  line: number;
}
export interface ScanHit {
  findings: Finding[];
  codes: CollectedCode[];
}
type CountMap = Record<string, number>;
const RAW_BUILTINS = new Set(["Error", "TypeError", "RangeError"]);
/** Longer prefixes first so `RENDERER_THREE` is not eaten by `RENDERER`. */
const CODE_VALUE =
  /^(RENDERER_THREE|PHYSICS2D|PHYSICS3D|CONFORMANCE|INSPECTOR|RENDERER|CAMERA|SCHEMA|ASSETS|AUDIO|CORE|KIT|APP|VITE|MATH):[A-Z][A-Z0-9_]*$/;
const LOOSE_CODE = /^[A-Z][A-Z0-9_]*:[A-Z][A-Z0-9_]*$/;
const CODE_IN_WHAT = /[A-Z0-9]+:[A-Z][A-Z0-9_]{2,}/;
const R4_SNIPPETS = ["Fix:", "See ", "http://", "https://", "\n"];
/** A trailing `()` is rejected: `renderGwenMessage` appends `()` itself. */
const COMPOSABLE_SHAPE =
  /^[A-Za-z][A-Za-z0-9]*(\(\)\.[A-Za-z][A-Za-z0-9]*|\.[A-Za-z][A-Za-z0-9]*)*$/;
const FRAMEWORK_PREFIX = new Set(
  "CORE,SCHEMA,KIT,APP,VITE,MATH,PHYSICS2D,PHYSICS3D,RENDERER,CAMERA,CONFORMANCE".split(","),
);
const PLUGIN_PREFIX = new Set(["AUDIO", "ASSETS", "RENDERER_THREE", "INSPECTOR"]);
const R1_EXEMPT_FILE = "packages/schema/src/errors.ts";
const MATH_ERROR_FILE = "packages/math/src/errors.ts";
const R5_EXEMPT_FILE = "packages/schema/src/errors.ts";
const USE_ENGINE_FILE = "packages/core/src/engine/context.ts";
const SKIP_DIRS = new Set(["node_modules", "dist", "__tests__"]);
/** D-64-d: private `packages/docs-check` keeps R1 only. */
function docsCheckExempt(file: string): boolean {
  return file.startsWith("packages/docs-check/");
}
function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(entry)) found.push(...sourceFiles(full));
      continue;
    }
    if (
      full.endsWith(".ts") &&
      !full.endsWith(".test.ts") &&
      full.includes(`${path.sep}src${path.sep}`)
    ) {
      found.push(full);
    }
  }
  return found;
}
export function packageSources(): string[] {
  return sourceFiles(path.join(repoRoot, "packages"));
}
function repoPath(full: string): string {
  return path.relative(repoRoot, full).split(path.sep).join("/");
}
function lineOf(sourceFile: ts.SourceFile, node: ts.Node): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}
function isClassLike(node: ts.Node): node is ts.ClassLikeDeclaration {
  return ts.isClassDeclaration(node) || ts.isClassExpression(node);
}
function isTypeWrapper(
  node: ts.Node,
): node is
  | ts.ParenthesizedExpression
  | ts.AsExpression
  | ts.SatisfiesExpression
  | ts.TypeAssertion {
  return (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isTypeAssertionExpression(node)
  );
}
function unwrap(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (isTypeWrapper(current) || ts.isNonNullExpression(current)) current = current.expression;
  return current;
}
/** The third argument is exactly `{}`, not a spread or a nested literal. */
function isEmptyOptionsLiteral(expression: ts.Expression): boolean {
  const value = unwrap(expression);
  return ts.isObjectLiteralExpression(value) && value.properties.length === 0;
}
function outermost(node: ts.Node): ts.Node {
  let cursor = node;
  while (cursor.parent && isTypeWrapper(cursor.parent)) cursor = cursor.parent;
  return cursor;
}
function identName(expression: ts.Expression): string | undefined {
  const value = unwrap(expression);
  return ts.isIdentifier(value) ? value.text : undefined;
}
function propertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name))
    return name.text;
  return undefined;
}
function heritageText(cls: ts.ClassLikeDeclaration, sourceFile: ts.SourceFile): string | undefined {
  for (const clause of cls.heritageClauses ?? []) {
    if (clause.token !== ts.SyntaxKind.ExtendsKeyword) continue;
    return clause.types[0]?.expression.getText(sourceFile);
  }
  return undefined;
}
/** Ends with `Error`, and is not the plain `Error` base (R1 owns that). */
function isNamedErrorSubclass(cls: ts.ClassLikeDeclaration, sourceFile: ts.SourceFile): boolean {
  const heritage = heritageText(cls, sourceFile);
  return heritage !== undefined && heritage.endsWith("Error") && heritage !== "Error";
}
function enclosingClass(node: ts.Node): ts.ClassLikeDeclaration | undefined {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (isClassLike(current)) return current;
    current = current.parent;
  }
  return undefined;
}
function isConstNamed(decl: ts.VariableDeclaration, suffix: string): boolean {
  if (!ts.isIdentifier(decl.name) || !decl.name.text.endsWith(suffix)) return false;
  const list = decl.parent;
  return ts.isVariableDeclarationList(list) && (list.flags & ts.NodeFlags.Const) !== 0;
}
function objectIsErrorCodesConst(obj: ts.ObjectLiteralExpression): boolean {
  const owner = outermost(obj);
  const parent = owner.parent;
  if (!parent || !ts.isVariableDeclaration(parent) || parent.initializer !== owner) return false;
  return isConstNamed(parent, "ErrorCodes");
}
function insideErrorCodes(node: ts.Node): boolean {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (ts.isObjectLiteralExpression(current) && objectIsErrorCodesConst(current)) return true;
    current = current.parent;
  }
  return false;
}
function isErrorCodesValue(node: ts.Node): boolean {
  const owner = outermost(node);
  const parent = owner.parent;
  return (
    !!parent &&
    ts.isPropertyAssignment(parent) &&
    parent.initializer === owner &&
    insideErrorCodes(node)
  );
}
function whatChunks(expression: ts.Expression): { text: string; node: ts.Node }[] | undefined {
  const value = unwrap(expression);
  if (ts.isStringLiteralLike(value)) return [{ text: value.text, node: value }];
  if (!ts.isTemplateExpression(value)) return undefined;
  const chunks = [{ text: value.head.text, node: value.head }];
  for (const span of value.templateSpans)
    chunks.push({ text: span.literal.text, node: span.literal });
  return chunks;
}
function endsOk(text: string): boolean {
  return text.endsWith(".") || text.endsWith("?") || text.endsWith(")");
}
function hasForbiddenSnippet(text: string): boolean {
  for (const snippet of R4_SNIPPETS) {
    if (text.includes(snippet)) return true;
  }
  return false;
}
function hasCodeInWhat(text: string): boolean {
  return CODE_IN_WHAT.test(text);
}
function textHasDocsHost(text: string): boolean {
  return text.includes("gwenengine.dev") || text.includes("docs.gwen.sh");
}
function isDocsUrlWrite(node: ts.Node): boolean {
  if (ts.isPropertyAssignment(node) && propertyName(node.name) === "docsUrl") return true;
  if (ts.isShorthandPropertyAssignment(node) && node.name.text === "docsUrl") return true;
  if (!ts.isBinaryExpression(node) || node.operatorToken.kind !== ts.SyntaxKind.EqualsToken)
    return false;
  const left = unwrap(node.left);
  return ts.isPropertyAccessExpression(left) && left.name.text === "docsUrl";
}
function isThrownCall(node: ts.CallExpression): boolean {
  let current: ts.Node = node;
  let parent: ts.Node | undefined = node.parent;
  while (parent && ts.isParenthesizedExpression(parent)) {
    current = parent;
    parent = parent.parent;
  }
  return !!parent && ts.isThrowStatement(parent) && parent.expression === current;
}
function hasNamespaceRow(page: string, prefix: string): boolean {
  const token = "`" + prefix + "`";
  for (const line of page.split("\n")) {
    if (line.startsWith("| ") && line.includes(token)) return true;
  }
  return false;
}

export function scanFile(text: string, file: string): ScanHit {
  const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const findings: Finding[] = [];
  const codes: CollectedCode[] = [];
  const add = (node: ts.Node, rule: RuleId, message: string, hard = false): void => {
    if (rule !== "R1" && docsCheckExempt(file)) return;
    const finding: Finding = { rule, file, line: lineOf(sourceFile, node), message };
    if (hard) finding.hard = true;
    findings.push(finding);
  };
  const recordCode = (node: ts.Node, code: string): void => {
    if (docsCheckExempt(file)) return;
    codes.push({ code, file, line: lineOf(sourceFile, node) });
  };
  const checkComposable = (name: string, node: ts.Node): void => {
    // Slice one leading "_" so the shape test does not also reject it. The ban is its own check.
    const shape = name.startsWith("_") ? name.slice(1) : name;
    if (name.startsWith("_")) {
      add(node, "R7", "leading underscore", true);
      return;
    }
    if (name === "useEngine" && file !== USE_ENGINE_FILE) {
      add(node, "R7", "useEngine", true);
      return;
    }
    if (!COMPOSABLE_SHAPE.test(shape)) add(node, "R7", "composable shape", true);
  };
  const checkWhat = (expression: ts.Expression, hard: boolean): void => {
    const chunks = whatChunks(expression);
    if (!chunks || chunks.length === 0) return;
    const head = chunks[0];
    if (!head) return;
    if (head.text.startsWith("[")) add(head.node, "R4", "what starts with a tag", hard);
    for (const chunk of chunks) {
      if (hasForbiddenSnippet(chunk.text))
        add(chunk.node, "R4", "what contains a forbidden snippet", hard);
      if (hasCodeInWhat(chunk.text)) add(chunk.node, "R4", "what contains a code", hard);
    }
    // A final `${...}` leaves an empty tail. That tail is not a missing `.`, `?`, or `)`.
    const tail = chunks[chunks.length - 1] ?? head;
    if (tail.text.length > 0 && !endsOk(tail.text)) {
      add(tail.node, "R4", "what must end with . ? or )", hard);
    }
  };
  const checkGwenCall = (call: ts.NewExpression | ts.CallExpression): void => {
    const args = call.arguments;
    const count = args?.length ?? 0;
    const first = args?.[0];
    if (first) {
      const opening = unwrap(first);
      if (ts.isStringLiteralLike(opening)) add(opening, "R2", "string literal code");
    }
    if (count >= 2 && args) {
      const second = args[1];
      if (second) checkWhat(second, true);
    }
    // An empty `{}` is the third argument itself. A spread inside a wider object is not.
    const third = count >= 3 && args ? args[2] : undefined;
    if (third && isEmptyOptionsLiteral(third)) add(third, "R9", "empty options object", true);
  };
  const checkClass = (cls: ts.ClassLikeDeclaration): void => {
    if (heritageText(cls, sourceFile) !== "Error") return;
    const className = ts.isClassDeclaration(cls) && cls.name ? cls.name.text : "";
    if (className === "GwenError" && file === R1_EXEMPT_FILE) return;
    if (className === "MathError" && file === MATH_ERROR_FILE) return;
    add(cls, "R1", "class extends Error", true);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isNewExpression(node) && RAW_BUILTINS.has(identName(node.expression) ?? "")) {
      add(node, "R1", "raw construct", true);
    }
    if (
      ts.isCallExpression(node) &&
      isThrownCall(node) &&
      RAW_BUILTINS.has(identName(node.expression) ?? "")
    ) {
      add(node, "R1", "raw throw", true);
    }
    if (isClassLike(node)) checkClass(node);
    if (ts.isNewExpression(node) && identName(node.expression) === "GwenError") checkGwenCall(node);
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.SuperKeyword) {
      const cls = enclosingClass(node);
      if (cls && isNamedErrorSubclass(cls, sourceFile)) checkGwenCall(node);
    }
    if (ts.isStringLiteralLike(node)) {
      if (isErrorCodesValue(node)) {
        recordCode(node, node.text);
        if (!CODE_VALUE.test(node.text)) add(node, "R2", "code prefix");
      } else if (LOOSE_CODE.test(node.text)) {
        add(node, "R2", "loose code literal");
      }
      if (textHasDocsHost(node.text)) add(node, "R5", "hard-coded docs host");
    }
    if (ts.isTemplateExpression(node)) {
      const parts = [node.head.text, ...node.templateSpans.map((span) => span.literal.text)];
      if (parts.some((part) => textHasDocsHost(part))) add(node, "R5", "hard-coded docs host");
    }
    if (isDocsUrlWrite(node) && file !== R5_EXEMPT_FILE && file !== MATH_ERROR_FILE) {
      add(node, "R5", "docsUrl write");
    }
    if (
      ts.isPropertyAssignment(node) &&
      propertyName(node.name) === "composable" &&
      node.initializer
    ) {
      const init = unwrap(node.initializer);
      if (ts.isStringLiteralLike(init)) checkComposable(init.text, init);
    }
    if (ts.isPropertyDeclaration(node)) {
      const name = propertyName(node.name);
      const cls = node.parent;
      if (
        (name === "hint" || name === "docsUrl") &&
        isClassLike(cls) &&
        isNamedErrorSubclass(cls, sourceFile)
      ) {
        add(node, "R8", "error class field");
      }
    }
    if (
      ts.isParameter(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "hint" &&
      ts.isConstructorDeclaration(node.parent)
    ) {
      const cls = node.parent.parent;
      if (isClassLike(cls) && isNamedErrorSubclass(cls, sourceFile))
        add(node, "R8", "hint parameter");
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { findings, codes };
}

export function scanSource(text: string, file: string): Finding[] {
  // Comments and JSDoc are not AST nodes, so the walk never reads them.
  return scanFile(text, file).findings;
}
export function collectCodes(text: string, file: string): CollectedCode[] {
  return scanFile(text, file).codes;
}

export function anchorFindings(codes: readonly CollectedCode[], en: string, fr: string): Finding[] {
  const missingAnchors: Finding[] = [];
  for (const entry of codes) {
    if (docsCheckExempt(entry.file)) continue;
    const index = entry.code.indexOf(":");
    if (index <= 0) continue;
    const prefix = entry.code.slice(0, index);
    if (FRAMEWORK_PREFIX.has(prefix)) {
      const anchor = `{#${errorDocsAnchor(entry.code)}}`;
      if (!en.includes(anchor) || !fr.includes(anchor)) {
        missingAnchors.push({
          rule: "R3",
          file: entry.file,
          line: entry.line,
          message: `missing anchor ${anchor}`,
        });
      }
      continue;
    }
    if (PLUGIN_PREFIX.has(prefix)) {
      if (!hasNamespaceRow(en, prefix) || !hasNamespaceRow(fr, prefix)) {
        missingAnchors.push({
          rule: "R3",
          file: entry.file,
          line: entry.line,
          message: `missing namespace row ${prefix}`,
        });
      }
    }
  }
  return missingAnchors;
}
export function tally(findings: readonly Finding[], rule: RuleId): CountMap {
  const map: CountMap = {};
  for (const finding of findings) {
    if (finding.rule !== rule) continue;
    map[finding.file] = (map[finding.file] ?? 0) + 1;
  }
  const sorted: CountMap = {};
  for (const key of Object.keys(map).sort()) {
    const count = map[key];
    if (count !== undefined) sorted[key] = count;
  }
  return sorted;
}
let repoCache: ScanHit | undefined;
function repoScan(): ScanHit {
  if (repoCache) return repoCache;
  const findings: Finding[] = [];
  const codes: CollectedCode[] = [];
  for (const full of packageSources()) {
    const hit = scanFile(readFileSync(full, "utf8"), repoPath(full));
    findings.push(...hit.findings);
    codes.push(...hit.codes);
  }
  repoCache = { findings, codes };
  return repoCache;
}
function linesOf(text: string, file: string, rule: RuleId): number[] {
  return scanSource(text, file)
    .filter((finding) => finding.rule === rule)
    .map((finding) => finding.line);
}
function expectLines(
  text: string,
  rule: RuleId,
  lines: readonly number[],
  file = "fixture.ts",
): void {
  expect(linesOf(text, file, rule)).toEqual(lines);
}
function located(rule: RuleId): string[] {
  return repoScan()
    .findings.filter((finding) => finding.rule === rule)
    .map((finding) => `${finding.file}:${finding.line}`);
}

describe("package throws", () => {
  it("throws GwenError instead of Error, TypeError, or RangeError", () => {
    expect(located("R1")).toEqual([]);
  });
  it("every codes value has an allowed prefix", () => {
    expect(tally(repoScan().findings, "R2")).toEqual({});
  });
  it("every code has an anchor in docs/api/errors.md", () => {
    const enPage = readFileSync(path.join(repoRoot, "docs/api/errors.md"), "utf8");
    const frPage = readFileSync(path.join(repoRoot, "docs/fr/api/errors.md"), "utf8");
    expect(tally(anchorFindings(repoScan().codes, enPage, frPage), "R3")).toEqual({});
  });

  it("WASM_GLUE_MISMATCH is anchored in docs/api/errors.md", () => {
    const enPage = readFileSync(path.join(repoRoot, "docs/api/errors.md"), "utf8");
    const frPage = readFileSync(path.join(repoRoot, "docs/fr/api/errors.md"), "utf8");
    expect(enPage).toContain("{#core-wasm-glue-mismatch}");
    expect(frPage).toContain("{#core-wasm-glue-mismatch}");
  });
  it("no message carries a tag, fix, URL or code", () => {
    const { findings } = repoScan();
    expect(tally(findings, "R4")).toEqual({});
  });
  it("no hard-coded docs URL", () => {
    expect(tally(repoScan().findings, "R5")).toEqual({});
  });
  it("every rule finds nothing in packages src", () => {
    const known = path.join(repoRoot, "packages/schema/tests/no-raw-throw.known.json");
    expect(existsSync(known)).toBe(false);
    const enPage = readFileSync(path.join(repoRoot, "docs/api/errors.md"), "utf8");
    const frPage = readFileSync(path.join(repoRoot, "docs/fr/api/errors.md"), "utf8");
    const { findings, codes } = repoScan();
    const all = [...findings, ...anchorFindings(codes, enPage, frPage)];
    const rules = ["R1", "R2", "R3", "R4", "R5", "R7", "R8", "R9"] as const;
    for (const rule of rules) expect(tally(all, rule), rule).toEqual({});
  });
  it("composable names are public names", () => {
    expect(located("R7")).toEqual([]);
  });
  it("no error class declares its own hint or docsUrl", () => {
    expect(tally(repoScan().findings, "R8")).toEqual({});
  });
});

describe("scanSource fixtures", () => {
  it("flags new Error, throw Error and a class extending Error", () => {
    const text = [
      'new Error("x");',
      'throw Error("y");',
      "class Boom extends Error {}",
      'class Ok extends GwenError { constructor() { super(codes.X, "Fine.", {}); } }',
    ].join("\n");
    expectLines(text, "R1", [1, 2, 3]);
  });
  it("the MathError class and its docsUrl write pass R1 and R5 only in packages/math/src/errors.ts", () => {
    const full = path.join(repoRoot, MATH_ERROR_FILE);
    expect(existsSync(full)).toBe(true);
    const text = readFileSync(full, "utf8");
    expect(linesOf(text, MATH_ERROR_FILE, "R1")).toEqual([]);
    expect(linesOf(text, MATH_ERROR_FILE, "R5")).toEqual([]);
    expect(linesOf(text, "packages/math/src/color.ts", "R1")).not.toEqual([]);
    expect(linesOf(text, "packages/math/src/color.ts", "R5")).not.toEqual([]);
  });
  it("flags a code outside the allowed prefixes", () => {
    const text = 'const DemoErrorCodes = { BAD: "NOPE:NOT_ALLOWED" } as const;\n';
    expectLines(text, "R2", [1]);
    expect(collectCodes(text, "fixture.ts").map((entry) => entry.code)).toEqual([
      "NOPE:NOT_ALLOWED",
    ]);
  });
  it("flags a loose code literal outside an ErrorCodes const", () => {
    expectLines('const CODE = "CORE:LOOSE_CODE";\n', "R2", [1]);
  });
  it("flags a string literal passed as the code", () => {
    expectLines('new GwenError("not-a-code", "Fine.");\n', "R2", [1]);
  });
  it("flags a framework code with no anchor in the page", () => {
    const codes: CollectedCode[] = [{ code: "SCHEMA:MISSING_ANCHOR", file: "fixture.ts", line: 3 }];
    const row = "| `SCHEMA` | schema |\n";
    const missing = anchorFindings(codes, row, row);
    expect(missing.map((finding) => finding.rule)).toEqual(["R3"]);
    expect(missing[0]?.line).toBe(3);
    const anchor = `{#${errorDocsAnchor("SCHEMA:MISSING_ANCHOR")}}`;
    expect(anchorFindings(codes, `${row}${anchor}\n`, `${row}${anchor}\n`)).toEqual([]);
    const plugin: CollectedCode[] = [{ code: "AUDIO:NO_CONTEXT", file: "plug.ts", line: 2 }];
    expect(anchorFindings(plugin, "no table\n", "no table\n").map((item) => item.line)).toEqual([
      2,
    ]);
    expect(anchorFindings(plugin, "| `AUDIO` | plugin |\n", "| `AUDIO` | plugin |\n")).toEqual([]);
  });
  it("flags a tag at the start of what", () => {
    expectLines('new GwenError(codes.X, "[GWEN] Fix: Boom.", {});\n', "R4", [1, 1]);
    const r4 = (text: string): Finding | undefined =>
      scanSource(text, "fixture.ts").find((item) => item.rule === "R4");
    expect(r4('new GwenError("CORE:X_Y", "[GWEN] x.", {});\n')?.hard).toBe(true);
    expect(r4('new GwenError("CORE:X_Y", "[GWEN] x.");\n')?.hard).toBe(true);
  });
  it("flags a code written in what", () => {
    expectLines('new GwenError(codes.X, "Failed with SCHEMA:INVALID_CONFIG.", {});\n', "R4", [1]);
  });
  it("flags a what without a final period", () => {
    expectLines('new GwenError(codes.X, "missing period");\n', "R4", [1]);
  });
  it("accepts a template what ending with a period", () => {
    const ended = "new GwenError(codes.X, `value ${n} is out of range.`, {});\n";
    const open = "new GwenError(codes.X, `${a} failed ${b}`, {});\n";
    expectLines(ended, "R4", []);
    expectLines(open, "R4", []);
  });
  it("ignores comments and JSDoc", () => {
    const text = [
      "/**",
      ' * new Error("x")',
      " * [GWEN] bad.",
      " * https://gwenengine.dev/x",
      " */",
      "const value = 1;",
      '// throw new Error("x") [GWEN] https://gwenengine.dev',
      '/* new RangeError("x") docs.gwen.sh */',
    ].join("\n");
    expect(scanSource(text, "fixture.ts")).toEqual([]);
  });
  it("flags a hard-coded docs URL and a docsUrl assignment", () => {
    const text = 'const url = "https://gwenengine.dev/x";\nconst row = { docsUrl: url };';
    expectLines(text, "R5", [1, 2]);
  });
  it("flags an empty options object and allows a composable option", () => {
    const empty = scanSource('new GwenError(C, "x.", {});\n', "fixture.ts").filter(
      (finding) => finding.rule === "R9",
    );
    expect(empty).toHaveLength(1);
    expect(empty[0]?.hard).toBe(true);
    expect(empty[0]?.line).toBe(1);
    const named = scanSource('new GwenError(C, "x.", { composable: "f" });\n', "fixture.ts");
    expect(named.filter((finding) => finding.rule === "R9")).toEqual([]);
    const spread = scanSource(
      'new GwenError(C, "x.", { composable: "f", ...{} });\n',
      "fixture.ts",
    );
    expect(spread.filter((finding) => finding.rule === "R9")).toEqual([]);
    const viaSuper = [
      "class Sub extends GwenError {",
      "  constructor() {",
      '    super(codes.X, "Fine.", {});',
      "  }",
      "}",
      'class Kept extends GwenError { constructor() { super(codes.X, "Fine."); } }',
    ].join("\n");
    const supers = scanSource(viaSuper, "fixture.ts").filter((finding) => finding.rule === "R9");
    expect(supers.map((finding) => finding.line)).toEqual([3]);
    expect(supers[0]?.hard).toBe(true);
  });
  it("flags an underscore composable", () => {
    const outside = 'const a = { composable: "_x" };\nconst b = { composable: "useEngine" };';
    expectLines(outside, "R7", [1, 2], "other.ts");
    expectLines('const b = { composable: "useEngine" };', "R7", [], USE_ENGINE_FILE);
  });
  it("flags a composable ending in ()", () => {
    const text = [
      'const a = { composable: "useTransform()" };',
      'const b = { composable: "useChildren().adopt" };',
      'const c = { composable: "engine.advance" };',
      'const d = { composable: "useTransform" };',
    ].join("\n");
    expectLines(text, "R7", [1]);
  });
  it("flags a readonly hint field on a GwenError subclass", () => {
    const text = [
      "class Mine extends GwenError {",
      '  readonly hint = "x";',
      '  docsUrl = "y";',
      '  constructor(hint: string) { super(codes.X, "Ok.", {}); }',
      "}",
    ].join("\n");
    expectLines(text, "R8", [2, 3, 4]);
  });
});
