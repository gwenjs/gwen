/**
 * `gwen:hoist-chunk-columns` reads each distinct `C.get(D)` of a chunk row loop once.
 * It runs only with `optimizer` on (`OPTIMIZER_UNITS` in `pipeline/registry.ts`).
 *
 * The loop shape is `for (const C of Q) { for (...) { ...C.get(D)... } }` in a frame callback
 * (`onBeforeUpdate`, `onUpdate`, `onAfterUpdate`, `onRender`) that is a direct statement of a
 * `defineSystem` or `defineActor` factory. The outer `for...of` is a direct statement of the
 * callback body and each inner `for` a direct statement of the outer body (one unit of work each).
 * For each inner loop the unit inserts `const _gwen_cN = C.get(D);` right before it, one statement
 * per distinct D in order of first appearance, and overwrites every `C.get(D)` of the loop with
 * the local. A user `const x = C.get(D)` keeps its declarator and becomes `const x = _gwen_cN;`.
 * `N` is one counter per module and skips every identifier name present in the module.
 * The unit emits no id, stride or offset, never reads `C.count` into a local, and returns no
 * edit for its own output: a hoisted loop holds no `C.get(D)` any more.
 *
 * A loop that fails a precondition stays byte-identical. The first failing id is recorded in
 * `skips` (module-internal, for the debug log): P1 outer loop, P2 query, P3 definition binding,
 * P4 inner loop, P5 body allow-list, P6 structural call, P7 `@gwen-no-optimize`.
 * P5 is a closed `switch` on the node type: a type that is not listed fails it.
 * P7 is recorded for the outer loop when it is the opted-out statement, and for an inner loop
 * when the directive is on that `for` or on a statement nested inside it.
 * Identity of two references is identity of their `ScopeTracker` declaration
 * (`pipeline/scope-index.ts`), never the name: a shadowing local is another binding.
 * The scope index is built on the first loop that needs it, so a module with no candidate loop
 * pays nothing. Every walk of this file is read-only and every edit is against the original text.
 */

import type {
  ArrowFunctionExpression,
  CallExpression,
  ForOfStatement,
  ForStatement,
  Function,
  FunctionBody,
  Node,
  Program,
  VariableDeclaration,
} from "oxc-parser";
import type { ScopeTrackerNode } from "oxc-walker";
import { walk, type WalkerThisContextEnter } from "../oxc/index.js";
import { createScopeIndex, type ScopeIndex } from "../pipeline/scope-index.js";
import type {
  GwenCallee,
  GwenSourceTransform,
  TransformContext,
  TransformEdit,
} from "../pipeline/types.js";

/** A precondition id of the ticket. */
export type Precondition = "P1" | "P2" | "P3" | "P4" | "P5" | "P6" | "P7";

/** One loop that was left alone, and the first precondition it failed. */
export interface Skip {
  readonly start: number;
  readonly precondition: Precondition;
}

/** Edits and skips of one module. `run` returns the edits. */
export interface Analysis {
  readonly edits: readonly TransformEdit[];
  readonly skips: readonly Skip[];
}

type Func = ArrowFunctionExpression | Function;

/** A name with a position: every `Identifier` variant of the parser has both. */
interface Ident {
  readonly name: string;
  readonly start: number;
}

/** Where a candidate outer loop sits: the factory body that must hold its query. */
interface Site {
  readonly factory: FunctionBody;
}

/** What the allow-list needs to judge one inner loop. */
interface Env {
  readonly scope: ScopeIndex;
  /** The `for (const C of Q)` declaration: the identity of `C`. */
  readonly outer: VariableDeclaration;
  readonly chunk: string;
  /** The declarations of the definitions in the tuple of `Q`. */
  readonly defs: ReadonlySet<ScopeTrackerNode>;
  /** `Q` and the definitions: a write to one of them is refused. */
  readonly banned: ReadonlySet<ScopeTrackerNode>;
}

/** One `C.get(D)` call of an inner loop. */
interface Occurrence {
  readonly call: CallExpression;
  readonly def: ScopeTrackerNode;
  readonly defName: string;
}

interface Serial {
  n: number;
}

const STRUCTURAL = new Set(["addComponent", "removeComponent", "destroyEntity", "createEntity"]);

function isFactory(callee: GwenCallee | null): boolean {
  return callee === "defineSystem" || callee === "defineActor";
}

function isFrameCallback(callee: GwenCallee | null): boolean {
  return (
    callee === "onBeforeUpdate" ||
    callee === "onUpdate" ||
    callee === "onAfterUpdate" ||
    callee === "onRender"
  );
}

function isFunctionNode(node: { type: string }): node is Func {
  return node.type === "ArrowFunctionExpression" || node.type === "FunctionExpression";
}

/** A statement or a declaration: the places where a directive is written. */
function isStatementLevel(node: { type: string }): boolean {
  return node.type.endsWith("Statement") || node.type.endsWith("Declaration");
}

/** The block body of a function, or null for an expression body. */
function blockOf(fn: Func): FunctionBody | null {
  const body = fn.body;
  if (body === null || body.type !== "BlockStatement") return null;
  return body;
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

function freshName(taken: Set<string>, serial: Serial): string {
  let name = `_gwen_c${serial.n}`;
  while (taken.has(name)) {
    serial.n += 1;
    name = `_gwen_c${serial.n}`;
  }
  taken.add(name);
  serial.n += 1;
  return name;
}

/** The whitespace that opens the line holding `at`. */
function lineIndent(code: string, at: number): string {
  const lineStart = code.lastIndexOf("\n", at - 1) + 1;
  let end = lineStart;
  while (end < at && code.charAt(end).trim() === "") end += 1;
  return code.slice(lineStart, end);
}

/** Drops parentheses, `as`, `satisfies` and `!`: they change the type, not the value. */
function unwrap(node: Node): Node {
  let current = node;
  while (
    current.type === "ParenthesizedExpression" ||
    current.type === "TSAsExpression" ||
    current.type === "TSSatisfiesExpression" ||
    current.type === "TSNonNullExpression"
  ) {
    current = current.expression;
  }
  return current;
}

function declarationOf(env: Env, at: Ident): ScopeTrackerNode | null {
  const declaration = env.scope.declarationAt(at.start);
  return declaration === undefined ? null : declaration;
}

/** True when `at` is a reference to the loop variable `C` (same binding, not the same name). */
function isChunkRef(env: Env, at: Ident): boolean {
  if (at.name !== env.chunk) return false;
  const declaration = declarationOf(env, at);
  return (
    declaration !== null &&
    declaration.type === "Variable" &&
    declaration.variableNode === env.outer
  );
}

/** The object of a `X.get(...)` callee when `X` is named like the loop variable. */
function chunkGetObject(call: CallExpression, chunk: string): Ident | null {
  const callee = call.callee;
  if (callee.type !== "MemberExpression" || callee.computed) return null;
  if (callee.property.type !== "Identifier" || callee.property.name !== "get") return null;
  const object = callee.object;
  if (object.type !== "Identifier" || object.name !== chunk) return null;
  return object;
}

/** `C.get(D)`: the exact shape the unit hoists, `C` bound to the outer loop. */
function isColumnCall(env: Env, node: Node): boolean {
  if (node.type !== "CallExpression" || node.optional) return false;
  const object = chunkGetObject(node, env.chunk);
  if (object === null || !isChunkRef(env, object)) return false;
  const only = node.arguments[0];
  return node.arguments.length === 1 && only !== undefined && only.type === "Identifier";
}

/** A `const` local whose declarator init is `C.get(D)`. */
function isColumnAlias(env: Env, at: Ident): boolean {
  const declaration = declarationOf(env, at);
  if (declaration === null || declaration.type !== "Variable") return false;
  if (declaration.variableNode.kind !== "const") return false;
  for (const declarator of declaration.variableNode.declarations) {
    if (declarator.id.type !== "Identifier") continue;
    if (declarator.id.start !== declaration.node.start) continue;
    return declarator.init !== null && isColumnCall(env, unwrap(declarator.init));
  }
  return false;
}

/** The innermost value of a member chain: wrappers and `.x` / `[e]` steps removed. */
function chainRoot(node: Node): Node {
  let current = unwrap(node);
  while (current.type === "MemberExpression") current = unwrap(current.object);
  return current;
}

/** Every step is a plain member and every `[e]` index passes the allow-list. */
function stepsAllowed(env: Env, member: Node): boolean {
  let current = unwrap(member);
  while (current.type === "MemberExpression") {
    if (current.optional) return false;
    if (current.computed) {
      if (!allowed(env, current.property)) return false;
    } else if (current.property.type !== "Identifier") {
      return false;
    }
    current = unwrap(current.object);
  }
  return true;
}

/** `C.count`, as a whole chain and nothing else. */
function isCountRead(env: Env, member: Node): boolean {
  if (member.type !== "MemberExpression" || member.computed || member.optional) return false;
  if (member.property.type !== "Identifier" || member.property.name !== "count") return false;
  const object = unwrap(member.object);
  return object.type === "Identifier" && isChunkRef(env, object);
}

/** What a member chain is rooted at. */
function rootedAtColumn(env: Env, root: Node): boolean {
  if (isColumnCall(env, root)) return true;
  return root.type === "Identifier" && isColumnAlias(env, root);
}

function allowedMember(env: Env, member: Node): boolean {
  if (!stepsAllowed(env, member)) return false;
  const root = chainRoot(member);
  if (rootedAtColumn(env, root)) return true;
  if (isCountRead(env, unwrap(member))) return true;
  return root.type === "Identifier" && root.name === "Math" && declarationOf(env, root) === null;
}

/** A write target: a local that is not `C`, `Q` or a definition, or a column member chain. */
function allowedTarget(env: Env, target: Node): boolean {
  const node = unwrap(target);
  if (node.type === "Identifier") {
    const declaration = declarationOf(env, node);
    if (declaration === null || env.banned.has(declaration)) return false;
    return !isChunkRef(env, node);
  }
  if (node.type !== "MemberExpression") return false;
  return stepsAllowed(env, node) && rootedAtColumn(env, chainRoot(node));
}

function allowedCall(env: Env, call: CallExpression): boolean {
  if (call.optional) return false;
  if (isColumnCall(env, call)) return true;
  const callee = call.callee;
  if (callee.type !== "MemberExpression" || callee.computed || callee.optional) return false;
  const object = callee.object;
  if (object.type !== "Identifier" || object.name !== "Math") return false;
  if (declarationOf(env, object) !== null) return false;
  for (const argument of call.arguments) {
    if (argument.type === "SpreadElement" || !allowed(env, argument)) return false;
  }
  return true;
}

function allowedDeclaration(env: Env, declaration: VariableDeclaration): boolean {
  if (declaration.kind !== "let" && declaration.kind !== "const") return false;
  for (const declarator of declaration.declarations) {
    if (declarator.id.type !== "Identifier") return false;
    if (declarator.init !== null && !allowed(env, declarator.init)) return false;
  }
  return true;
}

function allowedOptional(env: Env, node: Node | null): boolean {
  return node === null || allowed(env, node);
}

/**
 * The P5 allow-list. A closed `switch`: a node type that is not a case is refused, and so is a
 * type annotation, since only the named children of an allowed node are visited.
 */
function allowed(env: Env, node: Node): boolean {
  switch (node.type) {
    case "Identifier":
      return node.name !== "arguments";
    case "Literal":
      return true;
    case "UnaryExpression":
      return node.operator !== "delete" && allowed(env, node.argument);
    case "BinaryExpression":
    case "LogicalExpression":
      return allowed(env, node.left) && allowed(env, node.right);
    case "ConditionalExpression":
      return (
        allowed(env, node.test) && allowed(env, node.consequent) && allowed(env, node.alternate)
      );
    case "UpdateExpression":
      return allowedTarget(env, node.argument);
    case "SequenceExpression":
      return node.expressions.every((item) => allowed(env, item));
    case "ParenthesizedExpression":
    case "TSAsExpression":
    case "TSSatisfiesExpression":
    case "TSNonNullExpression":
      return allowed(env, node.expression);
    case "AssignmentExpression":
      return allowedTarget(env, node.left) && allowed(env, node.right);
    case "MemberExpression":
      return allowedMember(env, node);
    case "CallExpression":
      return allowedCall(env, node);
    case "ExpressionStatement":
      return allowed(env, node.expression);
    case "VariableDeclaration":
      return allowedDeclaration(env, node);
    case "IfStatement":
      return (
        allowed(env, node.test) &&
        allowed(env, node.consequent) &&
        allowedOptional(env, node.alternate)
      );
    case "BlockStatement":
      return node.body.every((item) => allowed(env, item));
    case "ForStatement":
      return (
        allowedOptional(env, node.init) &&
        allowedOptional(env, node.test) &&
        allowedOptional(env, node.update) &&
        allowed(env, node.body)
      );
    case "BreakStatement":
    case "ContinueStatement":
      return node.label === null;
    case "EmptyStatement":
      return true;
    default:
      return false;
  }
}

/** P6: a call that adds, removes or destroys moves rows, so the columns can go stale. */
function hasStructuralCall(loop: ForStatement): boolean {
  let found = false;
  walk(loop, {
    enter(node) {
      if (node.type !== "CallExpression") return;
      const callee = node.callee;
      if (callee.type === "Identifier" && STRUCTURAL.has(callee.name)) found = true;
      if (callee.type !== "MemberExpression" || callee.computed) return;
      if (callee.property.type === "Identifier" && STRUCTURAL.has(callee.property.name)) {
        found = true;
      }
    },
  });
  return found;
}

/** A definition the hoist may read from outside the loop: an import or a module `const`. */
function isStableDefinition(declaration: ScopeTrackerNode): boolean {
  if (declaration.type === "Import") return true;
  return (
    declaration.type === "Variable" &&
    declaration.scope === "" &&
    declaration.variableNode.kind === "const"
  );
}

/** P3: every `C.get(...)` of the loop. `null` when one of them breaks the rule. */
function readOccurrences(env: Env, loop: ForStatement): Occurrence[] | null {
  const found: Occurrence[] = [];
  let valid = true;
  walk(loop, {
    enter(node) {
      if (node.type !== "CallExpression") return;
      const object = chunkGetObject(node, env.chunk);
      if (object === null) return;
      const only = node.arguments[0];
      if (
        node.optional ||
        node.arguments.length !== 1 ||
        only === undefined ||
        only.type !== "Identifier" ||
        !isChunkRef(env, object)
      ) {
        valid = false;
        return;
      }
      const def = declarationOf(env, only);
      if (def === null || !env.defs.has(def) || !isStableDefinition(def)) {
        valid = false;
        return;
      }
      found.push({ call: node, def, defName: only.name });
    },
  });
  if (!valid) return null;
  return found.sort((left, right) => left.call.start - right.call.start);
}

/** The tuple of `const Q = useQuery([D1, ..., Dn])` as declarations, or null. */
function queryDefinitions(
  ctx: TransformContext,
  scope: ScopeIndex,
  outer: ForOfStatement,
  site: Site,
): { query: ScopeTrackerNode; defs: ScopeTrackerNode[] } | null {
  const right = outer.right;
  if (right.type !== "Identifier") return null;
  const query = scope.declarationAt(right.start);
  if (query === null || query === undefined || query.type !== "Variable") return null;
  if (query.variableNode.kind !== "const") return null;
  if (!site.factory.body.includes(query.variableNode)) return null;
  for (const declarator of query.variableNode.declarations) {
    if (declarator.id.type !== "Identifier" || declarator.id.start !== query.node.start) continue;
    const init = declarator.init;
    if (init === null || init.type !== "CallExpression") return null;
    if (ctx.resolveCallee(init) !== "useQuery" || init.arguments.length !== 1) return null;
    const tuple = init.arguments[0];
    if (tuple === undefined || tuple.type !== "ArrayExpression") return null;
    if (tuple.elements.length === 0) return null;
    const defs: ScopeTrackerNode[] = [];
    for (const element of tuple.elements) {
      if (element === null || element.type !== "Identifier") return null;
      const def = scope.declarationAt(element.start);
      if (def !== null && def !== undefined) defs.push(def);
    }
    return { query, defs };
  }
  return null;
}

/** The inserts and overwrites of one inner loop. Names are taken only here, once it passed. */
function loopEdits(
  code: string,
  loop: ForStatement,
  chunk: string,
  occurrences: readonly Occurrence[],
  taken: Set<string>,
  serial: Serial,
): TransformEdit[] {
  const edits: TransformEdit[] = [];
  const names = new Map<ScopeTrackerNode, string>();
  const indent = lineIndent(code, loop.start);
  for (const occurrence of occurrences) {
    let name = names.get(occurrence.def);
    if (name === undefined) {
      name = freshName(taken, serial);
      names.set(occurrence.def, name);
      edits.push({
        kind: "insert",
        at: loop.start,
        text: `const ${name} = ${chunk}.get(${occurrence.defName});\n${indent}`,
      });
    }
    edits.push({
      kind: "overwrite",
      start: occurrence.call.start,
      end: occurrence.call.end,
      text: name,
    });
  }
  return edits;
}

export function analyse(program: Program, ctx: TransformContext): Analysis {
  const scope = createScopeIndex(program);
  const sites = new Map<ForOfStatement, Site>();
  const edits: TransformEdit[] = [];
  const skips: Skip[] = [];
  const serial: Serial = { n: 0 };
  let taken: Set<string> | undefined;

  /** Every `for...of` that is a direct statement of a frame callback of this factory. */
  function register(factory: Func): void {
    const body = blockOf(factory);
    if (body === null) return;
    for (const statement of body.body) {
      if (statement.type !== "ExpressionStatement") continue;
      const frame = statement.expression;
      if (frame.type !== "CallExpression" || !isFrameCallback(ctx.resolveCallee(frame))) continue;
      const callback = frame.arguments[0];
      if (callback === undefined || !isFunctionNode(callback)) continue;
      const inner = blockOf(callback);
      if (inner === null) continue;
      for (const loop of inner.body) {
        if (loop.type === "ForOfStatement") sites.set(loop, { factory: body });
      }
    }
  }

  function skip(start: number, precondition: Precondition): void {
    skips.push({ start, precondition });
  }

  /** P7: the directive is on the inner `for` or on a statement nested inside it. */
  function hasOptOut(loop: ForStatement): boolean {
    let found = false;
    walk(loop, {
      enter(node) {
        if (isStatementLevel(node) && ctx.isOptedOut(node)) found = true;
      },
    });
    return found;
  }

  function visit(outer: ForOfStatement, site: Site): void {
    const left = outer.left;
    const declarator = left.type === "VariableDeclaration" ? left.declarations[0] : undefined;
    if (
      left.type !== "VariableDeclaration" ||
      left.kind !== "const" ||
      left.declarations.length !== 1 ||
      declarator === undefined ||
      declarator.id.type !== "Identifier" ||
      outer.await ||
      outer.right.type !== "Identifier"
    ) {
      skip(outer.start, "P1");
      return;
    }
    const query = queryDefinitions(ctx, scope, outer, site);
    if (query === null) {
      skip(outer.start, "P2");
      return;
    }
    const body = outer.body;
    const loops = body.type === "BlockStatement" ? body.body : [];
    const inners: ForStatement[] = [];
    for (const statement of loops) {
      if (statement.type === "ForStatement") inners.push(statement);
    }
    if (inners.length === 0) {
      skip(outer.start, "P4");
      return;
    }
    const env: Env = {
      scope,
      outer: left,
      chunk: declarator.id.name,
      defs: new Set(query.defs),
      banned: new Set([query.query, ...query.defs]),
    };
    for (const loop of inners) {
      if (hasOptOut(loop)) {
        skip(loop.start, "P7");
        continue;
      }
      if (hasStructuralCall(loop)) {
        skip(loop.start, "P6");
        continue;
      }
      const occurrences = readOccurrences(env, loop);
      if (occurrences === null) {
        skip(loop.start, "P3");
        continue;
      }
      if (!allowed(env, loop)) {
        skip(loop.start, "P5");
        continue;
      }
      if (occurrences.length === 0) continue;
      taken ??= collectIdentifiers(program);
      edits.push(...loopEdits(ctx.code, loop, env.chunk, occurrences, taken, serial));
    }
  }

  walk(program, {
    enter(this: WalkerThisContextEnter, node) {
      const callee = node.type === "CallExpression" ? ctx.resolveCallee(node) : null;
      const guarded = isStatementLevel(node) || isFrameCallback(callee);
      if (guarded && ctx.isOptedOut(node)) {
        if (node.type === "ForOfStatement" && sites.has(node)) skip(node.start, "P7");
        this.skip();
        return;
      }
      if (node.type === "CallExpression" && isFactory(callee)) {
        for (const argument of node.arguments) {
          if (isFunctionNode(argument)) register(argument);
        }
        return;
      }
      if (node.type !== "ForOfStatement") return;
      const site = sites.get(node);
      if (site !== undefined) visit(node, site);
    },
  });
  return { edits, skips };
}

export const hoistChunkColumns: GwenSourceTransform = {
  name: "gwen:hoist-chunk-columns",
  run(program, ctx) {
    const found = analyse(program, ctx);
    for (const skip of found.skips) ctx.debug(skip, skip.precondition);
    return found.edits;
  },
};
