import ts from "typescript";
import { scanImports } from "./import-sources.js";
import {
  listDeclarationFiles,
  listRuntimeFiles,
  listTestFiles,
  parseSource,
  readSourceText,
} from "./source-files.js";
import type { SourceFile } from "./source-files.js";

/**
 * Package name of a module specifier. `@scope/name/sub` counts as `@scope/name`.
 * A relative specifier is not a package.
 */
function packageOf(specifier: string): string | undefined {
  if (
    specifier === "." ||
    specifier === ".." ||
    specifier.startsWith("./") ||
    specifier.startsWith("../")
  ) {
    return undefined;
  }
  const parts = specifier.split("/");
  const size = specifier.startsWith("@") ? 2 : 1;
  const name = parts.slice(0, size).join("/");
  if (name === "" || name === "@") return undefined;
  return name;
}

function addPackage(names: Set<string>, specifier: string): void {
  const name = packageOf(specifier);
  if (name !== undefined) names.add(name);
}

/** `declare module "<name>"` with a string name. A comment is not a declaration. */
function collectDeclared(source: ts.SourceFile, names: Set<string>): void {
  const visit = (node: ts.Node): void => {
    if (ts.isModuleDeclaration(node) && ts.isStringLiteral(node.name)) {
      addPackage(names, node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

/** One file: imports when `imports` is set, and every string `declare module` either way. */
async function collectFile(file: SourceFile, names: Set<string>, imports: boolean): Promise<void> {
  const text = await readSourceText(file);
  if (text === undefined) return;
  const source = parseSource(file, text);
  if (imports) {
    for (const site of scanImports(source)) addPackage(names, site.specifier);
  }
  collectDeclared(source, names);
}

/**
 * Package names used by the non-test script files of `src` (`listRuntimeFiles` minus
 * `listTestFiles`) through `scanImports`, and by `declare module "<name>"` in those files and in
 * the `.d.ts` files under `src`. A subpath counts for its package. One file is read at a time.
 */
export async function usedPackages(root: string): Promise<ReadonlySet<string>> {
  const names = new Set<string>();
  const testPaths = new Set((await listTestFiles(root)).map((file) => file.relative));
  const scripts = (await listRuntimeFiles(root)).filter((file) => !testPaths.has(file.relative));
  for (const file of scripts) await collectFile(file, names, true);
  const declarations = (await listDeclarationFiles(root)).filter((file) =>
    file.relative.startsWith("src/"),
  );
  for (const file of declarations) await collectFile(file, names, false);
  return names;
}
