import ts from "typescript";
import { isStringLiteralLike, lineOf } from "./source-files.js";

/** A name taken from a module: where it is read in the file. */
export interface ImportedName {
  readonly name: string;
  readonly line: number;
}

/** One module specifier in a file, with the names the file takes from it. */
export interface ImportSite {
  readonly specifier: string;
  /** 1-based line of the specifier. */
  readonly line: number;
  /**
   * Named imports, named re-exports, `default` for a default import, the first name of an
   * `import("x").Name` type, and each property read on a namespace import (`ns.name`,
   * `ns["name"]`, `ns.Type`).
   */
  readonly names: readonly ImportedName[];
}

interface MutableSite {
  readonly specifier: string;
  readonly line: number;
  readonly names: ImportedName[];
}

function isRequireCall(node: ts.CallExpression): boolean {
  return ts.isIdentifier(node.expression) && node.expression.text === "require";
}

function isDynamicImport(node: ts.CallExpression): boolean {
  return node.expression.kind === ts.SyntaxKind.ImportKeyword;
}

/**
 * Every module specifier of `source`: `import`, `export … from`, `import("x")`, `require("x")`,
 * `import x = require("x")` and `import("x")` types, in source order. The names a namespace import
 * reads are found by name, ignoring scope.
 */
export function scanImports(source: ts.SourceFile): readonly ImportSite[] {
  const sites: MutableSite[] = [];
  const namespaces = new Map<string, MutableSite>();
  const open = (literal: ts.Node & { readonly text: string }): MutableSite => {
    const site = { specifier: literal.text, line: lineOf(source, literal), names: [] };
    sites.push(site);
    return site;
  };
  const addName = (site: MutableSite, name: ts.Node & { readonly text: string }): void => {
    site.names.push({ name: name.text, line: lineOf(source, name) });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const site = open(node.moduleSpecifier);
      const clause = node.importClause;
      if (clause?.name !== undefined)
        site.names.push({ name: "default", line: lineOf(source, clause.name) });
      const bindings = clause?.namedBindings;
      if (bindings !== undefined) {
        if (ts.isNamedImports(bindings)) {
          for (const element of bindings.elements)
            addName(site, element.propertyName ?? element.name);
        } else {
          namespaces.set(bindings.name.text, site);
        }
      }
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const site = open(node.moduleSpecifier);
      const exports = node.exportClause;
      if (exports !== undefined && ts.isNamedExports(exports)) {
        for (const element of exports.elements) addName(site, element.propertyName ?? element.name);
      }
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      namespaces.set(node.name.text, open(node.moduleReference.expression));
    } else if (ts.isCallExpression(node)) {
      const [argument, ...rest] = node.arguments;
      if (
        argument !== undefined &&
        rest.length === 0 &&
        isStringLiteralLike(argument) &&
        (isRequireCall(node) || isDynamicImport(node))
      ) {
        open(argument);
      }
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      const site = open(node.argument.literal);
      let qualifier = node.qualifier;
      while (qualifier !== undefined && ts.isQualifiedName(qualifier)) qualifier = qualifier.left;
      if (qualifier !== undefined && ts.isIdentifier(qualifier)) addName(site, qualifier);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  const access = (binding: ts.Expression | ts.EntityName, name: string, at: ts.Node): void => {
    if (!ts.isIdentifier(binding)) return;
    const site = namespaces.get(binding.text);
    if (site !== undefined) site.names.push({ name, line: lineOf(source, at) });
  };
  const visitAccess = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node)) {
      access(node.expression, node.name.text, node.name);
    } else if (ts.isElementAccessExpression(node) && isStringLiteralLike(node.argumentExpression)) {
      access(node.expression, node.argumentExpression.text, node.argumentExpression);
    } else if (ts.isQualifiedName(node)) {
      access(node.left, node.right.text, node.right);
    }
    ts.forEachChild(node, visitAccess);
  };
  if (namespaces.size > 0) visitAccess(source);
  return sites;
}
