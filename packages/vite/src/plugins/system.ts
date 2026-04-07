import type { Plugin } from 'vite';
import MagicString from 'magic-string';
import { walk } from 'oxc-walker';
import type { VariableDeclarator, CallExpression } from 'oxc-parser';
import { parseSource, isCallTo, getCallArgs } from '../oxc/index.js';

/**
 * Transform `defineSystem` variable declarations to inject a name string as the
 * first argument, inferred from the declared variable name.
 *
 * Only applies when the first argument is not already a string literal, so
 * manually-named calls like `defineSystem('MySystem', () => {})` are left untouched.
 *
 * @param code     - TypeScript/JavaScript source code to transform.
 * @param filename - File path passed to the parser (used in diagnostics).
 * @returns Transformed source, or the original string if no changes were made.
 *
 * @example
 * ```ts
 * // Input:
 * export const ScoreSystem = defineSystem(() => { ... })
 * // Output:
 * export const ScoreSystem = defineSystem('ScoreSystem', () => { ... })
 * ```
 */
export function transformSystemNames(code: string, filename = 'unknown.ts'): string {
  if (!code.includes('defineSystem')) return code;

  const parsed = parseSource(filename, code);
  if (!parsed) return code;

  const s = new MagicString(code);
  let changed = false;

  walk(parsed.program, {
    enter(node) {
      if (node.type !== 'VariableDeclarator') return;
      const { id, init } = node as VariableDeclarator;
      if (id.type !== 'Identifier') return;
      if (!init) return;
      if (!isCallTo(init, 'defineSystem')) return;

      const varName = (id as { name: string }).name;
      const args = getCallArgs(init as CallExpression);

      // Skip if the first arg is already a string literal (name already explicit)
      // oxc-parser uses type 'Literal' for both string and numeric literals
      if (args.length > 0 && args[0]!.type === 'Literal') return;

      if (args.length > 0) {
        s.prependLeft(args[0]!.start, `'${varName}', `);
        changed = true;
      }
    },
  });

  return changed ? s.toString() : code;
}

/**
 * GWEN sub-plugin that injects debug names into `defineSystem()` calls.
 *
 * Transforms `export const ScoreSystem = defineSystem(() => { ... })` into
 * `export const ScoreSystem = defineSystem('ScoreSystem', () => { ... })` at
 * build time, so the engine can identify the system without requiring a manual
 * named-function form.
 *
 * Applies to all `.ts` / `.js` source files (excludes `.d.ts` and test files).
 *
 * @returns Vite plugin instance.
 */
export function gwenSystemPlugin(): Plugin {
  return {
    name: 'gwen:system',
    transform(code, id) {
      if (id.endsWith('.d.ts') || id.endsWith('.test.ts') || id.endsWith('.test.js')) return;
      if (!/\.(ts|js)x?$/.test(id)) return;
      if (!code.includes('defineSystem')) return;
      const transformed = transformSystemNames(code, id);
      if (transformed === code) return;
      return { code: transformed, map: null };
    },
  };
}
