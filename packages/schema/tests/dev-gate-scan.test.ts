import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

/** Exact guard emitted by the package lib build. The only whitelisted NODE_ENV read. */
const GWEN_DEV_GUARD =
  '(typeof __GWEN_DEV__ !== "undefined" ? __GWEN_DEV__ : (globalThis.process?.env?.NODE_ENV !== "production"))';

function unwrap(node: ts.Node): ts.Node {
  let current = node;
  while (ts.isParenthesizedExpression(current)) current = current.expression;
  return current;
}

function propertyName(name: ts.PropertyName | ts.BindingName | undefined): string | undefined {
  if (!name) return undefined;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name))
    return name.text;
  return undefined;
}

function isGuardText(node: ts.Node): boolean {
  const text = node.getText();
  return text === GWEN_DEV_GUARD || text === GWEN_DEV_GUARD.slice(1, -1);
}

function insideFunction(node: ts.Node): boolean {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (
      ts.isFunctionDeclaration(current) ||
      ts.isFunctionExpression(current) ||
      ts.isArrowFunction(current) ||
      ts.isMethodDeclaration(current) ||
      ts.isConstructorDeclaration(current) ||
      ts.isGetAccessorDeclaration(current) ||
      ts.isSetAccessorDeclaration(current)
    ) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

function isDeclarationName(ident: ts.Identifier): boolean {
  const parent = ident.parent;
  if (ts.isVariableDeclaration(parent) && parent.name === ident) return true;
  if (ts.isBindingElement(parent) && parent.name === ident) return true;
  if (ts.isFunctionDeclaration(parent) && parent.name === ident) return true;
  if (ts.isParameter(parent) && parent.name === ident) return true;
  if (ts.isPropertyAssignment(parent) && parent.name === ident) return true;
  if (ts.isPropertyDeclaration(parent) && parent.name === ident) return true;
  if (ts.isMethodDeclaration(parent) && parent.name === ident) return true;
  if (ts.isPropertyAccessExpression(parent) && parent.name === ident) return true;
  return false;
}

function isFlag(node: ts.Node): boolean {
  const expr = unwrap(node);
  return ts.isIdentifier(expr) && expr.text === "__GWEN_DEV__";
}

function isDebugAccess(node: ts.Node): boolean {
  const expr = unwrap(node);
  return ts.isPropertyAccessExpression(expr) && expr.name.text === "debug";
}

function isAllowedFlagUse(ident: ts.Identifier): boolean {
  let parent: ts.Node = ident.parent;
  while (ts.isParenthesizedExpression(parent)) parent = parent.parent;

  if (ts.isIfStatement(parent) && isFlag(parent.expression)) return true;

  if (
    ts.isBinaryExpression(parent) &&
    parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
    isFlag(parent.left) &&
    isDebugAccess(parent.right)
  ) {
    let owner: ts.Node = parent.parent;
    while (ts.isParenthesizedExpression(owner)) owner = owner.parent;
    if (ts.isIfStatement(owner) && unwrap(owner.expression) === parent) return true;
    if (
      ts.isVariableDeclaration(owner) &&
      owner.initializer &&
      unwrap(owner.initializer) === parent
    ) {
      return true;
    }
    return false;
  }

  if (ts.isConditionalExpression(parent) && isFlag(parent.condition)) return true;
  return false;
}

function isEnvReceiver(expr: ts.Expression): boolean {
  const value = unwrap(expr);
  if (ts.isPropertyAccessExpression(value) && value.name.text === "env") return true;
  if (ts.isElementAccessExpression(value)) {
    const arg = value.argumentExpression;
    if (!arg) return false;
    const text = arg.getText().replace(/['"]/g, "");
    return text === "env";
  }
  return false;
}

function isNodeEnvRead(node: ts.Node): boolean {
  if (ts.isPropertyAccessExpression(node) && node.name.text === "NODE_ENV") {
    return isEnvReceiver(node.expression);
  }
  if (ts.isElementAccessExpression(node)) {
    const arg = node.argumentExpression;
    if (!arg) return false;
    const text = arg.getText().replace(/['"]/g, "");
    return text === "NODE_ENV" && isEnvReceiver(node.expression);
  }
  return false;
}

function isImportMetaEnv(node: ts.Node): boolean {
  if (!ts.isMetaProperty(node) || node.keywordToken !== ts.SyntaxKind.ImportKeyword) return false;
  const parent = node.parent;
  if (!parent) return false;
  if (
    ts.isPropertyAccessExpression(parent) &&
    parent.expression === node &&
    parent.name.text === "env"
  ) {
    return true;
  }
  if (ts.isElementAccessExpression(parent) && parent.expression === node) {
    const arg = parent.argumentExpression;
    return !!arg && arg.getText().replace(/['"]/g, "") === "env";
  }
  return false;
}

function calleeName(expr: ts.Expression): string | undefined {
  const value = unwrap(expr);
  if (ts.isIdentifier(value)) return value.text;
  if (ts.isPropertyAccessExpression(value)) return value.name.text;
  return undefined;
}

function classExtendsGwenError(node: ts.ClassLikeDeclaration): boolean {
  for (const clause of node.heritageClauses ?? []) {
    for (const type of clause.types) {
      const expr = type.expression;
      if (calleeName(expr) === "GwenError") return true;
    }
  }
  return false;
}

function enclosingClass(node: ts.Node): ts.ClassLikeDeclaration | undefined {
  let current: ts.Node | undefined = node;
  while (current) {
    if (ts.isClassDeclaration(current) || ts.isClassExpression(current)) return current;
    current = current.parent;
  }
  return undefined;
}

function isGwenErrorConstruction(node: ts.Node): boolean {
  if (ts.isNewExpression(node)) return calleeName(node.expression) === "GwenError";
  if (!ts.isCallExpression(node)) return false;
  if (node.expression.kind === ts.SyntaxKind.SuperKeyword) {
    const cls = enclosingClass(node);
    return !!cls && classExtendsGwenError(cls);
  }
  return calleeName(node.expression) === "GwenError";
}

function hintIsTernary(init: ts.Expression): boolean {
  const expr = unwrap(init);
  if (!ts.isConditionalExpression(expr) || !isFlag(expr.condition)) return false;
  const alternate = unwrap(expr.whenFalse);
  return ts.isIdentifier(alternate) && alternate.text === "undefined";
}

function isNodeSide(filename: string): boolean {
  const normalized = filename.split("\\").join("/");
  if (normalized.startsWith("packages/vite/src/") || normalized.includes("/packages/vite/src/")) {
    return true;
  }
  return /(?:^|\/)(?:module|vite-plugin)\.ts$/.test(normalized);
}

/** Node-side code may read NODE_ENV. It must not read the runtime flag. */
function scanNodeSideFlag(code: string, filename: string): string[] {
  const kind = filename.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(filename, code, ts.ScriptTarget.Latest, true, kind);
  const errors: string[] = [];
  const at = (node: ts.Node): string => {
    const pos = source.getLineAndCharacterOfPosition(node.getStart(source));
    return `${filename}:${pos.line + 1}`;
  };
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node.text === "__GWEN_DEV__" && !isDeclarationName(node)) {
      errors.push(`${at(node)} __GWEN_DEV__ in Node-side code`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return errors;
}

export function scanSource(code: string, filename: string): string[] {
  if (isNodeSide(filename)) return scanNodeSideFlag(code, filename);
  const kind = filename.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(filename, code, ts.ScriptTarget.Latest, true, kind);
  const errors: string[] = [];
  const debugCounts = new Map<string, number>();

  const at = (node: ts.Node): string => {
    const pos = source.getLineAndCharacterOfPosition(node.getStart(source));
    return `${filename}:${pos.line + 1}`;
  };

  const countDebug = (fn: ts.Node, label: string): void => {
    let count = 0;
    const walk = (node: ts.Node): void => {
      if (ts.isPropertyAccessExpression(node) && node.name.text === "debug") count += 1;
      if (ts.isElementAccessExpression(node)) {
        const arg = node.argumentExpression;
        if (arg && arg.getText().replace(/['"]/g, "") === "debug") count += 1;
      }
      ts.forEachChild(node, walk);
    };
    ts.forEachChild(fn, walk);
    debugCounts.set(label, count);
  };

  const visit = (node: ts.Node): void => {
    if (isGuardText(node)) return;

    if (isImportMetaEnv(node)) errors.push(`${at(node)} import.meta.env`);
    if (isNodeEnvRead(node)) errors.push(`${at(node)} process.env.NODE_ENV`);

    if (ts.isIdentifier(node) && node.text === "__GWEN_DEV__" && !isDeclarationName(node)) {
      if (!insideFunction(node)) errors.push(`${at(node)} __GWEN_DEV__ at module top level`);
      else if (!isAllowedFlagUse(node))
        errors.push(`${at(node)} __GWEN_DEV__ outside an allowed form`);
    }

    if (
      ts.isPropertyAssignment(node) &&
      propertyName(node.name) === "hint" &&
      ts.isObjectLiteralExpression(node.parent) &&
      isGwenErrorConstruction(node.parent.parent)
    ) {
      if (!hintIsTernary(node.initializer)) {
        errors.push(`${at(node)} hint is not __GWEN_DEV__ ? … : undefined`);
      }
    }

    if (
      (ts.isMethodDeclaration(node) || ts.isFunctionDeclaration(node)) &&
      node.name &&
      ts.isIdentifier(node.name) &&
      node.name.text === "_runFrame"
    ) {
      countDebug(node, at(node));
    }

    ts.forEachChild(node, visit);
  };

  visit(source);
  for (const [where, count] of debugCounts) {
    if (count > 1) errors.push(`${where} has ${count} debug reads in _runFrame`);
  }
  return errors;
}

function hasDevDefine(code: string, filename: string): boolean {
  const source = ts.createSourceFile(
    filename,
    code,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  let found = false;
  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAssignment(node) &&
      propertyName(node.name) === "define" &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      for (const prop of node.initializer.properties) {
        if (propertyName(prop.name) === "__GWEN_DEV__") found = true;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function walkSrc(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist") continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === "__tests__") continue;
      walkSrc(full, out);
      continue;
    }
    if (!/\.tsx?$/.test(entry) || entry.endsWith(".d.ts")) continue;
    if (/\.(test|spec)\.tsx?$/.test(entry)) continue;
    out.push(full);
  }
}

describe("dev gate scan", () => {
  it("accepts the lib guard and rejects a bare NODE_ENV read", () => {
    const guarded = `export function read() { if (${GWEN_DEV_GUARD}) return 1; return 0; }`;
    expect(scanSource(guarded, "guard.ts")).toEqual([]);
    const bare = `export function read() { return process.env.NODE_ENV; }`;
    expect(scanSource(bare, "bare.ts").some((item) => item.includes("NODE_ENV"))).toBe(true);
  });

  it("scans runtime sources and vitest defines", () => {
    const files: string[] = [];
    const packages = join(repoRoot, "packages");
    for (const entry of readdirSync(packages)) {
      const src = join(packages, entry, "src");
      try {
        if (statSync(src).isDirectory()) walkSrc(src, files);
      } catch {
        // package without src
      }
    }
    const errors: string[] = [];
    for (const file of files) {
      const code = readFileSync(file, "utf8");
      for (const error of scanSource(code, relative(repoRoot, file))) errors.push(error);
    }

    const configs = [
      ...readdirSync(packages).flatMap((entry) => {
        const config = join(packages, entry, "vitest.config.ts");
        try {
          return statSync(config).isFile() ? [config] : [];
        } catch {
          return [];
        }
      }),
      join(packages, "core", "vitest.wasm.config.ts"),
    ];
    for (const config of configs) {
      const code = readFileSync(config, "utf8");
      if (!hasDevDefine(code, config))
        errors.push(`${relative(repoRoot, config)} missing __GWEN_DEV__ define`);
    }

    expect(errors).toEqual([]);
  });

  it("rejects import.meta.env", () => {
    const code = `export function read() { return import.meta.env.DEV; }`;
    expect(scanSource(code, "meta.ts").some((item) => item.includes("import.meta.env"))).toBe(true);
  });

  it("rejects __GWEN_DEV__ at module top level", () => {
    const code = `export const flag = __GWEN_DEV__;`;
    expect(scanSource(code, "top.ts").some((item) => item.includes("top level"))).toBe(true);
  });

  it("rejects a __GWEN_DEV__ use outside the allowed forms", () => {
    const code = `export function read() { return __GWEN_DEV__ || false; }`;
    expect(scanSource(code, "form.ts").some((item) => item.includes("allowed form"))).toBe(true);
  });

  it("rejects a hint that is not a __GWEN_DEV__ ternary", () => {
    const code = `new GwenError("X", "m", { hint: "always" });`;
    expect(scanSource(code, "hint.ts").some((item) => item.includes("hint"))).toBe(true);
  });

  it("rejects more than one debug read in _runFrame", () => {
    const code = `function _runFrame() { if (this.debug) {} if (this.debug) {} }`;
    expect(scanSource(code, "frame.ts").some((item) => item.includes("debug reads"))).toBe(true);
  });

  it("rejects a vitest config without the __GWEN_DEV__ define", () => {
    expect(hasDevDefine("export default { test: {} }", "vitest.config.ts")).toBe(false);
    expect(
      hasDevDefine('export default { define: { __GWEN_DEV__: "false" } }', "vitest.config.ts"),
    ).toBe(true);
  });

  it("allows NODE_ENV in Node-side files and rejects __GWEN_DEV__ there", () => {
    const env = `export function read() { return process.env["NODE_ENV"]; }`;
    expect(scanSource(env, "packages/vite/src/plugins/tween.ts")).toEqual([]);
    const flag = `export function read() { if (__GWEN_DEV__) return 1; return 0; }`;
    expect(
      scanSource(flag, "packages/vite/src/plugins/tween.ts").some((item) =>
        item.includes("Node-side"),
      ),
    ).toBe(true);
    expect(scanSource(flag, "packages/physics3d/src/module.ts").length).toBeGreaterThan(0);
  });
});
