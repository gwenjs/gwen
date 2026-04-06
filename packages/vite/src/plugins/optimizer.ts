import type { Plugin } from 'vite';
import MagicString from 'magic-string';
import { ComponentManifest } from '../optimizer/component-manifest.js';
import { AstWalker } from '../optimizer/ast-walker.js';
import { PatternDetector } from '../optimizer/pattern-detector.js';
import { ComponentScanner, findComponentFiles } from '../optimizer/component-scanner.js';
import { applyBulkTransform } from '../optimizer/bulk-transformer.js';
import type { WasmTier } from '../optimizer/types.js';

/** Options for `gwenOptimizerPlugin`. */
export interface GwenOptimizerOptions {
  /**
   * Enable verbose logging of detected and transformed patterns.
   * @default false
   */
  debug?: boolean;
  /**
   * Override the WASM tier for generated code.
   * Auto-detected from installed packages if not set.
   * @default 'core'
   */
  tier?: WasmTier;
  /**
   * Directory (relative to project root) to scan for `defineComponent` calls.
   * @default 'src'
   */
  componentsDir?: string;
}

/**
 * `gwen:optimizer` — opt-in Vite plugin that transforms ergonomic ECS systems
 * into zero-copy bulk WASM calls at build time.
 *
 * **Opt-in:** This plugin is NOT automatically included in `gwenVitePlugin()`.
 * Add it explicitly to your Vite config:
 *
 * ```ts
 * // vite.config.ts
 * import { gwenVitePlugin, gwenOptimizerPlugin } from '@gwenjs/vite'
 *
 * export default defineConfig({
 *   plugins: [
 *     gwenVitePlugin(),
 *     gwenOptimizerPlugin({ debug: true }), // ← opt-in
 *   ],
 * })
 * ```
 *
 * @performance
 * For 1000 entities, replaces N WASM boundary crossings with 1-2 per frame.
 * Benchmark target: < 0.5ms/frame for 10K entities (vs ~35ms naive).
 *
 * @phase Phase 1 — detection and classification scaffold.
 * Code rewriting (AST output back to source) is a Phase 2 concern.
 *
 * @param options - Plugin configuration options.
 * @returns A Vite plugin instance.
 */
export function gwenOptimizerPlugin(options: GwenOptimizerOptions = {}): Plugin {
  // tier will be used in Phase 2 when code generation is performed
  const { debug = false } = options;
  const _tier: WasmTier = options.tier ?? 'core';

  const manifest = new ComponentManifest();
  let _root = process.cwd();

  return {
    name: 'gwen:optimizer',

    /**
     * Capture the resolved project root so `buildStart` can locate `componentsDir`.
     *
     * @internal Called by Vite after the config is resolved.
     */
    configResolved(config) {
      _root = config.root;
    },

    /**
     * Reset the component manifest at build start, then scan `componentsDir` for
     * all `defineComponent(...)` calls and populate the manifest.
     *
     * @internal Called by Vite at build start (and on server restart in dev).
     */
    async buildStart() {
      manifest.clear();
      const compDir = `${_root}/${options.componentsDir ?? 'src'}`;
      const files = findComponentFiles(compDir);
      const scanner = new ComponentScanner(manifest);
      await scanner.scanFiles(files);
      if (debug) {
        console.log(`[gwen:optimizer] buildStart — ${manifest.size} component(s) registered`);
        for (const entry of manifest.entries()) {
          console.log(`  ${entry.name}: typeId=${entry.typeId}, stride=${entry.f32Stride}`);
        }
      }
    },

    /**
     * Transform TypeScript system files: detect optimizable patterns and log them.
     *
     * Only processes `.ts` and `.tsx` files. Non-matching or unoptimizable files
     * return `null` (Vite convention: null = skip transformation).
     *
     * Phase 1: detection and classification only.
     * Phase 2 will perform AST-based code replacement and return transformed source.
     *
     * @param code - The source code of the file being transformed.
     * @param id   - The resolved file path / module ID.
     * @returns `null` to skip, or `{ code, map }` when a pattern was transformed.
     */
    transform(code: string, id: string) {
      if (!id.endsWith('.ts') && !id.endsWith('.tsx')) return null;
      if (!code.includes('useQuery') || !code.includes('onUpdate')) return null;

      const walker = new AstWalker(id);
      const patterns = walker.walk(code);

      if (patterns.length === 0) return null;

      const detector = new PatternDetector(manifest);
      const s = new MagicString(code);
      let transformed = false;

      for (const pattern of patterns) {
        const result = detector.classify(pattern);
        if (!result.optimizable) {
          if (debug) console.log(`[gwen:optimizer] Skipping in ${id}: ${result.reason}`);
          continue;
        }
        if (debug)
          console.log(
            `[gwen:optimizer] Transforming pattern in ${id}:`,
            pattern.queryComponents.join(', '),
          );
        if (applyBulkTransform(s, pattern, manifest, _tier)) transformed = true;
      }

      if (!transformed) return null;
      return {
        code: s.toString(),
        map: s.generateMap({ hires: true, source: id, includeContent: true }),
      };
    },
  };
}
