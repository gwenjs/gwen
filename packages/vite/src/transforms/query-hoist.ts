/**
 * `gwen:query-hoist` hoists `useQuery([A, B])` to `const _gwen_qN = [A, B]`.
 * The const is inserted at the start of the top-level statement S that contains
 * the call, and the call becomes `useQuery(_gwen_qN)` with no second argument.
 * The callee is the import binding from `ctx.resolveCallee`
 * (`packages/vite/src/pipeline/resolve-callee.ts:145`).
 * An element is kept only when `ctx.isModuleScopeBinding` is true
 * (`packages/vite/src/pipeline/resolve-callee.ts:179`) and the name is an import
 * local or a module `const` whose declaration ends at or before S.
 * `N` skips every identifier name already present in the module.
 * A JSDoc on S stays above the hoisted const: S starts at the first token,
 * and comments are returned beside the program
 * (`packages/vite/src/pipeline/parse.ts:69`).
 * Accepted limit: hoisting evaluates `[A, B]` at module load. An import that is
 * still uninitialised because of a cycle throws there, where the factory did not.
 * A `useQuery` inside a top-level function declaration is not hoisted: the
 * declaration is hoisted and can run before the const.
 * Inserts at one offset keep emission order, which is source order of the calls
 * (walk pre-order) (`packages/vite/src/pipeline/apply-edits.ts:80`).
 */

import type { BindingPattern, CallExpression, Program, VariableDeclaration } from "oxc-parser";
import { walk } from "../oxc/index.js";
import type { GwenSourceTransform, TransformContext, TransformEdit } from "../pipeline/types.js";

interface ElementRef {
  readonly name: string;
  readonly start: number;
}

interface QueryArray {
  readonly start: number;
  readonly end: number;
  readonly elements: readonly ElementRef[];
}

interface Serial {
  n: number;
}

function resolvesUseQuery(call: CallExpression, ctx: TransformContext): boolean {
  return ctx.resolveCallee(call) === "useQuery";
}

function freshName(taken: Set<string>, serial: Serial): string {
  let name = `_gwen_q${serial.n}`;
  while (taken.has(name)) {
    serial.n += 1;
    name = `_gwen_q${serial.n}`;
  }
  taken.add(name);
  serial.n += 1;
  return name;
}

function importLocals(program: Program): ReadonlySet<string> {
  const names = new Set<string>();
  for (const statement of program.body) {
    if (statement.type !== "ImportDeclaration") continue;
    if (statement.importKind === "type") continue;
    for (const spec of statement.specifiers) {
      if (spec.type === "ImportSpecifier" && spec.importKind === "type") continue;
      names.add(spec.local.name);
    }
  }
  return names;
}

function constDeclaration(statement: Program["body"][number]): VariableDeclaration | null {
  if (statement.type === "VariableDeclaration") {
    if (statement.kind !== "const") return null;
    return statement;
  }
  if (statement.type !== "ExportNamedDeclaration") return null;
  const declaration = statement.declaration;
  if (declaration === null || declaration.type !== "VariableDeclaration") return null;
  if (declaration.kind !== "const") return null;
  return declaration;
}

function recordBinding(pattern: BindingPattern, end: number, ends: Map<string, number>): void {
  if (pattern.type === "Identifier") {
    ends.set(pattern.name, end);
    return;
  }
  if (pattern.type === "AssignmentPattern") {
    recordBinding(pattern.left, end, ends);
    return;
  }
  if (pattern.type === "ObjectPattern") {
    for (const property of pattern.properties) {
      if (property.type === "RestElement") {
        recordBinding(property.argument, end, ends);
        continue;
      }
      recordBinding(property.value, end, ends);
    }
    return;
  }
  for (const element of pattern.elements) {
    if (element === null) continue;
    if (element.type === "RestElement") {
      recordBinding(element.argument, end, ends);
      continue;
    }
    recordBinding(element, end, ends);
  }
}

function constEnds(program: Program): ReadonlyMap<string, number> {
  const ends = new Map<string, number>();
  for (const statement of program.body) {
    const declaration = constDeclaration(statement);
    if (declaration === null) continue;
    for (const declarator of declaration.declarations) {
      recordBinding(declarator.id, declaration.end, ends);
    }
  }
  return ends;
}

function collectIdentifiers(program: Program): Set<string> {
  const names = new Set<string>();
  walk(program, {
    enter(node) {
      if (node.type !== "Identifier") return;
      names.add(node.name);
    },
  });
  return names;
}

function enclosingStatement(program: Program, at: number): Program["body"][number] | null {
  for (const statement of program.body) {
    if (at >= statement.start && at < statement.end) return statement;
  }
  return null;
}

function readArray(call: CallExpression): QueryArray | null {
  if (call.arguments.length !== 1) return null;
  const first = call.arguments[0];
  if (first === undefined || first.type !== "ArrayExpression") return null;
  if (first.elements.length === 0) return null;
  const elements: ElementRef[] = [];
  for (const element of first.elements) {
    if (element === null || element.type !== "Identifier") return null;
    elements.push({ name: element.name, start: element.start });
  }
  return { start: first.start, end: first.end, elements };
}

function qualifiedLabels(
  elements: readonly ElementRef[],
  siteStart: number,
  imports: ReadonlySet<string>,
  consts: ReadonlyMap<string, number>,
  ctx: TransformContext,
): readonly string[] | null {
  const names: string[] = [];
  for (const element of elements) {
    if (!ctx.isModuleScopeBinding(element.name, element.start)) return null;
    const declared = consts.get(element.name);
    const imported = imports.has(element.name);
    const earlierConst = declared !== undefined && declared <= siteStart;
    if (!imported && !earlierConst) return null;
    names.push(element.name);
  }
  return names;
}

function collectEdits(program: Program, ctx: TransformContext): TransformEdit[] {
  const imports = importLocals(program);
  const consts = constEnds(program);
  const taken = collectIdentifiers(program);
  const serial: Serial = { n: 0 };
  const edits: TransformEdit[] = [];
  const calls: CallExpression[] = [];
  /** Every call position. S is still the enclosing top-level statement. */
  walk(program, {
    enter(node) {
      if (node.type !== "CallExpression") return;
      calls.push(node);
    },
  });
  for (const call of calls) {
    if (!resolvesUseQuery(call, ctx)) continue;
    const site = enclosingStatement(program, call.start);
    if (site === null) continue;
    if (functionDeclarationSite(site)) continue;
    const array = readArray(call);
    if (array === null) continue;
    const labels = qualifiedLabels(array.elements, site.start, imports, consts, ctx);
    if (labels === null) continue;
    const binding = freshName(taken, serial);
    const list = labels.join(", ");
    edits.push({
      kind: "insert",
      at: site.start,
      text: `const ${binding} = [${list}];\n`,
    });
    edits.push({
      kind: "overwrite",
      start: array.start,
      end: array.end,
      text: binding,
    });
  }
  return edits;
}

/**
 * A function declaration is hoisted and can run before the const.
 */
function functionDeclarationSite(statement: Program["body"][number]): boolean {
  if (statement.type === "FunctionDeclaration") return true;
  if (statement.type === "ExportNamedDeclaration") {
    const declaration = statement.declaration;
    return declaration !== null && declaration.type === "FunctionDeclaration";
  }
  if (statement.type === "ExportDefaultDeclaration") {
    return statement.declaration.type === "FunctionDeclaration";
  }
  return false;
}

export const queryHoist: GwenSourceTransform = {
  name: "gwen:query-hoist",
  run(program, ctx) {
    return collectEdits(program, ctx);
  },
};
