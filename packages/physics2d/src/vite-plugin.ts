/**
 * @file gwen:physics2d — Vite plugin for layer inlining and bulk spawn detection.
 *
 * Registered automatically via physics2d module.ts.
 *
 * Optimizations:
 * 1. Layer inlining — detects `Layers.wall` patterns and replaces with literal values
 *    when `defineLayers({...})` is visible in the same file.
 * 2. Collision filter dead-code elimination — warns about unused layer combinations.
 */

import type { Plugin } from 'vite';
import MagicString from 'magic-string';
import {
  evalBitExpr,
  extractLayerDefinitions,
  inlineLayerReferences,
} from '@gwenjs/vite/shared/layer-utils';

// Re-export for backward compatibility (tests may import from here).
export { evalBitExpr, extractLayerDefinitions, inlineLayerReferences };

/** Options for `physics2dVitePlugin`. */
export interface Physics2DVitePluginOptions {
  debug?: boolean;
}

/**
 * `gwen:physics2d` — Vite plugin for physics 2D build-time optimizations.
 *
 * @param options - Plugin options.
 *
 * @example
 * ```ts
 * // Registered automatically by physics2d module.ts — no manual setup needed.
 * ```
 *
 * @since 1.0.0
 */
export function physics2dVitePlugin(options: Physics2DVitePluginOptions = {}): Plugin {
  return {
    name: 'gwen:physics2d',

    transform(code, id) {
      if (!/\.(ts|tsx|js|jsx)$/.test(id)) return;
      if (!code.includes('defineLayers')) return;

      const layerMap = extractLayerDefinitions(code);
      if (!layerMap) return;

      // Find the variable name and declaration positions for defineLayers
      const declRe = /const\s+(\w+)\s*=\s*defineLayers\s*\([^)]*\)\s*;?/;
      const varMatch = code.match(declRe);
      if (!varMatch) return;

      const varName = varMatch[1];
      const declStart = varMatch.index!;
      const declEnd = declStart + varMatch[0].length;

      const s = new MagicString(code);
      let replaced = false;

      // Overwrite each `VarName.layerName` reference with its literal value
      for (const [name, value] of layerMap) {
        const refRe = new RegExp(`\\b${varName}\\.${name}\\b`, 'g');
        let count = 0;
        for (const m of code.matchAll(refRe)) {
          s.overwrite(m.index!, m.index! + m[0].length, String(value));
          replaced = true;
          count++;
        }
        if (count === 0) {
          this.warn(
            `[gwen:physics2d] Layer "${name}" is defined but never referenced. Consider removing it.`,
          );
        }
      }

      if (!replaced) return null;

      // Remove the defineLayers declaration if the variable is no longer referenced
      // outside the declaration itself
      const transformed = s.toString();
      const beforeDecl = transformed.slice(0, declStart);
      const afterDecl = transformed.slice(declEnd);
      const varStillUsed = new RegExp(`\\b${varName}\\b`).test(beforeDecl + afterDecl);
      if (!varStillUsed) {
        s.remove(declStart, declEnd);
      }

      if (options.debug) {
        // eslint-disable-next-line no-console
        console.log(`[gwen:physics2d] Inlined ${layerMap.size} layer constants in ${id}`);
      }

      return {
        code: s.toString(),
        map: s.generateMap({ hires: true, source: id, includeContent: true }),
      };
    },
  };
}
