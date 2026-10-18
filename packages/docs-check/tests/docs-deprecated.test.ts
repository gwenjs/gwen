import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

interface ExportedSymbol {
  readonly name: string;
  readonly node: ts.Node;
}

function parseJson(text: string): unknown {
  const value: unknown = JSON.parse(text);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFile(filePath: string): boolean {
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function isDirectory(filePath: string): boolean {
  try {
    return statSync(filePath).isDirectory();
  } catch {
    return false;
  }
}

function readJsonFile(filePath: string): unknown {
  return parseJson(readFileSync(filePath, "utf8"));
}

function packageDirs(): readonly string[] {
  const packagesDir = path.join(repoRoot, "packages");
  const dirs: string[] = [];
  for (const name of readdirSync(packagesDir).sort()) {
    const pkgDir = path.join(packagesDir, name);
    if (!isDirectory(pkgDir)) continue;
    if (!isFile(path.join(pkgDir, "public-api.snap.json"))) continue;
    dirs.push(pkgDir);
  }
  return dirs;
}

function readPackageName(pkgDir: string): string {
  const manifestPath = path.join(pkgDir, "package.json");
  const value = readJsonFile(manifestPath);
  if (!isRecord(value) || typeof value["name"] !== "string") {
    throw new Error(`Unreadable package name: ${manifestPath}`);
  }
  return value["name"];
}

function readExports(pkgDir: string): Record<string, unknown> {
  const manifestPath = path.join(pkgDir, "package.json");
  const value = readJsonFile(manifestPath);
  if (!isRecord(value) || !isRecord(value["exports"])) {
    throw new Error(`Unreadable package exports: ${manifestPath}`);
  }
  return value["exports"];
}

function typesTarget(value: unknown): string | null {
  if (typeof value === "string") return value.endsWith(".d.ts") ? value : null;
  if (!isRecord(value)) return null;
  const types = value["types"];
  if (typeof types === "string") return types;
  if (isRecord(types)) {
    const imported = types["import"];
    if (typeof imported === "string") return imported;
  }
  const imported = value["import"];
  if (typeof imported === "string" && imported.endsWith(".d.ts")) return imported;
  return null;
}

/** `./dist/X.d.ts` (and `./dist/X.js` re-exports) resolve next to `src/X.ts`. */
function sourceOf(pkgDir: string, typesRel: string | null): string | null {
  if (typesRel === null || typesRel.includes("/wasm/")) return null;
  const rel = typesRel
    .replace(/^\.\//, "")
    .replace(/^dist\//, "src/")
    .replace(/\.d\.ts$/, ".ts");
  const full = path.join(pkgDir, rel);
  return isFile(full) ? full : null;
}

function isPublicEntry(subpath: string): boolean {
  if (subpath === "./package.json" || subpath === "./internal") return false;
  if (subpath === "./wasm" || subpath.startsWith("./wasm/")) return false;
  return true;
}

function withoutJsExtension(filePath: string): string {
  if (filePath.endsWith(".d.ts")) return filePath.slice(0, -5);
  if (filePath.endsWith(".mjs") || filePath.endsWith(".cjs")) return filePath.slice(0, -4);
  if (filePath.endsWith(".js")) return filePath.slice(0, -3);
  return filePath;
}

function resolveRelative(fromFile: string, spec: string): string | null {
  const resolved = path.resolve(path.dirname(fromFile), spec);
  const base = withoutJsExtension(resolved);
  const candidates = [`${base}.ts`, path.join(base, "index.ts")];
  if (base === resolved) candidates.push(resolved);
  for (const candidate of candidates) {
    if (isFile(candidate)) return candidate;
  }
  return null;
}

function resolveModule(fromFile: string, spec: string): string | null {
  if (spec.startsWith(".")) return resolveRelative(fromFile, spec);
  const match = /^@gwenjs\/([^/]+)(.*)$/.exec(spec);
  if (match === null) return null;
  const pkg = match[1];
  const sub = match[2];
  if (pkg === undefined || sub === undefined) return null;
  const pkgDir = path.join(repoRoot, "packages", pkg);
  const relativeSub = sub.startsWith("/") ? sub.slice(1) : sub;
  const candidates =
    relativeSub.length === 0
      ? [path.join(pkgDir, "src/index.ts")]
      : [
          path.join(pkgDir, "src", `${withoutJsExtension(relativeSub)}.ts`),
          path.join(pkgDir, "src", withoutJsExtension(relativeSub), "index.ts"),
        ];
  for (const candidate of candidates) {
    if (isFile(candidate)) return candidate;
  }
  return null;
}

function isMember(node: ts.Node): boolean {
  const parent: ts.Node | undefined = node.parent;
  if (parent === undefined) return false;
  return (
    ts.isClassDeclaration(parent) ||
    ts.isInterfaceDeclaration(parent) ||
    ts.isTypeLiteralNode(parent) ||
    ts.isClassExpression(parent)
  );
}

function hasDeprecatedTag(node: ts.Node): boolean {
  return ts.getJSDocTags(node).some((tag) => tag.tagName.text === "deprecated");
}

function moduleExportText(name: ts.ModuleExportName): string {
  if (ts.isIdentifier(name)) return name.text;
  return name.text;
}

type ValueOrTypeDecl =
  | ts.FunctionDeclaration
  | ts.ClassDeclaration
  | ts.InterfaceDeclaration
  | ts.TypeAliasDeclaration
  | ts.EnumDeclaration;

function isValueOrTypeDecl(node: ts.Node): node is ValueOrTypeDecl {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isEnumDeclaration(node)
  );
}

function declaredName(node: ValueOrTypeDecl): string | null {
  const name = node.name;
  if (name === undefined) return null;
  return name.text;
}

const sourceCache = new Map<string, ts.SourceFile>();
const declCache = new Map<string, Map<string, ts.Node[]>>();
const exportCache = new Map<string, readonly ExportedSymbol[]>();

function sourceFile(filePath: string): ts.SourceFile {
  const cached = sourceCache.get(filePath);
  if (cached !== undefined) return cached;
  const parsed = ts.createSourceFile(
    filePath,
    readFileSync(filePath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  sourceCache.set(filePath, parsed);
  return parsed;
}

function pushDecl(index: Map<string, ts.Node[]>, name: string, node: ts.Node): void {
  const list = index.get(name);
  if (list === undefined) {
    index.set(name, [node]);
    return;
  }
  if (!list.includes(node)) list.push(node);
}

function declarationIndex(filePath: string): Map<string, ts.Node[]> {
  const cached = declCache.get(filePath);
  if (cached !== undefined) return cached;
  const index = new Map<string, ts.Node[]>();
  const visit = (node: ts.Node): void => {
    if (isMember(node)) return;
    if (isValueOrTypeDecl(node)) {
      const name = declaredName(node);
      if (name !== null) pushDecl(index, name, node);
    }
    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) pushDecl(index, declaration.name.text, node);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile(filePath));
  declCache.set(filePath, index);
  return index;
}

function localDeclarations(filePath: string, name: string): readonly ts.Node[] {
  return declarationIndex(filePath).get(name) ?? [];
}

function hasExportModifier(stmt: ts.Statement): boolean {
  if (!ts.canHaveModifiers(stmt)) return false;
  const modifiers = ts.getModifiers(stmt);
  if (modifiers === undefined) return false;
  return modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
}

function moduleSpecifierText(stmt: ts.ExportDeclaration): string | null {
  const specifier = stmt.moduleSpecifier;
  if (specifier === undefined || !ts.isStringLiteral(specifier)) return null;
  return specifier.text;
}

function walkExports(filePath: string, stack: Set<string>): readonly ExportedSymbol[] {
  const cached = exportCache.get(filePath);
  if (cached !== undefined) return cached;
  if (stack.has(filePath)) return [];
  stack.add(filePath);
  const out: ExportedSymbol[] = [];
  const add = (name: string, node: ts.Node): void => {
    if (name.length === 0) return;
    out.push({ name, node });
  };
  for (const stmt of sourceFile(filePath).statements) {
    if (ts.isExportDeclaration(stmt)) {
      const mod = moduleSpecifierText(stmt);
      const clause = stmt.exportClause;
      if (clause === undefined) {
        if (mod === null) continue;
        const next = resolveModule(filePath, mod);
        if (next !== null) {
          for (const item of walkExports(next, stack)) out.push(item);
        }
        continue;
      }
      if (!ts.isNamedExports(clause)) continue;
      for (const element of clause.elements) {
        const exported = moduleExportText(element.name);
        const propertyName = element.propertyName;
        const local = propertyName === undefined ? exported : moduleExportText(propertyName);
        if (mod === null) {
          for (const decl of localDeclarations(filePath, local)) add(exported, decl);
          continue;
        }
        const next = resolveModule(filePath, mod);
        if (next === null) {
          add(exported, stmt);
          continue;
        }
        const decls = localDeclarations(next, local);
        if (decls.length === 0) {
          const nested = walkExports(next, stack).filter((item) => item.name === local);
          if (nested.length === 0) add(exported, stmt);
          else {
            for (const item of nested) add(exported, item.node);
          }
          continue;
        }
        for (const decl of decls) add(exported, decl);
      }
      continue;
    }
    if (ts.isExportAssignment(stmt)) add("default", stmt);
    if (!hasExportModifier(stmt)) continue;
    if (isValueOrTypeDecl(stmt)) {
      const name = declaredName(stmt);
      add(name === null ? "default" : name, stmt);
      continue;
    }
    if (ts.isVariableStatement(stmt)) {
      for (const declaration of stmt.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) add(declaration.name.text, stmt);
      }
    }
  }
  exportCache.set(filePath, out);
  return out;
}

function exportedSymbols(filePath: string): readonly ExportedSymbol[] {
  return walkExports(filePath, new Set<string>());
}

function deprecatedPublicExports(): string[] {
  const hits: string[] = [];
  const seen = new Set<string>();
  for (const pkgDir of packageDirs()) {
    const packageName = readPackageName(pkgDir);
    for (const [subpath, target] of Object.entries(readExports(pkgDir))) {
      if (!isPublicEntry(subpath)) continue;
      const filePath = sourceOf(pkgDir, typesTarget(target));
      if (filePath === null) continue;
      for (const item of exportedSymbols(filePath)) {
        if (isMember(item.node) || !hasDeprecatedTag(item.node)) continue;
        const line = `${packageName} ${subpath} ${item.name}`;
        if (seen.has(line)) continue;
        seen.add(line);
        hits.push(line);
      }
    }
  }
  return hits;
}

const SKIP_DIR = new Set(["superpowers", "node_modules", ".vitepress"]);

function walkDocs(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIR.has(name)) continue;
    const full = path.join(dir, name);
    if (isDirectory(full)) walkDocs(full, out);
    else if (name.endsWith(".md")) out.push(full);
  }
}

function mentionFiles(): string[] {
  const out: string[] = [];
  walkDocs(path.join(repoRoot, "docs"), out);
  const rootReadme = path.join(repoRoot, "README.md");
  if (isFile(rootReadme)) out.push(rootReadme);
  out.push(path.join(repoRoot, "CLAUDE.md"));
  const packages = path.join(repoRoot, "packages");
  for (const name of readdirSync(packages)) {
    const readme = path.join(packages, name, "README.md");
    if (isFile(readme)) out.push(readme);
  }
  return out;
}

function deprecatedNames(): readonly string[] {
  const names: string[] = [];
  for (const line of deprecatedPublicExports()) {
    const name = line.split(" ").at(-1);
    if (name !== undefined && name.length > 0 && !names.includes(name)) names.push(name);
  }
  return names;
}

/** True when the sentence that contains `index` begins with `Deprecated:`. */
function sentenceBeginsDeprecated(text: string, index: number): boolean {
  let start = 0;
  const boundary = /[.!?][ \t]*(?:\n|$)|[.!?][ \t]+/g;
  let match: RegExpExecArray | null;
  while ((match = boundary.exec(text)) !== null) {
    const end = match.index + match[0].length;
    if (end <= index) start = end;
    else break;
  }
  const paragraph = text.lastIndexOf("\n\n", index);
  if (paragraph !== -1 && paragraph + 2 > start && paragraph + 2 <= index) start = paragraph + 2;
  return text.slice(start).trimStart().startsWith("Deprecated:");
}

/** Names from `deprecatedPublicExports` outside a sentence that begins `Deprecated:`. */
export function deprecatedMentions(): string[] {
  const names = deprecatedNames();
  const hits: string[] = [];
  for (const file of mentionFiles()) {
    const text = readFileSync(file, "utf8");
    const seen = new Set<string>();
    for (const name of names) {
      const pattern = new RegExp(`(?<![A-Za-z0-9_])${name}(?![A-Za-z0-9_])`, "g");
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(text)) !== null) {
        if (sentenceBeginsDeprecated(text, match.index)) continue;
        const line = text.slice(0, match.index).split("\n").length;
        const row = `${path.relative(repoRoot, file)}:${line} ${name}`;
        if (seen.has(row)) continue;
        seen.add(row);
        hits.push(row);
      }
    }
  }
  return hits;
}

describe("deprecated public exports in docs", () => {
  it("a deprecated public export is only named in a sentence that begins Deprecated:", () => {
    expect(deprecatedNames()).toEqual(["useComponentFor"]);
    expect(deprecatedMentions()).toEqual([]);
  });
});
