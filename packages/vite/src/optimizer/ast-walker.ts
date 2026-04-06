/**
 * @file AST walker for detecting `useQuery + onUpdate` patterns inside
 * `defineSystem` bodies.  Used by the GWEN Vite optimizer to find ECS
 * query patterns that can be pre-compiled to bulk WASM calls.
 *
 * Uses `oxc-parser` for fast, accurate TypeScript parsing and `oxc-walker`
 * for AST traversal without Babel as a dependency.
 */

import { walk } from 'oxc-walker';
import type {
  CallExpression,
  ArrowFunctionExpression,
  Function as FunctionExpression,
  VariableDeclaration,
  VariableDeclarator,
  ForOfStatement,
  ExpressionStatement,
  ObjectExpression,
  ObjectProperty,
  StaticMemberExpression,
  BindingIdentifier,
  Statement,
} from 'oxc-parser';
import type { OptimizablePattern, PatternPositions } from './types.js';
import {
  parseSource,
  isCallTo,
  getCallArgs,
  getIdentifierName,
  getFunctionBodyStatements,
  getArrayElements,
  getObjectProperties,
  getPropertyKeyName,
} from '../oxc/index.js';

// ─── AstWalker ────────────────────────────────────────────────────────────────

/**
 * Walks a TypeScript source file AST to find `useQuery + onUpdate` patterns
 * that the optimizer can replace with bulk WASM calls.
 *
 * Detection strategy:
 * 1. Find `useQuery([ComponentA, ComponentB])` calls — extract component names.
 * 2. Find `onUpdate(() => { ... })` blocks — scan body for `useComponent` calls.
 * 3. Classify each `useComponent(e, Comp)` (2-arg) as a read, and
 *    `useComponent(e, Comp, newValue)` (3-arg) as a write.
 *
 * @example
 * ```ts
 * const walker = new AstWalker('src/systems/movement.ts');
 * const patterns = walker.walk(sourceCode);
 * // patterns[0].queryComponents → ['Position', 'Velocity']
 * ```
 */
export class AstWalker {
  /**
   * @param filename - Source file path; used for location metadata in patterns.
   */
  constructor(private readonly filename: string) {}

  /**
   * Parse and walk `source`, returning all detected `OptimizablePattern`
   * candidates.  Returns an empty array if the source has no `useQuery` calls
   * or cannot be parsed.
   *
   * @param source - TypeScript source code to analyze.
   * @returns Array of detected optimizable patterns (may be empty).
   */
  walk(source: string): OptimizablePattern[] {
    if (!source.includes('useQuery')) return [];

    const parsed = parseSource(this.filename, source);
    if (!parsed) return [];

    const patterns: OptimizablePattern[] = [];
    // Capture `filename` in a closure variable — inside the `walk` callback,
    // `this` refers to `WalkerThisContextEnter`, not `AstWalker`.
    const filename = this.filename;

    walk(parsed.program, {
      enter(node) {
        if (node.type !== 'CallExpression') return;
        const call = node as CallExpression;
        if (!isCallTo(call, 'defineSystem')) return;

        const args = getCallArgs(call);
        if (args.length === 0) return;
        const callback = args[0];
        if (callback.type !== 'ArrowFunctionExpression' && callback.type !== 'FunctionExpression') {
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
        // Do not recurse into the defineSystem callback body.
        this.skip();
      },
    });

    return patterns;
  }
}

// ─── Private helpers ──────────────────────────────────────────────────────────

/**
 * Extract component names from `useQuery([ComponentA, ComponentB])` calls
 * inside the outer function body.
 *
 * @param fn - The function/arrow expression body to search.
 * @returns Array of component identifier names found in `useQuery` calls.
 */
function extractQueryComponents(fn: FunctionExpression | ArrowFunctionExpression): string[] {
  const names: string[] = [];
  const stmts = getFunctionBodyStatements(fn);

  for (const stmt of stmts) {
    if (stmt.type !== 'VariableDeclaration') continue;
    const varDecl = stmt as VariableDeclaration;
    for (const decl of varDecl.declarations) {
      const varDeclarator = decl as VariableDeclarator;
      if (!varDeclarator.init) continue;
      if (!isCallTo(varDeclarator.init, 'useQuery')) continue;
      const callArgs = getCallArgs(varDeclarator.init as CallExpression);
      if (callArgs.length === 0) continue;
      for (const el of getArrayElements(callArgs[0]!)) {
        const name = getIdentifierName(el);
        if (name) names.push(name);
      }
    }
  }

  return names;
}

/**
 * Extract read and write component usage from `onUpdate` callback bodies.
 * Also extracts source positions (Phase 2) for bulk transformation.
 *
 * @param fn       - The `defineSystem` function containing `onUpdate` calls.
 * @param filename - Source filename for location metadata.
 * @returns Sets of read/write component names, source location of the
 *   `onUpdate` call, and optional source positions for bulk transformation.
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
    if (stmt.type !== 'ExpressionStatement') continue;
    const exprStmt = stmt as ExpressionStatement;
    if (exprStmt.expression.type !== 'CallExpression') continue;
    if (!isCallTo(exprStmt.expression as CallExpression, 'onUpdate')) continue;

    // OXC provides byte spans (.start/.end), not line/column.
    // The optimizer only uses this for human-readable diagnostics, so
    // defaulting to line 1 is acceptable.
    loc = { line: 1, column: 0, file: filename };

    const updateArgs = getCallArgs(exprStmt.expression as CallExpression);
    if (updateArgs.length === 0) continue;
    const updateCb = updateArgs[0]!;
    if (updateCb.type !== 'ArrowFunctionExpression' && updateCb.type !== 'FunctionExpression') {
      continue;
    }

    const onUpdateCb = updateCb as FunctionExpression | ArrowFunctionExpression;

    const innerStmts = getFunctionBodyStatements(onUpdateCb);
    for (const innerStmt of innerStmts) {
      collectUseComponentCalls(innerStmt, reads, writes);
    }

    // Phase 2: build the read-variable → component map and extract source positions
    // for BulkTransformer to perform MagicString-based code rewrites.
    const readVarMap = buildReadVarMap(onUpdateCb, filename);
    positions = extractForOfPositions(onUpdateCb, readVarMap, filename);
  }

  return { readComponents: [...reads], writeComponents: [...writes], loc, positions };
}

/**
 * Recursively collect `useComponent` read and write calls from a statement.
 * Handles `for-of` loops that wrap the component access calls.
 *
 * Classification:
 * - `useComponent(entity, Comp)` — **read** (2 args)
 * - `useComponent(entity, Comp, value)` — **write** (3 args)
 *
 * @param node   - AST statement node to inspect.
 * @param reads  - Accumulator set for read component names.
 * @param writes - Accumulator set for write component names.
 */
function collectUseComponentCalls(node: Statement, reads: Set<string>, writes: Set<string>): void {
  // Recurse into for-of loop bodies (the common ECS iteration pattern).
  if (node.type === 'ForOfStatement') {
    const forOf = node as ForOfStatement;
    if (forOf.body.type === 'BlockStatement') {
      const block = forOf.body as unknown as { body: Statement[] };
      for (const s of block.body) collectUseComponentCalls(s, reads, writes);
    }
    return;
  }

  // `const pos = useComponent(e, Position)` — read (2 args)
  if (node.type === 'VariableDeclaration') {
    const varDecl = node as VariableDeclaration;
    for (const decl of varDecl.declarations) {
      const d = decl as VariableDeclarator;
      if (!d.init || d.init.type !== 'CallExpression') continue;
      if (!isCallTo(d.init as CallExpression, 'useComponent')) continue;
      const args = getCallArgs(d.init as CallExpression);
      if (args.length >= 2) {
        const name = getIdentifierName(args[1]!);
        if (name) reads.add(name);
      }
    }
  }

  // `useComponent(e, Position, newValue)` — write (3 args)
  if (node.type === 'ExpressionStatement') {
    const exprStmt = node as ExpressionStatement;
    if (exprStmt.expression.type !== 'CallExpression') return;
    const call = exprStmt.expression as CallExpression;
    if (!isCallTo(call, 'useComponent')) return;
    const args = getCallArgs(call);
    if (args.length >= 3) {
      const name = getIdentifierName(args[1]!);
      if (name) writes.add(name);
    }
  }
}

// ─── Phase 2 helpers ──────────────────────────────────────────────────────────

/**
 * Scan the body of an `onUpdate` callback (including any for-of loop body) and
 * build a map from read-variable names to their component names.
 *
 * Example: `const pos = useComponent(e, Position)` → `{ 'pos' → 'Position' }`.
 *
 * @param onUpdateCallback - The `onUpdate(() => { ... })` arrow/function expression.
 * @param _filename        - Source filename (reserved for future diagnostics).
 * @returns Map of variable name → component name for all 2-argument `useComponent` reads.
 */
function buildReadVarMap(
  onUpdateCallback: FunctionExpression | ArrowFunctionExpression,
  _filename: string,
): Map<string, string> {
  const map = new Map<string, string>();

  function collect(statements: Statement[]): void {
    for (const s of statements) {
      // Recurse into for-of bodies (reads live inside the loop).
      if (s.type === 'ForOfStatement') {
        const forOf = s as ForOfStatement;
        if (forOf.body.type === 'BlockStatement') {
          collect((forOf.body as unknown as { body: Statement[] }).body);
        }
        continue;
      }

      // `const varName = useComponent(e, ComponentName)` — 2-arg read
      if (s.type !== 'VariableDeclaration') continue;
      const varDecl = s as VariableDeclaration;
      for (const decl of varDecl.declarations) {
        const d = decl as VariableDeclarator;
        if (!d.init || d.init.type !== 'CallExpression') continue;
        if (!isCallTo(d.init as CallExpression, 'useComponent')) continue;
        const args = getCallArgs(d.init as CallExpression);
        if (args.length !== 2) continue; // exactly 2 args = read
        if (d.id.type !== 'Identifier') continue;
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
 * source byte-offset positions needed by `BulkTransformer` to rewrite the pattern.
 *
 * Returns `undefined` when:
 * - No `ForOfStatement` is found in the callback body.
 * - The for-of `left` side is not a `VariableDeclaration`.
 * - The loop body is not a `BlockStatement`.
 *
 * @param onUpdateCallback - The `onUpdate(() => { ... })` function expression.
 * @param readVarMap       - Map of read-variable name → component name (from `buildReadVarMap`).
 * @param _filename        - Source filename (reserved for future diagnostics).
 * @returns Extracted source positions, or `undefined` if the pattern is unrecognised.
 */
function extractForOfPositions(
  onUpdateCallback: FunctionExpression | ArrowFunctionExpression,
  readVarMap: Map<string, string>,
  _filename: string,
): PatternPositions | undefined {
  const stmts = getFunctionBodyStatements(onUpdateCallback);

  for (const stmt of stmts) {
    if (stmt.type !== 'ForOfStatement') continue;
    const forOf = stmt as ForOfStatement;

    // entityVar — the `e` in `for (const e of entities)`
    if (forOf.left.type !== 'VariableDeclaration') continue;
    const leftDecl = forOf.left as VariableDeclaration;
    if (leftDecl.declarations.length === 0) continue;
    const firstDecl = leftDecl.declarations[0] as VariableDeclarator;
    if (firstDecl.id.type !== 'Identifier') continue;
    const entityVar = (firstDecl.id as BindingIdentifier).name;

    // forBodyStart — byte offset of the `{` opening the BlockStatement
    if (forOf.body.type !== 'BlockStatement') continue;
    const forBodyStart = forOf.body.start;
    const forOfStart = forOf.start;
    const forOfEnd = forOf.end;

    // Scan the loop body for read-declarations and write-calls
    const bodyStmts = (forOf.body as unknown as { body: Statement[] }).body;
    const readDecls: { varName: string; component: string; start: number; end: number }[] = [];
    const writeCalls: {
      component: string;
      fields: { name: string; valueStart: number; valueEnd: number }[];
      start: number;
      end: number;
    }[] = [];

    for (const s of bodyStmts) {
      // readDecl: `const pos = useComponent(e, Position)` — 2-arg call
      if (s.type === 'VariableDeclaration') {
        const varDecl = s as VariableDeclaration;
        for (const decl of varDecl.declarations) {
          const d = decl as VariableDeclarator;
          if (!d.init || d.init.type !== 'CallExpression') continue;
          if (!isCallTo(d.init as CallExpression, 'useComponent')) continue;
          const args = getCallArgs(d.init as CallExpression);
          if (args.length !== 2) continue; // 2-arg = read
          if (d.id.type !== 'Identifier') continue;
          const varName = (d.id as BindingIdentifier).name;
          const component = getIdentifierName(args[1]!);
          if (!component) continue;
          readDecls.push({ varName, component, start: s.start, end: s.end });
        }
      }

      // writeCall: `useComponent(e, Position, { x: ..., y: ... })` — 3-arg call
      if (s.type === 'ExpressionStatement') {
        const exprStmt = s as ExpressionStatement;
        if (exprStmt.expression.type !== 'CallExpression') continue;
        const call = exprStmt.expression as CallExpression;
        if (!isCallTo(call, 'useComponent')) continue;
        const args = getCallArgs(call);
        if (args.length !== 3) continue; // 3-arg = write
        const component = getIdentifierName(args[1]!);
        if (!component) continue;
        const objArg = args[2]!;
        if (objArg.type !== 'ObjectExpression') continue;
        const fields: { name: string; valueStart: number; valueEnd: number }[] = [];
        for (const prop of getObjectProperties(objArg as ObjectExpression)) {
          const key = getPropertyKeyName(prop as ObjectProperty);
          if (!key) continue;
          const propNode = prop as ObjectProperty;
          fields.push({
            name: key,
            valueStart: propNode.value.start,
            valueEnd: propNode.value.end,
          });
        }
        writeCalls.push({ component, fields, start: s.start, end: s.end });
      }
    }

    // propAccesses — all `varName.fieldName` member expressions in the loop body
    // where `varName` is in `readVarMap`. Excludes nodes inside write-call ranges
    // (those will be removed, not rewritten).
    const propAccesses: { varName: string; fieldName: string; start: number; end: number }[] = [];
    const writeCallRanges = writeCalls.map((w) => ({ start: w.start, end: w.end }));

    walk(forOf.body, {
      enter(node) {
        if (node.type !== 'MemberExpression') return;
        // Cast to StaticMemberExpression: only non-computed member access (varName.field)
        const mem = node as StaticMemberExpression;
        if (mem.computed) return;
        if (mem.object.type !== 'Identifier') return;
        // After type guard, `.name` is accessible via cast to the Identifier sub-type
        const varName = (mem.object as BindingIdentifier).name;
        if (!readVarMap.has(varName)) return;
        const fieldName = mem.property.name;
        // Skip member expressions that are inside a write-call range — they will be
        // deleted wholesale rather than individually rewritten.
        const isInWriteCall = writeCallRanges.some(
          (r) => node.start >= r.start && node.end <= r.end,
        );
        if (isInWriteCall) return;
        propAccesses.push({ varName, fieldName, start: node.start, end: node.end });
      },
    });

    return {
      forOfStart,
      forBodyStart,
      forOfEnd,
      entityVar,
      readDecls,
      writeCalls,
      propAccesses,
    };
  }

  return undefined;
}
