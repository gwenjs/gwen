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

function bindsName(name: ts.BindingName, wanted: string): boolean {
  if (ts.isIdentifier(name)) return name.text === wanted;
  return name.elements.some(
    (element) => !ts.isOmittedExpression(element) && bindsName(element.name, wanted),
  );
}

function listBinds(list: ts.VariableDeclarationList, wanted: string): boolean {
  return list.declarations.some((declaration) => bindsName(declaration.name, wanted));
}

/** Whether `node` holds a `var` of that name, not looking into nested functions. */
function hoistsVar(node: ts.Node, wanted: string): boolean {
  if (ts.isFunctionLike(node)) return false;
  const isVar = ts.isVariableDeclarationList(node) && (node.flags & ts.NodeFlags.BlockScoped) === 0;
  if (isVar && listBinds(node, wanted)) return true;
  return ts.forEachChild(node, (child) => (hoistsVar(child, wanted) ? true : undefined)) === true;
}

/** Whether `scope` itself declares `wanted`: a parameter, a block-level name or a `var` of a function body. */
function declaresName(scope: ts.Node, wanted: string): boolean {
  if (ts.isFunctionLike(scope)) {
    return scope.parameters.some((parameter) => bindsName(parameter.name, wanted));
  }
  if (ts.isCatchClause(scope)) {
    return (
      scope.variableDeclaration !== undefined && bindsName(scope.variableDeclaration.name, wanted)
    );
  }
  if (ts.isForStatement(scope) || ts.isForInStatement(scope) || ts.isForOfStatement(scope)) {
    const { initializer } = scope;
    return (
      initializer !== undefined &&
      ts.isVariableDeclarationList(initializer) &&
      listBinds(initializer, wanted)
    );
  }
  if (!ts.isBlock(scope)) return false;
  if (ts.isFunctionLike(scope.parent) && hoistsVar(scope, wanted)) return true;
  return scope.statements.some((statement) => {
    if (ts.isVariableStatement(statement)) return listBinds(statement.declarationList, wanted);
    return (
      (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
      statement.name?.text === wanted
    );
  });
}

function isShadowed(identifier: ts.Identifier): boolean {
  for (
    let scope: ts.Node | undefined = identifier.parent;
    scope !== undefined;
    scope = scope.parent
  ) {
    if (declaresName(scope, identifier.text)) return true;
  }
  return false;
}

/**
 * Every module specifier of `source`: `import`, `export … from`, `import("x")`, `require("x")`,
 * `import x = require("x")` and `import("x")` types, in source order. A dynamic import is read
 * whatever follows its first argument. The names a namespace import reads are found by name,
 * except for a property access whose namespace name is rebound by a parameter, a `var`, a block
 * `const` or `let`, a `for` initializer or a `catch` binding of an enclosing scope.
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
        isStringLiteralLike(argument) &&
        (isDynamicImport(node) || (isRequireCall(node) && rest.length === 0))
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

  /** A value read is skipped when a closer scope rebinds the name; a type position has no such scope. */
  const access = (
    binding: ts.Expression | ts.EntityName,
    name: string,
    at: ts.Node,
    value: boolean,
  ): void => {
    if (!ts.isIdentifier(binding)) return;
    const site = namespaces.get(binding.text);
    if (site === undefined || (value && isShadowed(binding))) return;
    site.names.push({ name, line: lineOf(source, at) });
  };
  const visitAccess = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node)) {
      access(node.expression, node.name.text, node.name, true);
    } else if (ts.isElementAccessExpression(node) && isStringLiteralLike(node.argumentExpression)) {
      access(node.expression, node.argumentExpression.text, node.argumentExpression, true);
    } else if (ts.isQualifiedName(node)) {
      access(node.left, node.right.text, node.right, false);
    }
    ts.forEachChild(node, visitAccess);
  };
  if (namespaces.size > 0) visitAccess(source);
  return sites;
}
