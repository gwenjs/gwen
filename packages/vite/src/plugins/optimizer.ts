import type { Plugin } from "vite";
import MagicString from "magic-string";
import { ComponentManifest } from "../optimizer/component-manifest.js";
import { AstWalker } from "../optimizer/ast-walker.js";
import { PatternDetector } from "../optimizer/pattern-detector.js";
import { ComponentScanner, findComponentFiles } from "../optimizer/component-scanner.js";
import { applyBulkTransform } from "../optimizer/bulk-transformer.js";
import type { WasmTier } from "../optimizer/types.js";

/** Options for `gwenOptimizerPlugin`. */
export interface GwenOptimizerOptions {
  /**
   * Enable verbose logging of detected and transformed patterns.
   * @default false
   */
  debug?: boolean;
  /**
   * Controls the optimizer behaviour.
   * - `'detect'` — scan and log optimizable patterns without modifying code.
   *   Useful for auditing a codebase before enabling full optimization.
   * - `'transform'` — detect and rewrite patterns to bulk WASM calls (default when
   *   the plugin is used standalone via `gwenOptimizerPlugin()`).
   * @default 'transform'
   */
  mode?: "detect" | "transform";
  /**
   * Override the WASM tier for generated code.
   * Defaults to `'core'`; set to `'physics2d'` or `'physics3d'` when using the
   * corresponding GWEN physics packages.
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
 * Detects `useQuery + onUpdate + useComponent` patterns inside `defineSystem`
 * bodies and rewrites them to use `queryReadBulk` / `queryWriteBulk` — reducing
 * JS↔WASM boundary crossings from 3N to 4 per frame (regardless of entity count).
 *
 * **Opt-in:** Add explicitly to your Vite config alongside `gwenVitePlugin()`:
 *
 * ```ts
 * import { gwenVitePlugin, gwenOptimizerPlugin } from '@gwenjs/vite'
 *
 * export default defineConfig({
 *   plugins: [
 *     gwenVitePlugin(),
 *     gwenOptimizerPlugin({ debug: true }),
 *   ],
 * })
 * ```
 *
 * **What it transforms:**
 *
 * Before (ergonomic, 3N WASM crossings per frame):
 * ```ts
 * for (const e of entities) {
 *   const pos = useComponent(e, Position)
 *   useComponent(e, Position, { x: pos.x + vel.x * dt, y: pos.y + vel.y * dt })
 * }
 * ```
 *
 * After (optimized, 4 WASM crossings total):
 * ```ts
 * const { entityCount: _count_position, data: _position, slots: _slots, gens: _gens } =
 *   __gwen_bridge__.queryReadBulk([1, 2], 1, 2);
 * for (let _i = 0; _i < _count_position; _i++) {
 *   _position[_i * 2 + 0] += _velocity[_i * 2 + 0] * dt;
 *   _position[_i * 2 + 1] += _velocity[_i * 2 + 1] * dt;
 * }
 * __gwen_bridge__.queryWriteBulk(_slots, _gens, 1, _position);
 * ```
 *
 * **Constraints:** Only components with numeric fields (f32, i32, u32, bool) are
 * eligible. Components with string or object fields are skipped with a debug log.
 *
 * @param options - Plugin configuration options.
 * @returns A Vite plugin instance.
 */
export function gwenOptimizerPlugin(options: GwenOptimizerOptions = {}): Plugin {
  const { debug = false, mode = "transform" } = options;
  const _tier: WasmTier = options.tier ?? "core";

  const manifest = new ComponentManifest();
  let _root = process.cwd();

  return {
    name: "gwen:optimizer",

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
      const compDir = `${_root}/${options.componentsDir ?? "src"}`;
      const files = findComponentFiles(compDir);
      const scanner = new ComponentScanner(manifest);
      await scanner.scanFiles(files);
      if (debug) {
        // eslint-disable-next-line no-console
        console.log(`[gwen:optimizer] buildStart — ${manifest.size} component(s) registered`);
        for (const entry of manifest.entries()) {
          // eslint-disable-next-line no-console
          console.log(`  ${entry.name}: typeId=${entry.typeId}, stride=${entry.f32Stride}`);
        }
      }
    },

    /**
     * Transform TypeScript system files: detect optimizable patterns and rewrite them.
     *
     * Only processes `.ts` and `.tsx` files. Non-matching or unoptimizable files
     * return `null` (Vite convention: null = skip transformation).
     *
     * For each file, `AstWalker.walk()` extracts `useQuery + onUpdate + useComponent`
     * patterns along with their source positions (forOfStart, readDecls, propAccesses,
     * etc.). `PatternDetector.classify()` then verifies all referenced components are
     * in the manifest and have only numeric fields. Finally, `applyBulkTransform()`
     * rewrites the pattern in-place using `MagicString` — replacing the for-of loop
     * with a numeric loop and injecting `queryReadBulk` / `queryWriteBulk` calls.
     * A source map is returned alongside the transformed code.
     *
     * @param code - The source code of the file being transformed.
     * @param id   - The resolved file path / module ID.
     * @returns `null` to skip, or `{ code, map }` when a pattern was transformed.
     */
    transform(code: string, id: string) {
      if (!id.endsWith(".ts") && !id.endsWith(".tsx")) return null;
      if (!code.includes("useQuery") || !code.includes("onUpdate")) return null;

      const walker = new AstWalker(id);
      const patterns = walker.walk(code);

      if (patterns.length === 0) return null;

      const detector = new PatternDetector(manifest);

      if (mode === "detect") {
        for (const pattern of patterns) {
          const result = detector.classify(pattern);
          if (result.optimizable) {
            this.warn(
              `[gwen:optimizer] Optimizable pattern found in ${id}: useQuery([${pattern.queryComponents.join(", ")}]) — add gwenOptimizerPlugin({ mode: 'transform' }) to enable bulk rewrite.`,
            );
          } else if (debug) {
            // eslint-disable-next-line no-console
            console.log(`[gwen:optimizer] Skipping in ${id}: ${result.reason}`);
          }
        }
        return null;
      }

      const s = new MagicString(code);
      let transformed = false;

      for (const pattern of patterns) {
        const result = detector.classify(pattern);
        if (!result.optimizable) {
          // eslint-disable-next-line no-console
          if (debug) console.log(`[gwen:optimizer] Skipping in ${id}: ${result.reason}`);
          continue;
        }
        if (debug)
          // eslint-disable-next-line no-console
          console.log(
            `[gwen:optimizer] Transforming pattern in ${id}:`,
            pattern.queryComponents.join(", "),
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
