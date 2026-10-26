import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

import { describe, expect, it } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const DECLARATION = path.join(REPO_ROOT, "packages/schema/src/runtime-hooks.ts");

const VIEWPORT_HOOKS = new Set(["viewport:add", "viewport:resize", "viewport:remove"]);
const FIRING_CALLEES = new Set(["callHook", "callHookWith", "_callHook", "emit"]);
const HOOK_NAME = /^[a-z][A-Za-z0-9-]*:[A-Za-z0-9:-]+$/;

interface HookSourceFile {
  readonly path: string;
  readonly text: string;
}

function isIgnoredSource(filePath: string): boolean {
  const norm = filePath.replaceAll("\\", "/");
  if (norm.includes("/__tests__/")) return true;
  const base = norm.slice(norm.lastIndexOf("/") + 1);
  return base.endsWith(".test.ts") || base.endsWith(".spec.ts");
}

function propertyNameText(name: ts.PropertyName): string | undefined {
  if (ts.isStringLiteral(name) || ts.isNumericLiteral(name) || ts.isIdentifier(name)) {
    return name.text;
  }
  return undefined;
}

function calleeName(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) {
    const name = expression.name.text;
    if (name === "emit") return undefined;
    return name;
  }
  return undefined;
}

function isFunctionLike(node: ts.Node): boolean {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  );
}

function functionName(node: ts.Node): string | undefined {
  if (
    (ts.isFunctionDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isFunctionExpression(node)) &&
    node.name !== undefined &&
    ts.isIdentifier(node.name)
  ) {
    return node.name.text;
  }
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) return node.name.text;
  return undefined;
}

/** A function that passes an identifier into callHook is a firing wrapper. */
function forwardingWrappers(source: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  const consider = (body: ts.Node, name: string | undefined): void => {
    if (name === undefined) return;
    let forwards = false;
    const visit = (child: ts.Node): void => {
      if (forwards || isFunctionLike(child)) return;
      if (ts.isCallExpression(child) && child.arguments.some((arg) => ts.isIdentifier(arg))) {
        const called = calleeName(child.expression);
        if (called === "callHook" || called === "callHookWith" || called === "_callHook") {
          forwards = true;
          return;
        }
      }
      ts.forEachChild(child, visit);
    };
    ts.forEachChild(body, visit);
    if (forwards) names.add(name);
  };
  const walk = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer !== undefined &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ) {
      consider(node.initializer, functionName(node));
    } else if (isFunctionLike(node)) {
      consider(node, functionName(node));
    }
    ts.forEachChild(node, walk);
  };
  walk(source);
  return names;
}

function addHookName(names: string[], seen: Set<string>, name: string): void {
  if (!HOOK_NAME.test(name) || seen.has(name)) return;
  seen.add(name);
  names.push(name);
}

function declaredHookNames(text: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  const source = ts.createSourceFile(
    "runtime-hooks.ts",
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertySignature(node) ||
      ts.isMethodSignature(node) ||
      ts.isPropertyAssignment(node) ||
      ts.isPropertyDeclaration(node)
    ) {
      const name = propertyNameText(node.name);
      if (name !== undefined) addHookName(names, seen, name);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, text);
  let token = scanner.scan();
  while (token !== ts.SyntaxKind.EndOfFileToken) {
    if (token === ts.SyntaxKind.StringLiteral) {
      const value = scanner.getTokenValue();
      token = scanner.scan();
      if (token === ts.SyntaxKind.ColonToken) addHookName(names, seen, value);
      continue;
    }
    token = scanner.scan();
  }
  return names;
}

/** String arguments of a firing callee, or of a function that forwards to one. */
function firedNamesIn(fileName: string, text: string): Set<string> {
  const source = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const wrappers = forwardingWrappers(source);
  const found = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const name = calleeName(node.expression);
      if (name !== undefined && (FIRING_CALLEES.has(name) || wrappers.has(name))) {
        for (const arg of node.arguments) {
          if (ts.isStringLiteral(arg) && HOOK_NAME.test(arg.text)) found.add(arg.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function ownerMatches(hook: string, filePath: string): boolean {
  const norm = filePath.replaceAll("\\", "/");
  if (VIEWPORT_HOOKS.has(hook)) return norm.includes("packages/renderer-core/src/");
  return norm.includes("packages/core/src/");
}

/** Declared hook names with no firing site in the owner tree. */
function missingFiringSites(declarationText: string, sources: readonly HookSourceFile[]): string[] {
  const firedByFile = sources.map((source) => ({
    path: source.path,
    fired: isIgnoredSource(source.path)
      ? new Set<string>()
      : firedNamesIn(source.path, source.text),
  }));
  const missing: string[] = [];
  for (const name of declaredHookNames(declarationText)) {
    const found = firedByFile.some((file) => ownerMatches(name, file.path) && file.fired.has(name));
    if (!found) missing.push(name);
  }
  return missing;
}

/** Hook names the scanner treats as fired in these sources. */
function firedHookNames(sources: readonly HookSourceFile[]): string[] {
  const fired = new Set<string>();
  for (const source of sources) {
    if (isIgnoredSource(source.path)) continue;
    for (const name of firedNamesIn(source.path, source.text)) fired.add(name);
  }
  return [...fired].sort();
}

function walkSources(dir: string, out: HookSourceFile[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === "dist" || entry === "__tests__") continue;
    const full = path.join(dir, entry);
    let info;
    try {
      info = statSync(full);
    } catch {
      continue;
    }
    if (info.isDirectory()) {
      walkSources(full, out);
      continue;
    }
    if (!entry.endsWith(".ts") || entry.endsWith(".d.ts")) continue;
    if (entry.endsWith(".test.ts") || entry.endsWith(".spec.ts")) continue;
    out.push({ path: full, text: readFileSync(full, "utf8") });
  }
}

function loadSources(): HookSourceFile[] {
  const sources: HookSourceFile[] = [];
  walkSources(path.join(REPO_ROOT, "packages/core/src"), sources);
  walkSources(path.join(REPO_ROOT, "packages/renderer-core/src"), sources);
  return sources;
}

describe("declared core hooks", () => {
  const declaration = readFileSync(DECLARATION, "utf8");
  const sources = loadSources();

  it("every declared core hook has a firing site", () => {
    expect(missingFiringSites(declaration, sources)).toEqual([]);
  });

  it('reports a test-only declaration "engine:never"', () => {
    const synthetic = `${declaration}\n"engine:never": () => void;\n`;
    expect(missingFiringSites(synthetic, sources)).toEqual(["engine:never"]);
  });

  it("positive control entity:destroy is found", () => {
    expect(firedHookNames(sources)).toContain("entity:destroy");
    expect(missingFiringSites(declaration, sources)).toEqual([]);
  });

  it("ignores a test file and a property emit", () => {
    const declarationText = `"engine:never": () => void;\n`;
    const missed = missingFiringSites(declarationText, [
      {
        path: "/repo/packages/core/src/engine/__tests__/fake.test.ts",
        text: `hooks.callHook("engine:never");`,
      },
      {
        path: "/repo/packages/core/src/engine/sample.spec.ts",
        text: `hooks.callHook("engine:never");`,
      },
      {
        path: "/repo/packages/core/src/engine/sample.ts",
        text: 'const re = /\\(/;\nother.emit("engine:never");\n',
      },
    ]);
    expect(missed).toEqual(["engine:never"]);
  });
});
