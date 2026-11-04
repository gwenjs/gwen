/**
 * @file AST walker for detecting `useQuery + onUpdate` patterns inside
 * `defineSystem` and `defineActor` bodies.  Used by the GWEN Vite optimizer
 * to find ECS query patterns that can be pre-compiled to bulk WASM calls.
 *
 * Detection strategy:
 * 1. Find `useQuery([ComponentA, ComponentB])` or
 *    `useActorQuery(ActorDef, [ComponentA, ComponentB])` calls — extract component names.
 * 2. Find `onUpdate(() => { ... })` blocks — scan body for `useComponent` calls.
 * 3. Classify each `useComponent(entityId, Comp)` as a read declaration.
 * 4. Detect proxy mutations (`pos.x += vel.x * dt`) as write targets, using
 *    the read-variable map to resolve variable names to component names.
 *
 * Uses `oxc-parser` for fast, accurate TypeScript parsing and `oxc-walker`
 * for AST traversal without Babel as a dependency.
 */

import { walk } from "oxc-walker";
import type {
  ArrowFunctionExpression,
  Function as FunctionExpression,
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
        const isSystem = isCallTo(node, "defineSystem");
        const isActor = isCallTo(node, "defineActor");
        if (!isSystem && !isActor) return;

        const args = getCallArgs(node);
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

        const fn = callback;
        const queryComponents = extractQueryComponents(fn);
        if (queryComponents.length === 0) return;

        const { readComponents, writeComponents, loc, positions } = extractUpdateUsage(
          fn,
          filename,
        );
        if (positions !== undefined) {
          patterns.push({ queryComponents, readComponents, writeComponents, loc, positions });
        } else {
          patterns.push({ queryComponents, readComponents, writeComponents, loc });
        }
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
    for (const varDeclarator of stmt.declarations) {
      const { init } = varDeclarator;
      if (!init || init.type !== "CallExpression") continue;

      const isUseQuery = isCallTo(init, "useQuery");
      const isUseActorQuery = isCallTo(init, "useActorQuery");
      if (!isUseQuery && !isUseActorQuery) continue;

      const callArgs = getCallArgs(init);
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
 * Reads are detected from `useComponent(entityId, Comp)` declarations.
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
    if (stmt.expression.type !== "CallExpression") continue;
    if (!isCallTo(stmt.expression, "onUpdate")) continue;

    loc = { line: 1, column: 0, file: filename };

    const updateCb = getCallArgs(stmt.expression)[0];
    if (!updateCb) continue;
    if (updateCb.type !== "ArrowFunctionExpression" && updateCb.type !== "FunctionExpression") {
      continue;
    }

    const onUpdateCb = updateCb;
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

  if (positions !== undefined) {
    return { readComponents: [...reads], writeComponents: [...writes], loc, positions };
  }
  return { readComponents: [...reads], writeComponents: [...writes], loc };
}

/**
 * Recursively collect `useComponent` read declarations from a statement.
 * Handles `for-of` loops that wrap the component access calls.
 *
 * Classification: `useComponent(entityId, Comp)` — **read**.
 */
function collectUseComponentReads(node: Statement, reads: Set<string>): void {
  if (node.type === "ForOfStatement") {
    if (node.body.type === "BlockStatement") {
      for (const s of node.body.body) collectUseComponentReads(s, reads);
    }
    return;
  }

  // `const pos = useComponent(entityId, Position)` — read
  if (node.type === "VariableDeclaration") {
    for (const d of node.declarations) {
      if (!d.init || d.init.type !== "CallExpression") continue;
      if (!isCallTo(d.init, "useComponent")) continue;
      const [, componentArg, ...rest] = getCallArgs(d.init);
      if (componentArg && rest.length === 0) {
        const name = getIdentifierName(componentArg);
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
    if (node.body.type === "BlockStatement") {
      for (const s of node.body.body) collectAssignmentWrites(s, readVarMap, writes);
    }
    return;
  }

  // `pos.x = value` or `pos.x += value * dt` — proxy mutation
  if (node.type === "ExpressionStatement") {
    if (node.expression.type !== "AssignmentExpression") return;
    const mem = node.expression.left;
    if (mem.type !== "MemberExpression") return;
    if (mem.computed) return;
    if (mem.object.type !== "Identifier") return;
    const component = readVarMap.get(mem.object.name);
    if (component) writes.add(component);
  }
}

// ─── Phase 2 helpers ──────────────────────────────────────────────────────────

/**
 * Scan the body of an `onUpdate` callback and build a map from read-variable
 * names to their component names.
 *
 * Example: `const pos = useComponent(entity.id, Position)` → `{ 'pos' → 'Position' }`.
 */
function buildReadVarMap(
  onUpdateCallback: FunctionExpression | ArrowFunctionExpression,
  _filename: string,
): Map<string, string> {
  const map = new Map<string, string>();

  function collect(statements: Statement[]): void {
    for (const s of statements) {
      if (s.type === "ForOfStatement") {
        if (s.body.type === "BlockStatement") {
          collect(s.body.body);
        }
        continue;
      }

      if (s.type !== "VariableDeclaration") continue;
      for (const d of s.declarations) {
        if (!d.init || d.init.type !== "CallExpression") continue;
        if (!isCallTo(d.init, "useComponent")) continue;
        const [, componentArg, ...rest] = getCallArgs(d.init);
        if (!componentArg || rest.length !== 0) continue;
        if (d.id.type !== "Identifier") continue;
        const component = getIdentifierName(componentArg);
        if (component) map.set(d.id.name, component);
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
 * - `readDecls`    — `const pos = useComponent(entity.id, Position)` statements to remove.
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
    const forOf = stmt;

    if (forOf.left.type !== "VariableDeclaration") continue;
    const firstDecl = forOf.left.declarations[0];
    if (!firstDecl) continue;
    if (firstDecl.id.type !== "Identifier") continue;
    const entityVar = firstDecl.id.name;

    if (forOf.body.type !== "BlockStatement") continue;
    const forBodyStart = forOf.body.start;
    const forOfStart = forOf.start;
    const forOfEnd = forOf.end;

    const bodyStmts = forOf.body.body;

    // Read declarations: `const pos = useComponent(entity.id, Position)` — to be removed.
    const readDecls: { varName: string; component: string; start: number; end: number }[] = [];
    for (const s of bodyStmts) {
      if (s.type !== "VariableDeclaration") continue;
      for (const d of s.declarations) {
        if (!d.init || d.init.type !== "CallExpression") continue;
        if (!isCallTo(d.init, "useComponent")) continue;
        const [, componentArg, ...rest] = getCallArgs(d.init);
        if (!componentArg || rest.length !== 0) continue;
        if (d.id.type !== "Identifier") continue;
        const component = getIdentifierName(componentArg);
        if (!component) continue;
        readDecls.push({ varName: d.id.name, component, start: s.start, end: s.end });
      }
    }

    // Write targets: component names mutated via proxy assignment (`pos.x += ...`).
    const writeTargetSet = new Set<string>();
    for (const s of bodyStmts) {
      if (s.type !== "ExpressionStatement") continue;
      if (s.expression.type !== "AssignmentExpression") continue;
      const mem = s.expression.left;
      if (mem.type !== "MemberExpression") continue;
      if (mem.computed) continue;
      if (mem.object.type !== "Identifier") continue;
      const component = readVarMap.get(mem.object.name);
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
        const mem = node;
        if (mem.computed) return;
        if (mem.object.type !== "Identifier") return;
        const varName = mem.object.name;
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
