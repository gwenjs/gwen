/**
 * @file AST walker for detecting `useQuery + onUpdate` patterns inside
 * `defineSystem` and `defineActor` bodies.  Used by the GWEN Vite optimizer
 * to find ECS query patterns that can be pre-compiled to bulk WASM calls.
 *
 * Detection strategy:
 * 1. Find `useQuery([ComponentA, ComponentB])` or
 *    `useActorQuery(ActorDef, [ComponentA, ComponentB])` calls — extract component names.
 * 2. Find `onUpdate(() => { ... })` blocks — scan body for `useComponentFor` calls.
 * 3. Classify each `useComponentFor(entityId, Comp)` as a read declaration.
 * 4. Detect proxy mutations (`pos.x += vel.x * dt`) as write targets, using
 *    the read-variable map to resolve variable names to component names.
 *
 * Uses `oxc-parser` for fast, accurate TypeScript parsing and `oxc-walker`
 * for AST traversal without Babel as a dependency.
 */

import { walk } from "oxc-walker";
import type {
  CallExpression,
  ArrowFunctionExpression,
  Function as FunctionExpression,
  VariableDeclaration,
  VariableDeclarator,
  ForOfStatement,
  ExpressionStatement,
  AssignmentExpression,
  StaticMemberExpression,
  BindingIdentifier,
  Statement,
} from "oxc-parser";
import type { OptimizablePattern, PatternPositions } from "./types.js";
import {
  parseSource,
  isCallTo,
  getCallArgs,
  getIdentifierName,
  getFunctionBodyStatements,
  getArrayElements,
} from "../oxc/index.js";

// ─── AstWalker ────────────────────────────────────────────────────────────────

/**
 * Walks a TypeScript source file AST to find `useQuery + onUpdate` patterns
 * that the optimizer can replace with bulk WASM calls.
 *
 * Supports both `defineSystem` and `defineActor` bodies:
 * - `defineSystem(() => { ... })` — factory is the first (and only) argument.
 * - `defineActor(Prefab, factory)` or `defineActor('Name', Prefab, factory)` —
 *   factory is the last function-typed argument (name may have been injected by
 *   the Vite actor name transform before this plugin runs).
 *
 * Also detects `useActorQuery(ActorDef, [ComponentA, ComponentB])` in addition
 * to `useQuery([ComponentA, ComponentB])` — extracting components from the
 * second argument in the actor-query form.
 *
 * @example
 * ```ts
 * const walker = new AstWalker('src/systems/movement.ts');
 * const patterns = walker.walk(sourceCode);
 * // patterns[0].queryComponents → ['Position', 'Velocity']
 * // patterns[0].readComponents  → ['Position', 'Velocity']
 * // patterns[0].writeComponents → ['Position']
 * ```
 */
export class AstWalker {
  /**
   * @param filename - Source file path; used for location metadata in patterns.
   */
  constructor(private readonly filename: string) {}

  /**
   * Parse and walk `source`, returning all detected `OptimizablePattern`
   * candidates. Returns an empty array if the source has no `useQuery` calls
   * or cannot be parsed.
   *
   * @param source - TypeScript source code to analyze.
   * @returns Array of detected optimizable patterns (may be empty).
   */
  walk(source: string): OptimizablePattern[] {
    if (!source.includes("useQuery") && !source.includes("useActorQuery")) return [];

    const parsed = parseSource(this.filename, source);
    if (!parsed) return [];

    const patterns: OptimizablePattern[] = [];
    const filename = this.filename;

    walk(parsed.program, {
      enter(node) {
        if (node.type !== "CallExpression") return;
        const call = node as CallExpression;

        const isSystem = isCallTo(call, "defineSystem");
        const isActor = isCallTo(call, "defineActor");
        if (!isSystem && !isActor) return;

        const args = getCallArgs(call);
        if (args.length === 0) return;

        // For actors the factory is always the last function-typed argument.
        // The actor name transform (gwenActorPlugin) may prepend a string literal
        // before this plugin runs, so we cannot assume a fixed position.
        // For systems the factory is always args[0].
        const callback = isActor
          ? [...args]
              .reverse()
              .find((a) => a.type === "ArrowFunctionExpression" || a.type === "FunctionExpression")
          : args[0];
        if (!callback) return;
        if (callback.type !== "ArrowFunctionExpression" && callback.type !== "FunctionExpression") {
          return;
        }

        const fn = callback as ArrowFunctionExpression | FunctionExpression;
        const queryComponents = extractQueryComponents(fn);
        if (queryComponents.length === 0) return;

        const { readComponents, writeComponents, loc, positions } = extractUpdateUsage(
          fn,
          filename,
        );
        patterns.push({ queryComponents, readComponents, writeComponents, loc, positions });
        this.skip();
      },
    });

    return patterns;
  }
}

// ─── Private helpers ──────────────────────────────────────────────────────────

/**
 * Extract component names from query calls inside the outer function body.
 *
 * Handles two forms:
 * - `useQuery([ComponentA, ComponentB])` — components at arg 0.
 * - `useActorQuery(ActorDef, [ComponentA, ComponentB])` — components at arg 1.
 */
function extractQueryComponents(fn: FunctionExpression | ArrowFunctionExpression): string[] {
  const names: string[] = [];
  const stmts = getFunctionBodyStatements(fn);

  for (const stmt of stmts) {
    if (stmt.type !== "VariableDeclaration") continue;
    const varDecl = stmt as VariableDeclaration;
    for (const decl of varDecl.declarations) {
      const varDeclarator = decl as VariableDeclarator;
      if (!varDeclarator.init) continue;

      const isUseQuery = isCallTo(varDeclarator.init, "useQuery");
      const isUseActorQuery = isCallTo(varDeclarator.init, "useActorQuery");
      if (!isUseQuery && !isUseActorQuery) continue;

      const callArgs = getCallArgs(varDeclarator.init as CallExpression);
      // useQuery([A, B])           → components at arg 0
      // useActorQuery(Def, [A, B]) → components at arg 1
      const componentArg = isUseActorQuery ? callArgs[1] : callArgs[0];
      if (!componentArg) continue;

      for (const el of getArrayElements(componentArg)) {
        const name = getIdentifierName(el);
        if (name) names.push(name);
      }
    }
  }

  return names;
}

/**
 * Extract read and write component usage from `onUpdate` callback bodies.
 *
 * Reads are detected from `useComponentFor(entityId, Comp)` declarations.
 * Writes are detected from proxy mutations (`pos.x += ...`) using the
 * read-variable map built from the read declarations.
 */
function extractUpdateUsage(
  fn: FunctionExpression | ArrowFunctionExpression,
  filename: string,
): {
  readComponents: string[];
  writeComponents: string[];
  loc: { line: number; column: number; file: string };
  positions?: PatternPositions;
} {
  const reads = new Set<string>();
  const writes = new Set<string>();
  let loc = { line: 1, column: 0, file: filename };
  let positions: PatternPositions | undefined;
  const stmts = getFunctionBodyStatements(fn);

  for (const stmt of stmts) {
    if (stmt.type !== "ExpressionStatement") continue;
    const exprStmt = stmt as ExpressionStatement;
    if (exprStmt.expression.type !== "CallExpression") continue;
    if (!isCallTo(exprStmt.expression as CallExpression, "onUpdate")) continue;

    loc = { line: 1, column: 0, file: filename };

    const updateArgs = getCallArgs(exprStmt.expression as CallExpression);
    if (updateArgs.length === 0) continue;
    const updateCb = updateArgs[0]!;
    if (updateCb.type !== "ArrowFunctionExpression" && updateCb.type !== "FunctionExpression") {
      continue;
    }

    const onUpdateCb = updateCb as FunctionExpression | ArrowFunctionExpression;
    const innerStmts = getFunctionBodyStatements(onUpdateCb);

    // Pass 1: collect read declarations (2-arg useComponent calls).
    for (const innerStmt of innerStmts) {
      collectUseComponentReads(innerStmt, reads);
    }

    // Build the variable → component map from read declarations.
    const readVarMap = buildReadVarMap(onUpdateCb, filename);

    // Pass 2: collect write targets from proxy mutations using the read-var map.
    for (const innerStmt of innerStmts) {
      collectAssignmentWrites(innerStmt, readVarMap, writes);
    }

    positions = extractForOfPositions(onUpdateCb, readVarMap, filename);
  }

  return { readComponents: [...reads], writeComponents: [...writes], loc, positions };
}

/**
 * Recursively collect `useComponentFor` read declarations from a statement.
 * Handles `for-of` loops that wrap the component access calls.
 *
 * Classification: `useComponentFor(entityId, Comp)` — **read**.
 */
function collectUseComponentReads(node: Statement, reads: Set<string>): void {
  if (node.type === "ForOfStatement") {
    const forOf = node as ForOfStatement;
    if (forOf.body.type === "BlockStatement") {
      const block = forOf.body as unknown as { body: Statement[] };
      for (const s of block.body) collectUseComponentReads(s, reads);
    }
    return;
  }

  // `const pos = useComponentFor(entityId, Position)` — read
  if (node.type === "VariableDeclaration") {
    const varDecl = node as VariableDeclaration;
    for (const decl of varDecl.declarations) {
      const d = decl as VariableDeclarator;
      if (!d.init || d.init.type !== "CallExpression") continue;
      if (!isCallTo(d.init as CallExpression, "useComponentFor")) continue;
      const args = getCallArgs(d.init as CallExpression);
      if (args.length === 2) {
        const name = getIdentifierName(args[1]!);
        if (name) reads.add(name);
      }
    }
  }
}

/**
 * Recursively collect write targets from proxy mutation assignments.
 * Handles `for-of` loops that wrap the assignments.
 *
 * A write target is a component whose proxy variable appears on the left-hand
 * side of an assignment expression (`pos.x = value` or `pos.x += value`).
 *
 * @param node       - AST statement node to inspect.
 * @param readVarMap - Map of variable name → component name (from read declarations).
 * @param writes     - Accumulator set for written component names.
 */
function collectAssignmentWrites(
  node: Statement,
  readVarMap: Map<string, string>,
  writes: Set<string>,
): void {
  if (node.type === "ForOfStatement") {
    const forOf = node as ForOfStatement;
    if (forOf.body.type === "BlockStatement") {
      const block = forOf.body as unknown as { body: Statement[] };
      for (const s of block.body) collectAssignmentWrites(s, readVarMap, writes);
    }
    return;
  }

  // `pos.x = value` or `pos.x += value * dt` — proxy mutation
  if (node.type === "ExpressionStatement") {
    const exprStmt = node as ExpressionStatement;
    if (exprStmt.expression.type !== "AssignmentExpression") return;
    const assign = exprStmt.expression as AssignmentExpression;
    if (assign.left.type !== "MemberExpression") return;
    const mem = assign.left as StaticMemberExpression;
    if (mem.computed) return;
    if (mem.object.type !== "Identifier") return;
    const varName = (mem.object as BindingIdentifier).name;
    const component = readVarMap.get(varName);
    if (component) writes.add(component);
  }
}

// ─── Phase 2 helpers ──────────────────────────────────────────────────────────

/**
 * Scan the body of an `onUpdate` callback and build a map from read-variable
 * names to their component names.
 *
 * Example: `const pos = useComponentFor(entity.id, Position)` → `{ 'pos' → 'Position' }`.
 */
function buildReadVarMap(
  onUpdateCallback: FunctionExpression | ArrowFunctionExpression,
  _filename: string,
): Map<string, string> {
  const map = new Map<string, string>();

  function collect(statements: Statement[]): void {
    for (const s of statements) {
      if (s.type === "ForOfStatement") {
        const forOf = s as ForOfStatement;
        if (forOf.body.type === "BlockStatement") {
          collect((forOf.body as unknown as { body: Statement[] }).body);
        }
        continue;
      }

      if (s.type !== "VariableDeclaration") continue;
      const varDecl = s as VariableDeclaration;
      for (const decl of varDecl.declarations) {
        const d = decl as VariableDeclarator;
        if (!d.init || d.init.type !== "CallExpression") continue;
        if (!isCallTo(d.init as CallExpression, "useComponentFor")) continue;
        const args = getCallArgs(d.init as CallExpression);
        if (args.length !== 2) continue;
        if (d.id.type !== "Identifier") continue;
        const varName = (d.id as BindingIdentifier).name;
        const component = getIdentifierName(args[1]!);
        if (component) map.set(varName, component);
      }
    }
  }

  collect(getFunctionBodyStatements(onUpdateCallback));
  return map;
}

/**
 * Walk the `onUpdate` callback to find the first for-of loop and extract all
 * source byte-offset positions needed by `BulkTransformer`.
 *
 * - `readDecls`    — `const pos = useComponentFor(entity.id, Position)` statements to remove.
 * - `writeTargets` — component names mutated via proxy assignment (for `queryWriteBulk`).
 * - `propAccesses` — all `varName.field` member expressions to rewrite as flat-buffer indices.
 *
 * Returns `undefined` when no recognisable for-of pattern is found.
 */
function extractForOfPositions(
  onUpdateCallback: FunctionExpression | ArrowFunctionExpression,
  readVarMap: Map<string, string>,
  _filename: string,
): PatternPositions | undefined {
  const stmts = getFunctionBodyStatements(onUpdateCallback);

  for (const stmt of stmts) {
    if (stmt.type !== "ForOfStatement") continue;
    const forOf = stmt as ForOfStatement;

    if (forOf.left.type !== "VariableDeclaration") continue;
    const leftDecl = forOf.left as VariableDeclaration;
    if (leftDecl.declarations.length === 0) continue;
    const firstDecl = leftDecl.declarations[0] as VariableDeclarator;
    if (firstDecl.id.type !== "Identifier") continue;
    const entityVar = (firstDecl.id as BindingIdentifier).name;

    if (forOf.body.type !== "BlockStatement") continue;
    const forBodyStart = forOf.body.start;
    const forOfStart = forOf.start;
    const forOfEnd = forOf.end;

    const bodyStmts = (forOf.body as unknown as { body: Statement[] }).body;

    // Read declarations: `const pos = useComponentFor(entity.id, Position)` — to be removed.
    const readDecls: { varName: string; component: string; start: number; end: number }[] = [];
    for (const s of bodyStmts) {
      if (s.type !== "VariableDeclaration") continue;
      const varDecl = s as VariableDeclaration;
      for (const decl of varDecl.declarations) {
        const d = decl as VariableDeclarator;
        if (!d.init || d.init.type !== "CallExpression") continue;
        if (!isCallTo(d.init as CallExpression, "useComponentFor")) continue;
        const args = getCallArgs(d.init as CallExpression);
        if (args.length !== 2) continue;
        if (d.id.type !== "Identifier") continue;
        const varName = (d.id as BindingIdentifier).name;
        const component = getIdentifierName(args[1]!);
        if (!component) continue;
        readDecls.push({ varName, component, start: s.start, end: s.end });
      }
    }

    // Write targets: component names mutated via proxy assignment (`pos.x += ...`).
    const writeTargetSet = new Set<string>();
    for (const s of bodyStmts) {
      if (s.type !== "ExpressionStatement") continue;
      const exprStmt = s as ExpressionStatement;
      if (exprStmt.expression.type !== "AssignmentExpression") continue;
      const assign = exprStmt.expression as AssignmentExpression;
      if (assign.left.type !== "MemberExpression") continue;
      const mem = assign.left as StaticMemberExpression;
      if (mem.computed) continue;
      if (mem.object.type !== "Identifier") continue;
      const varName = (mem.object as BindingIdentifier).name;
      const component = readVarMap.get(varName);
      if (component) writeTargetSet.add(component);
    }
    const writeTargets = [...writeTargetSet];

    // Property accesses: all `varName.field` member expressions in the loop body
    // where `varName` is in `readVarMap`. These are rewritten to flat-buffer indices.
    // No exclusion ranges needed — assignment statements stay in place, only their
    // member expressions are rewritten.
    const propAccesses: { varName: string; fieldName: string; start: number; end: number }[] = [];

    walk(forOf.body, {
      enter(node) {
        if (node.type !== "MemberExpression") return;
        const mem = node as StaticMemberExpression;
        if (mem.computed) return;
        if (mem.object.type !== "Identifier") return;
        const varName = (mem.object as BindingIdentifier).name;
        if (!readVarMap.has(varName)) return;
        const fieldName = mem.property.name;
        propAccesses.push({ varName, fieldName, start: node.start, end: node.end });
      },
    });

    return {
      forOfStart,
      forBodyStart,
      forOfEnd,
      entityVar,
      readDecls,
      writeTargets,
      propAccesses,
    };
  }

  return undefined;
}
