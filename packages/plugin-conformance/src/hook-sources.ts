import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

/** A hook name declared by `defineHooks` or a `GwenRuntimeHooks` augmentation. */
export interface HookDeclaration {
  readonly name: string;
  readonly file: string;
  readonly line: number;
}

/** One syntactic emit site. `name` is `undefined` when the argument is not a resolvable string. */
export interface HookEmit {
  readonly name: string | undefined;
  /** Source text of the name argument. */
  readonly source: string;
  readonly file: string;
  readonly line: number;
}

export interface HookSources {
  readonly declarations: readonly HookDeclaration[];
  readonly emits: readonly HookEmit[];
}

/** Position of the name argument for each emit method. */
const EMIT_METHOD_ARGUMENT: ReadonlyMap<string, number> = new Map([
  ["callHook", 0],
  ["callHookParallel", 0],
  ["callHookWith", 1],
]);

/** `null` marks a name bound more than once in the file, or bound to anything but a string literal. */
type ConstStrings = ReadonlyMap<string, string | null>;

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

async function listDirectory(directory: string): Promise<readonly string[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    // A missing or unreadable directory holds no hook source.
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") files.push(...(await listDirectory(full)));
    } else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
      files.push(full);
    }
  }
  return files;
}

function isStringLiteralLike(
  node: ts.Node,
): node is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
}

/** Strip the wrappers that only exist for the type checker: `( )`, `as`, `satisfies`. */
function unwrapTypeOnly(node: ts.Expression): ts.Expression {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function bindingNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];
  const names: string[] = [];
  for (const element of name.elements) {
    if (!ts.isOmittedExpression(element)) names.push(...bindingNames(element.name));
  }
  return names;
}

/**
 * Same-file `const` names initialised with a string literal. Resolution ignores scope, so a name
 * that any other binding shares (parameter, `let`, `var`, function, class, import, catch) is
 * unresolvable.
 */
function collectConstStrings(source: ts.SourceFile): ConstStrings {
  const consts = new Map<string, string | null>();
  const bind = (name: string, value: string | null): void => {
    consts.set(name, consts.has(name) ? null : value);
  };
  const bindOther = (name: ts.BindingName): void => {
    for (const text of bindingNames(name)) bind(text, null);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node)) {
      const isConst =
        ts.isVariableDeclarationList(node.parent) && (node.parent.flags & ts.NodeFlags.Const) !== 0;
      if (isConst && ts.isIdentifier(node.name)) {
        const initializer =
          node.initializer === undefined ? undefined : unwrapTypeOnly(node.initializer);
        bind(
          node.name.text,
          initializer !== undefined && isStringLiteralLike(initializer) ? initializer.text : null,
        );
      } else {
        bindOther(node.name);
      }
    } else if (ts.isParameter(node)) {
      bindOther(node.name);
    } else if (
      (ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isClassDeclaration(node) ||
        ts.isClassExpression(node) ||
        ts.isEnumDeclaration(node) ||
        ts.isImportClause(node) ||
        ts.isImportSpecifier(node) ||
        ts.isNamespaceImport(node) ||
        ts.isImportEqualsDeclaration(node)) &&
      node.name !== undefined
    ) {
      bind(node.name.text, null);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return consts;
}

/** A string literal, or an identifier that names a same-file `const` string literal. */
function stringValue(node: ts.Expression, consts: ConstStrings): string | undefined {
  const value = unwrapTypeOnly(node);
  if (isStringLiteralLike(value)) return value.text;
  if (ts.isIdentifier(value)) return consts.get(value.text) ?? undefined;
  return undefined;
}

function keyName(name: ts.PropertyName, consts: ConstStrings): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  if (ts.isComputedPropertyName(name)) return stringValue(name.expression, consts);
  return undefined;
}

function calleeName(call: ts.CallExpression): string | undefined {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return undefined;
}

/** Index of the name argument when `call` is an emit site, else `undefined`. */
function emitArgumentIndex(call: ts.CallExpression): number | undefined {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text === "emit" ? 0 : undefined;
  if (ts.isPropertyAccessExpression(callee)) return EMIT_METHOD_ARGUMENT.get(callee.name.text);
  return undefined;
}

function isRuntimeHooksAugmentation(node: ts.Node): node is ts.ModuleDeclaration {
  return (
    ts.isModuleDeclaration(node) &&
    ts.isStringLiteral(node.name) &&
    node.name.text === "@gwenjs/schema" &&
    node.body !== undefined &&
    ts.isModuleBlock(node.body)
  );
}

function scanSource(file: string, text: string): HookSources {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const consts = collectConstStrings(source);
  const declarations: HookDeclaration[] = [];
  const emits: HookEmit[] = [];
  const lineOf = (node: ts.Node): number =>
    source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const declare = (name: ts.PropertyName): void => {
    const value = keyName(name, consts);
    if (value !== undefined) declarations.push({ name: value, file, line: lineOf(name) });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const argument = emitArgumentIndex(node);
      const nameNode = argument === undefined ? undefined : node.arguments[argument];
      if (nameNode !== undefined) {
        emits.push({
          name: stringValue(nameNode, consts),
          source: nameNode.getText(source).replace(/\s+/g, " "),
          file,
          line: lineOf(nameNode),
        });
      }
      const first = node.arguments[0];
      const literal = first === undefined ? undefined : unwrapTypeOnly(first);
      if (
        calleeName(node) === "defineHooks" &&
        literal !== undefined &&
        ts.isObjectLiteralExpression(literal)
      ) {
        for (const property of literal.properties) {
          if (ts.isPropertyAssignment(property) || ts.isMethodDeclaration(property)) {
            declare(property.name);
          }
        }
      }
    } else if (
      isRuntimeHooksAugmentation(node) &&
      node.body !== undefined &&
      ts.isModuleBlock(node.body)
    ) {
      for (const statement of node.body.statements) {
        if (!ts.isInterfaceDeclaration(statement) || statement.name.text !== "GwenRuntimeHooks")
          continue;
        for (const member of statement.members) {
          if (ts.isPropertySignature(member) || ts.isMethodSignature(member)) declare(member.name);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { declarations, emits };
}

/**
 * Parse every `*.ts` file under `<root>/src` (not `*.d.ts`, not `node_modules`) and collect
 * the hook names it declares and the emit sites it holds. Files come in path order.
 * A file that disappears between the listing and the read is skipped; any other read error rejects.
 */
export async function scanHookSources(root: string): Promise<HookSources> {
  const absolute = await listDirectory(path.join(root, "src"));
  const files = absolute
    .map((full) => ({ full, relative: path.relative(root, full).split(path.sep).join("/") }))
    .sort((left, right) => compareText(left.relative, right.relative));
  // One read at a time: a wide `src` must not exhaust file descriptors.
  const scans: HookSources[] = [];
  for (const { full, relative } of files) {
    let text: string;
    try {
      text = await readFile(full, "utf8");
    } catch (error) {
      // A file removed since the listing holds no hook source. Any other read error rejects.
      if (readErrorCode(error) === "ENOENT") continue;
      throw error;
    }
    scans.push(scanSource(relative, text));
  }
  return {
    declarations: scans.flatMap((scan) => scan.declarations),
    emits: scans.flatMap((scan) => scan.emits),
  };
}
