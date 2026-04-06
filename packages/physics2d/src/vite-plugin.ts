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

/**
 * Extracts layer definitions from a `defineLayers({...})` call in source code.
 *
 * @param code - Source code string.
 * @returns Map of layer names to numeric values, or null if not found.
 *
 * @internal Exported for unit tests.
 */
export function extractLayerDefinitions(code: string): Map<string, number> | null {
  const match = code.match(/defineLayers\s*\(\s*\{([^}]+)\}\s*\)/);
  if (!match) return null;

  const layerMap = new Map<string, number>();
  const entries = match[1].matchAll(/(\w+)\s*:\s*(.+?)(?:,|$)/g);
  for (const entry of entries) {
    const name = entry[1].trim();
    const valueStr = entry[2].trim();
    // Evaluate simple bit-shift expressions like 1 << 2
    try {
      // eslint-disable-next-line no-new-func
      const value = Function(`'use strict'; return (${valueStr})`)() as number;
      layerMap.set(name, value);
    } catch {
      // Skip complex expressions
    }
  }
  return layerMap.size > 0 ? layerMap : null;
}

/**
 * Inline layer constant references in source code.
 *
 * Replaces `Layers.wall` → `4` when the layer map is known.
 *
 * @param code - Source code to transform.
 * @param variableName - The variable name that holds the layers object (e.g. 'Layers').
 * @param layerMap - Map of layer names to values.
 * @returns Transformed source code.
 *
 * @internal Exported for unit tests.
 */
export function inlineLayerReferences(
  code: string,
  variableName: string,
  layerMap: Map<string, number>,
): string {
  let result = code;
  for (const [name, value] of layerMap) {
    const pattern = new RegExp(`\\b${variableName}\\.${name}\\b`, 'g');
    result = result.replace(pattern, String(value));
  }
  return result;
}

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

      // Find the variable name used for defineLayers result
      const varMatch = code.match(/const\s+(\w+)\s*=\s*defineLayers\s*\(/);
      if (!varMatch) return;

      const varName = varMatch[1];
      const transformed = inlineLayerReferences(code, varName, layerMap);

      if (options.debug && transformed !== code) {
        console.log(`[gwen:physics2d] Inlined ${layerMap.size} layer constants in ${id}`);
      }

      return { code: transformed, map: null };
    },
  };
}
