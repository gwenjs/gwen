import type { Plugin } from 'vite';
import { walk } from 'oxc-walker';
import type { ObjectExpression, ObjectProperty, StringLiteral } from 'oxc-parser';
import type { GwenViteOptions } from '../types.js';
import { parseSource, getObjectProperties, getPropertyKeyName } from '../oxc/index.js';

/**
 * Options for the `gwen:tween` sub-plugin.
 *
 * @since 1.0.0
 */
export interface GwenTweenOptions {
  /**
   * Disable easing tree-shake analysis.
   * When `true`, the virtual module `virtual:gwen/used-easings` will export
   * all easing names instead of only the ones detected in source files.
   *
   * @default false
   * @since 1.0.0
   */
  disableEasingAnalysis?: boolean;
}

/** Virtual module ID exposed to the user's code. */
const VIRTUAL_ID = 'virtual:gwen/used-easings';

/** Resolved internal module ID (prefixed with `\0` per Vite convention). */
const RESOLVED_ID = '\0' + VIRTUAL_ID;

/**
 * Extract all easing function names used in `easing: '...'` properties within
 * the source file. Uses AST parsing to avoid false positives in comments or strings.
 *
 * @param code     - TypeScript source code to scan.
 * @param filename - File path for the parser.
 * @returns Set of easing name strings found.
 *
 * @example
 * ```ts
 * extractUsedEasings(`useTween({ duration: 1, easing: 'easeOutQuad' })`);
 * // → Set { 'easeOutQuad' }
 * ```
 *
 * @since 1.0.0
 */
export function extractUsedEasings(code: string, filename = 'tween.ts'): Set<string> {
  const found = new Set<string>();
  if (!code.includes('easing')) return found;

  const parsed = parseSource(filename, code);
  if (!parsed) return found;

  walk(parsed.program, {
    enter(node) {
      if (node.type !== 'ObjectExpression') return;
      for (const prop of getObjectProperties(node as ObjectExpression)) {
        if (getPropertyKeyName(prop) !== 'easing') continue;
        const { value } = prop as ObjectProperty;
        // StringLiteral and NumericLiteral both have type: 'Literal'
        // Distinguish by typeof value — cast only after the runtime check
        if (value.type === 'Literal' && typeof (value as StringLiteral).value === 'string') {
          found.add((value as StringLiteral).value);
        }
      }
    },
  });

  return found;
}

/**
 * GWEN sub-plugin for easing tree-shake analysis.
 *
 * Scans user source files for `useTween()` calls and detects which
 * `EasingName` string literals are used as static values on the `easing:`
 * property. It exposes a virtual module `virtual:gwen/used-easings` that
 * exports only the detected easing names so bundlers can tree-shake the rest.
 *
 * **Virtual module usage:**
 * ```ts
 * import { usedEasings } from 'virtual:gwen/used-easings'
 * // e.g. ['linear', 'easeOutQuad']
 * ```
 *
 * @param options - Top-level GWEN Vite plugin options.
 * @returns Vite plugin instance.
 *
 * @since 1.0.0
 */
export function gwenTweenPlugin(options: GwenViteOptions = {}): Plugin {
  const disableEasingAnalysis = options.tween?.disableEasingAnalysis ?? false;

  /** Accumulated set of easing names detected across all transformed files. */
  const collectedEasings = new Set<string>();

  return {
    name: 'gwen:tween',

    buildStart() {
      // Reset collected easings at the start of every build so incremental
      // rebuilds don't accumulate stale entries from deleted files.
      collectedEasings.clear();
    },

    resolveId(id) {
      if (id === VIRTUAL_ID) {
        return RESOLVED_ID;
      }
    },

    load(id) {
      if (id !== RESOLVED_ID) return;

      const list = JSON.stringify([...collectedEasings].sort());
      return `export const usedEasings = ${list};\n`;
    },

    transform(code, id) {
      if (disableEasingAnalysis) return;
      // Only process TS/JS files.
      if (!/\.(ts|js|tsx|jsx)$/.test(id)) return;
      // Quick bail-out — skip files that cannot contain a useTween easing.
      if (!code.includes('useTween') && !code.includes('easing:')) return;

      const found = extractUsedEasings(code);
      for (const name of found) {
        collectedEasings.add(name);
      }
      // We only collect; no source transformation needed.
    },

    buildEnd() {
      if (this.environment?.mode === 'dev' || process.env['NODE_ENV'] === 'development') {
        const count = collectedEasings.size;
        const names = [...collectedEasings].sort().join(', ') || '(none)';
        // eslint-disable-next-line no-console
        console.info(`[gwen:tween] Detected ${count} easing(s): ${names}`);
      }
    },
  };
}
