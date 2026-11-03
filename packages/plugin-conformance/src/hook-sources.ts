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

/** `null` marks a name that is declared twice or not initialised with a string literal. */
type ConstStrings = ReadonlyMap<string, string | null>;

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

function collectConstStrings(source: ts.SourceFile): ConstStrings {
  const consts = new Map<string, string | null>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      ts.isVariableDeclarationList(node.parent) &&
      (node.parent.flags & ts.NodeFlags.Const) !== 0
    ) {
      const literal = node.initializer !== undefined && isStringLiteralLike(node.initializer);
      const value = literal ? node.initializer.text : null;
      consts.set(node.name.text, consts.has(node.name.text) ? null : value);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return consts;
}

/** A string literal, or an identifier that names a same-file `const` string literal. */
function stringValue(node: ts.Node, consts: ConstStrings): string | undefined {
  if (isStringLiteralLike(node)) return node.text;
  if (ts.isIdentifier(node)) return consts.get(node.text) ?? undefined;
  return undefined;
}

function keyName(name: ts.PropertyName, consts: ConstStrings): string | undefined {
  if (ts.isStringLiteral(name)) return name.text;
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
      const literal = node.arguments[0];
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
 */
export async function scanHookSources(root: string): Promise<HookSources> {
  const absolute = await listDirectory(path.join(root, "src"));
  const files = absolute
    .map((full) => ({ full, relative: path.relative(root, full).split(path.sep).join("/") }))
    .sort((left, right) => compareText(left.relative, right.relative));
  const scans = await Promise.all(
    files.map(async ({ full, relative }) => {
      let text: string;
      try {
        text = await readFile(full, "utf8");
      } catch {
        // An unreadable file holds no hook source for this check.
        return { declarations: [], emits: [] };
      }
      return scanSource(relative, text);
    }),
  );
  return {
    declarations: scans.flatMap((scan) => scan.declarations),
    emits: scans.flatMap((scan) => scan.emits),
  };
}
