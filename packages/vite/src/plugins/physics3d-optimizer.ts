/**
 * @file `gwen:physics3d-optimizer` Vite plugin — Phase 1.
 *
 * Detects imperative spatial query calls (`physics.castRay`, `physics.castShape`,
 * `physics.overlapShape`) inside `onUpdate`/`onBeforeUpdate`/`onAfterUpdate`
 * callbacks and emits Vite build warnings to guide developers toward the
 * composable query system (`useRaycast`, `useShapeCast`, etc.).
 */

import type { Plugin } from 'vite';
import { PhysicsQueryWalker } from '../optimizer/physics-walker.js';
import type { PhysicsMethod } from '../optimizer/physics-walker.js';

// ─── Options ─────────────────────────────────────────────────────────────────

/**
 * Options for {@link gwenPhysics3DOptimizerPlugin}.
 */
export interface GwenPhysics3DOptimizerOptions {
  /**
   * Plugin operating mode.
   *
   * - `'warn'` (default, Phase 1): emit Vite warnings for detected anti-patterns
   *   without modifying source code.
   * - `'transform'` (Phase 2, not yet implemented): rewrite imperative calls to
   *   composable equivalents.
   *
   * @default 'warn'
   */
  mode?: 'warn' | 'transform';

  /**
   * Enable verbose logging of detected patterns to the console.
   * @default false
   */
  debug?: boolean;

  /**
   * File extensions to analyse.  Only files ending with one of these
   * extensions are processed by the transform hook.
   *
   * @default ['.ts', '.tsx']
   */
  extensions?: string[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Maps each imperative physics method to its composable equivalent.
 * Used to produce actionable warning messages.
 */
const METHOD_TO_COMPOSABLE: Record<PhysicsMethod, string> = {
  castRay: 'useRaycast',
  castShape: 'useShapeCast',
  overlapShape: 'useOverlap',
};

// ─── Plugin ───────────────────────────────────────────────────────────────────

/**
 * `gwen:physics3d-optimizer` — opt-in Vite plugin that warns about imperative
 * physics query calls made inside hot-path frame-loop callbacks.
 *
 * **Phase 1 (warn only):** detects `physics.castRay`, `physics.castShape`, and
 * `physics.overlapShape` inside `onUpdate` / `onBeforeUpdate` / `onAfterUpdate`
 * and emits a Vite warning pointing developers to the equivalent composable.
 *
 * **Opt-in:** this plugin is NOT included in `gwenVitePlugin()` automatically.
 * Add it explicitly to your Vite config:
 *
 * ```ts
 * // vite.config.ts
 * import { gwenVitePlugin, gwenPhysics3DOptimizerPlugin } from '@gwenjs/vite';
 *
 * export default defineConfig({
 *   plugins: [
 *     gwenVitePlugin(),
 *     gwenPhysics3DOptimizerPlugin({ debug: true }), // ← opt-in
 *   ],
 * });
 * ```
 *
 * @param options - Plugin configuration options.
 * @returns A Vite plugin instance.
 */
export function gwenPhysics3DOptimizerPlugin(options: GwenPhysics3DOptimizerOptions = {}): Plugin {
  const { mode = 'warn', debug = false, extensions = ['.ts', '.tsx'] } = options;

  if (mode === 'transform') {
    console.warn(
      '[gwen:physics3d-optimizer] mode: "transform" is not yet implemented. ' +
        'Falling back to mode: "warn".',
    );
  }

  return {
    name: 'gwen:physics3d-optimizer',
    enforce: 'pre',

    /**
     * Analyse TypeScript files for imperative physics query anti-patterns.
     *
     * Skips files that do not match the configured extensions, and skips any
     * file whose source does not contain any of the watched method names (fast
     * bailout before parsing).
     *
     * Phase 1: emits Vite warnings only; source is never modified (returns `null`).
     *
     * @param code - Source code of the module being transformed.
     * @param id   - Resolved module ID (file path).
     * @returns `null` — this plugin never modifies source in Phase 1.
     */
    transform(code: string, id: string) {
      if (!extensions.some((ext) => id.endsWith(ext))) return null;

      // Fast bailout: skip files with none of the target method names.
      if (
        !code.includes('castRay') &&
        !code.includes('castShape') &&
        !code.includes('overlapShape')
      ) {
        return null;
      }

      const walker = new PhysicsQueryWalker(id);
      const patterns = walker.walk(code);

      for (const pattern of patterns) {
        const message =
          `[gwen:physics3d-optimizer] Imperative physics query detected in hot path. ` +
          `physics.${pattern.method}() was called inside ${pattern.callbackType}() ` +
          `in ${pattern.filename} (offset ${pattern.start}–${pattern.end}). ` +
          `Replace with \`${METHOD_TO_COMPOSABLE[pattern.method]}()\` for zero-copy SAB reads.`;

        if (debug) {
          console.warn(message);
        }

        this.warn(message);
      }

      return null;
    },
  };
}
