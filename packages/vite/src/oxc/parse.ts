/**
 * @file OXC-parser wrapper — parses TypeScript/JavaScript source into an AST.
 */

import { parseSync } from 'oxc-parser';
import type { Program } from 'oxc-parser';

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * The result of a successful source parse.
 */
export interface ParseResult {
  /** The parsed OXC AST program node. */
  readonly program: Program;
  /** Whether the parser encountered any errors (warnings are not included). */
  readonly hasErrors: boolean;
}

// ─── API ─────────────────────────────────────────────────────────────────────

/**
 * Parse TypeScript/JavaScript source code using `oxc-parser`.
 *
 * Non-fatal parse errors are tolerated — the program is still returned with
 * `hasErrors: true`.  Returns `null` only when `oxc-parser` throws a
 * synchronous exception (i.e. a catastrophic, unrecoverable failure).
 *
 * @param filename - The file path (used for diagnostics and source maps).
 * @param source   - TypeScript/JavaScript source code to parse.
 * @returns `ParseResult` on success, or `null` on catastrophic failure.
 *
 * @example
 * ```ts
 * const result = parseSource('src/movement.ts', code);
 * if (!result) return [];
 * walk(result.program, { enter(node) { ... } });
 * ```
 */
export function parseSource(filename: string, source: string): ParseResult | null {
  try {
    const result = parseSync(filename, source);
    const hasErrors = result.errors !== null && result.errors.length > 0;
    return { program: result.program as Program, hasErrors };
  } catch {
    return null;
  }
}
