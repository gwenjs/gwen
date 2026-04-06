/**
 * @file AST walker for detecting imperative spatial query calls
 * (`physics.castRay`, `physics.castShape`, `physics.overlapShape`) inside
 * frame-loop callbacks (`onUpdate`, `onBeforeUpdate`, `onAfterUpdate`) within
 * `defineSystem` bodies.
 *
 * Used by the GWEN Vite physics3d optimizer to emit warnings about anti-patterns
 * that bypass the composable query system.
 */

import { walk } from 'oxc-walker';
import type {
  CallExpression,
  ArrowFunctionExpression,
  Function as FunctionExpression,
  ExpressionStatement,
  StaticMemberExpression,
  IdentifierName,
  Statement,
  VariableDeclaration,
  VariableDeclarator,
  IfStatement,
} from 'oxc-parser';
import { parseSource, isCallTo, getCallArgs, getFunctionBodyStatements } from '../oxc/index.js';

// ─── Types ────────────────────────────────────────────────────────────────────

/** The imperative physics query methods that should be called via composables. */
export type PhysicsMethod = 'castRay' | 'castShape' | 'overlapShape';

/** The frame-loop callback names in which imperative calls are anti-patterns. */
export type PhysicsCallbackType = 'onUpdate' | 'onBeforeUpdate' | 'onAfterUpdate';

/**
 * A detected imperative physics query call inside a frame-loop callback.
 */
export interface PhysicsQueryPattern {
  /** The physics method that was called imperatively. */
  readonly method: PhysicsMethod;
  /** The frame-loop callback that contains the call. */
  readonly callbackType: PhysicsCallbackType;
  /** Byte offset of the start of the call expression in the source. */
  readonly start: number;
  /** Byte offset of the end of the call expression in the source. */
  readonly end: number;
  /** The source file path this pattern was found in. */
  readonly filename: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PHYSICS_METHODS: ReadonlySet<string> = new Set(['castRay', 'castShape', 'overlapShape']);
const CALLBACK_TYPES: ReadonlySet<string> = new Set([
  'onUpdate',
  'onBeforeUpdate',
  'onAfterUpdate',
]);

// ─── PhysicsQueryWalker ───────────────────────────────────────────────────────

/**
 * Walks a TypeScript source file AST to find imperative physics query calls
 * (`physics.castRay`, `physics.castShape`, `physics.overlapShape`) inside
 * frame-loop callbacks (`onUpdate`, `onBeforeUpdate`, `onAfterUpdate`) within
 * `defineSystem` bodies.
 *
 * Calls made at the setup level (outside any frame-loop callback) are NOT
 * flagged — only calls inside the hot path are anti-patterns.
 *
 * @example
 * ```ts
 * const walker = new PhysicsQueryWalker('src/systems/combat.ts');
 * const patterns = walker.walk(sourceCode);
 * // patterns[0].method    → 'castRay'
 * // patterns[0].callbackType → 'onUpdate'
 * ```
 */
export class PhysicsQueryWalker {
  /**
   * @param filename - Source file path; used for location metadata in patterns.
   */
  constructor(private readonly filename: string) {}

  /**
   * Parse and walk `source`, returning all detected imperative physics query
   * patterns inside frame-loop callbacks.
   *
   * Performs a fast string pre-scan before parsing to avoid unnecessary work
   * on files that cannot contain the target patterns.
   *
   * @param source - TypeScript source code to analyze.
   * @returns Array of detected patterns (may be empty).
   */
  walk(source: string): PhysicsQueryPattern[] {
    // Fast pre-scan: skip files that contain none of the target method names.
    if (
      !source.includes('castRay') &&
      !source.includes('castShape') &&
      !source.includes('overlapShape')
    ) {
      return [];
    }

    const parsed = parseSource(this.filename, source);
    if (!parsed) return [];

    const patterns: PhysicsQueryPattern[] = [];
    const filename = this.filename;

    walk(parsed.program, {
      enter(node) {
        if (node.type !== 'CallExpression') return;
        const call = node as CallExpression;
        if (!isCallTo(call, 'defineSystem')) return;

        const args = getCallArgs(call);
        if (args.length === 0) return;
        const callback = args[0]!;
        if (callback.type !== 'ArrowFunctionExpression' && callback.type !== 'FunctionExpression') {
          return;
        }

        const setupFn = callback as ArrowFunctionExpression | FunctionExpression;
        const setupStmts = getFunctionBodyStatements(setupFn);

        for (const stmt of setupStmts) {
          if (stmt.type !== 'ExpressionStatement') continue;
          const exprStmt = stmt as ExpressionStatement;
          if (exprStmt.expression.type !== 'CallExpression') continue;
          const innerCall = exprStmt.expression as CallExpression;

          // Check if this is one of the frame-loop callback registrations.
          const callbackName = getDirectCalleeName(innerCall);
          if (!callbackName || !CALLBACK_TYPES.has(callbackName)) continue;

          const cbArgs = getCallArgs(innerCall);
          if (cbArgs.length === 0) continue;
          const cbFn = cbArgs[0]!;
          if (cbFn.type !== 'ArrowFunctionExpression' && cbFn.type !== 'FunctionExpression') {
            continue;
          }

          const loopFn = cbFn as ArrowFunctionExpression | FunctionExpression;
          const loopStmts = getFunctionBodyStatements(loopFn);

          for (const loopStmt of loopStmts) {
            collectPhysicsCalls(loopStmt, callbackName as PhysicsCallbackType, filename, patterns);
          }
        }

        // Do not recurse further into defineSystem — we've handled it above.
        this.skip();
      },
    });

    return patterns;
  }
}

// ─── Private helpers ──────────────────────────────────────────────────────────

/**
 * Return the callee identifier name if `call` is a direct (non-member) call,
 * e.g. `onUpdate(...)`.  Returns `null` for member calls like `obj.method()`.
 *
 * @param call - The call expression to inspect.
 * @returns The callee identifier name, or `null`.
 */
function getDirectCalleeName(call: CallExpression): string | null {
  if (call.callee.type !== 'Identifier') return null;
  return (call.callee as IdentifierName).name;
}

/**
 * Recursively scan a statement for `physics.<method>(...)` calls and push any
 * found patterns into `out`.  Recurses into nested block statements.
 *
 * @param node         - The statement to inspect.
 * @param callbackType - The enclosing frame-loop callback name.
 * @param filename     - Source file path for pattern metadata.
 * @param out          - Accumulator array for detected patterns.
 */
function collectPhysicsCalls(
  node: Statement,
  callbackType: PhysicsCallbackType,
  filename: string,
  out: PhysicsQueryPattern[],
): void {
  switch (node.type) {
    case 'ExpressionStatement': {
      const exprStmt = node as ExpressionStatement;
      if (exprStmt.expression.type === 'CallExpression') {
        checkCallExprForPhysics(exprStmt.expression as CallExpression, callbackType, filename, out);
      }
      break;
    }
    case 'VariableDeclaration': {
      const varDecl = node as VariableDeclaration;
      for (const decl of varDecl.declarations) {
        const d = decl as VariableDeclarator;
        if (d.init && d.init.type === 'CallExpression') {
          checkCallExprForPhysics(d.init as CallExpression, callbackType, filename, out);
        }
      }
      break;
    }
    case 'BlockStatement': {
      const block = node as unknown as { body: Statement[] };
      for (const s of block.body) {
        collectPhysicsCalls(s, callbackType, filename, out);
      }
      break;
    }
    case 'IfStatement': {
      const ifStmt = node as IfStatement;
      collectPhysicsCalls(ifStmt.consequent, callbackType, filename, out);
      if (ifStmt.alternate) {
        collectPhysicsCalls(ifStmt.alternate, callbackType, filename, out);
      }
      break;
    }
    case 'ReturnStatement': {
      const retStmt = node as unknown as { argument?: Statement };
      if (retStmt.argument) {
        collectPhysicsCalls(retStmt.argument, callbackType, filename, out);
      }
      break;
    }
    case 'ForOfStatement':
    case 'ForInStatement':
    case 'ForStatement':
    case 'WhileStatement':
    case 'DoWhileStatement': {
      const loopStmt = node as unknown as { body: Statement };
      collectPhysicsCalls(loopStmt.body, callbackType, filename, out);
      break;
    }
    default:
      break;
  }
}

/**
 * Check a `CallExpression` to see if it is a `physics.<method>(...)` call
 * where `method` is one of the imperative physics query methods.  If so, push
 * a pattern into `out`.
 *
 * @param call         - The call expression to inspect.
 * @param callbackType - The enclosing frame-loop callback name.
 * @param filename     - Source file path for pattern metadata.
 * @param out          - Accumulator array for detected patterns.
 */
function checkCallExprForPhysics(
  call: CallExpression,
  callbackType: PhysicsCallbackType,
  filename: string,
  out: PhysicsQueryPattern[],
): void {
  if (call.callee.type !== 'MemberExpression') return;
  // Cast to StaticMemberExpression: only non-computed member access (physics.method)
  const mem = call.callee as StaticMemberExpression;
  if (mem.computed) return;

  // Only flag calls on the physics service object (physics or physics3d).
  if (mem.object.type !== 'Identifier') return;
  const objectName = (mem.object as IdentifierName).name;
  if (objectName !== 'physics' && objectName !== 'physics3d') return;

  const methodName = mem.property.name;
  if (!PHYSICS_METHODS.has(methodName)) return;

  out.push({
    method: methodName as PhysicsMethod,
    callbackType,
    start: call.start,
    end: call.end,
    filename,
  });
}
