/**
 * @file gwen:physics3d — Vite plugin for layer inlining and build-time optimizations.
 */
import type { Plugin } from 'vite';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

/**
 * Extract layer name → value entries from a `defineLayers({...})` call in source code.
 *
 * Only handles simple numeric literal expressions (integers, hex literals, binary literals,
 * and shift expressions). Complex runtime expressions are skipped silently.
 *
 * @param code - The TypeScript/JavaScript source file contents.
 * @returns A `Map<string, number>` when at least one entry was parsed, or `null`.
 *
 * @internal Exported for unit tests.
 */
export function extractLayerDefinitions(code: string): Map<string, number> | null {
  const match = code.match(/defineLayers\s*\(\s*\{([^}]+)\}\s*\)/);
  if (!match) return null;

  const layerMap = new Map<string, number>();
  const entries = match[1].matchAll(/(\w+)\s*:\s*(.+?)(?:,|\s*$)/gm);

  for (const entry of entries) {
    try {
      // eslint-disable-next-line no-new-func
      const value = Function(`'use strict'; return (${entry[2].trim()})`)() as number;
      layerMap.set(entry[1].trim(), value);
    } catch {
      // skip complex expressions that cannot be statically evaluated
    }
  }

  return layerMap.size > 0 ? layerMap : null;
}

/**
 * Replace `VarName.layerName` references with their literal numeric values.
 *
 * Only replaces whole-word identifier references (uses `\b` word boundaries) to
 * avoid accidentally replacing identifiers that merely contain the layer name.
 *
 * @param code - Source code to transform.
 * @param varName - The variable name of the `defineLayers` result (e.g., `'Layers'`).
 * @param layerMap - Map of layer name → numeric value from {@link extractLayerDefinitions}.
 * @returns Transformed source code with layer references replaced by numeric literals.
 *
 * @internal Exported for unit tests.
 */
export function inlineLayerReferences(
  code: string,
  varName: string,
  layerMap: Map<string, number>,
): string {
  let result = code;
  for (const [name, value] of layerMap) {
    result = result.replace(new RegExp(`\\b${varName}\\.${name}\\b`, 'g'), String(value));
  }
  return result;
}

/**
 * Options accepted by {@link physics3dVitePlugin}.
 */
export interface Physics3DVitePluginOptions {
  /**
   * Log inlining activity to the console when layer constants are replaced.
   * @default false
   */
  debug?: boolean;
}

/**
 * `gwen:physics3d` — Vite plugin for Physics 3D build-time optimizations.
 *
 * Currently performs one transformation:
 * - **Layer inlining**: replaces `Layers.player` references (from a `defineLayers()`
 *   call) with their literal bitmask values, enabling dead-code elimination in
 *   optimised builds.
 *
 * Registered automatically by the `physics3dModule` when added to the GWEN config.
 * Can also be added manually to a plain Vite config:
 *
 * @example
 * ```typescript
 * // vite.config.ts
 * import { physics3dVitePlugin } from '@gwenjs/physics3d'
 *
 * export default {
 *   plugins: [physics3dVitePlugin({ debug: true })],
 * }
 * ```
 *
 * @param options - Optional debug flag.
 * @returns A Vite {@link Plugin} object.
 *
 * @since 1.0.0
 */
export function physics3dVitePlugin(options: Physics3DVitePluginOptions = {}): Plugin {
  return {
    name: 'gwen:physics3d',
    transform(code, id) {
      if (!/\.(ts|tsx|js|jsx)$/.test(id)) return;
      if (!code.includes('defineLayers')) return;

      const layerMap = extractLayerDefinitions(code);
      if (!layerMap) return;

      const varMatch = code.match(/const\s+(\w+)\s*=\s*defineLayers\s*\(/);
      if (!varMatch) return;

      const transformed = inlineLayerReferences(code, varMatch[1], layerMap);

      if (options.debug && transformed !== code) {
        console.log(`[gwen:physics3d] Inlined ${layerMap.size} layer constants in ${id}`);
      }

      return { code: transformed, map: null };
    },
  };
}

// ─── BVH pre-baking support ───────────────────────────────────────────────────

/** Lazy-loaded build-tools WASM module (Node.js target). */
let buildToolsWasm: {
  build_bvh_from_glb: (bytes: Uint8Array, name?: string) => Uint8Array;
} | null = null;

/**
 * Injectable loader override for build-tools WASM — used in tests to inject a mock
 * without requiring the actual `build-tools/gwen_core.js` binary.
 * @internal
 */
let _buildToolsLoaderOverride:
  | (() => Promise<{
      build_bvh_from_glb: (bytes: Uint8Array, name?: string) => Uint8Array;
    }>)
  | null = null;

/**
 * Set a custom build-tools loader. Call before any `transformBvhReferences` invocation.
 * Clears the module-level cache so the new loader is used on the next call.
 *
 * @param loader - Async factory returning a build-tools-like object.
 *
 * @internal Exported for unit tests only — do not call in production code.
 */
export function _setBuildToolsLoader(
  loader: () => Promise<{
    build_bvh_from_glb: (bytes: Uint8Array, name?: string) => Uint8Array;
  }>,
): void {
  _buildToolsLoaderOverride = loader;
  buildToolsWasm = null; // reset so the new loader is picked up
}

/**
 * Lazily import and initialise the build-tools WASM module.
 * Cached after first call — subsequent calls are instant.
 *
 * @internal
 */
async function getBuildTools(): Promise<{
  build_bvh_from_glb: (bytes: Uint8Array, name?: string) => Uint8Array;
}> {
  if (!buildToolsWasm) {
    if (_buildToolsLoaderOverride) {
      buildToolsWasm = await _buildToolsLoaderOverride();
    } else {
      // @ts-ignore — build-tools/gwen_core.js is generated by scripts/build-wasm.sh
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mod = (await import('../build-tools/gwen_core')) as any;
      await mod.default?.();
      buildToolsWasm = mod as typeof buildToolsWasm;
    }
  }
  return buildToolsWasm!;
}

/**
 * Regex matching `useMeshCollider` or `useConvexCollider` calls whose first
 * argument is a relative `.glb` string literal.
 *
 * Captures:
 *   1. Quote character used
 *   2. The GLB relative path (e.g. `./terrain.glb`)
 *   3. Optional `, { mesh: '...' }` options tail
 *
 * @internal
 */
const MESH_GLB_RE =
  /use(?:Mesh|Convex)Collider\(\s*(['"`])(\.\/[^'"` \n]+\.glb)\1(\s*,\s*\{[^}]*\})?\s*\)/g;

/**
 * Detect `useMeshCollider('./file.glb')` patterns and pre-bake their BVH.
 * Returns the transformed code string, or `null` if no matches were found.
 *
 * @param code - Source file contents to scan and transform.
 * @param id - Absolute path of the source file (used to resolve relative GLB paths).
 * @param emitFile - Optional Rollup `emitFile` callback for writing the BVH asset.
 * @returns Transformed source string, or `null` when no GLB patterns were found.
 *
 * @internal Exported for the Vite plugin and unit tests.
 */
export async function transformBvhReferences(
  code: string,
  id: string,
  emitFile?: (opts: { type: 'asset'; name: string; source: Buffer }) => string,
): Promise<string | null> {
  MESH_GLB_RE.lastIndex = 0;
  if (!MESH_GLB_RE.test(code)) return null;
  MESH_GLB_RE.lastIndex = 0;

  const tools = await getBuildTools();
  let transformed = code;
  let offset = 0;

  for (const match of code.matchAll(MESH_GLB_RE)) {
    const [full, , glbPath, optionsStr] = match;
    const absGlbPath = resolve(dirname(id), glbPath);

    if (!existsSync(absGlbPath)) {
      console.warn(`[gwen:physics3d] useMeshCollider: file not found: ${absGlbPath}`);
      continue;
    }

    const meshNameMatch = optionsStr?.match(/mesh\s*:\s*['"`]([^'"` ]+)['"`]/);
    const meshName = meshNameMatch?.[1];

    const glbBytes = readFileSync(absGlbPath);
    let bvhBuffer: Uint8Array;
    try {
      bvhBuffer = tools.build_bvh_from_glb(new Uint8Array(glbBytes), meshName);
    } catch (e) {
      console.warn(`[gwen:physics3d] BVH pre-bake failed for ${glbPath}: ${e}`);
      continue;
    }

    const hash = createHash('md5').update(bvhBuffer).digest('hex').slice(0, 8);
    const assetName = `bvh-${hash}.bin`;

    if (emitFile) {
      emitFile({ type: 'asset', name: assetName, source: Buffer.from(bvhBuffer) });
    }

    const replacement = `useMeshCollider({ __bvhUrl: '${assetName}' })`;
    const start = (match.index ?? 0) + offset;
    transformed =
      transformed.slice(0, start) + replacement + transformed.slice(start + full.length);
    offset += replacement.length - full.length;
  }

  return transformed !== code ? transformed : null;
}

/**
 * Options accepted by {@link createGwenPhysics3DPlugin}.
 *
 * Extends {@link Physics3DVitePluginOptions} with BVH pre-baking controls.
 */
export interface GwenPhysics3DPluginOptions extends Physics3DVitePluginOptions {
  /**
   * Enable BVH pre-baking for `useMeshCollider('./file.glb')` patterns.
   * Requires the `physics3d/build-tools` Node.js WASM to be built first.
   * @default true
   */
  bvhPrebake?: boolean;
}

/**
 * `gwen:physics3d` — enhanced Vite plugin with BVH pre-baking support.
 *
 * Extends {@link physics3dVitePlugin} with an async `transform` hook that
 * detects `useMeshCollider('./file.glb')` calls and replaces them with
 * pre-baked `{ __bvhUrl: 'bvh-<hash>.bin' }` references at build time.
 *
 * The `transformBvhReferences` helper is exposed directly on the returned
 * plugin object for unit testing.
 *
 * @param options - Plugin options.
 * @returns A Vite {@link Plugin} object.
 *
 * @example
 * ```typescript
 * // vite.config.ts
 * import { createGwenPhysics3DPlugin } from '@gwenjs/physics3d'
 *
 * export default {
 *   plugins: [createGwenPhysics3DPlugin({ debug: true })],
 * }
 * ```
 *
 * @since 2.0.0
 */
export function createGwenPhysics3DPlugin(options: GwenPhysics3DPluginOptions = {}): Plugin & {
  /** @internal Exposed for unit tests. */
  transformBvhReferences: typeof transformBvhReferences;
} {
  const { bvhPrebake = true, ...baseOptions } = options;

  return {
    name: 'gwen:physics3d',

    // Expose for unit tests
    transformBvhReferences,

    async transform(code, id) {
      if (!/\.(ts|tsx|js|jsx)$/.test(id)) return;

      let result = code;

      // ── Layer inlining (synchronous) ──────────────────────────────────────
      if (result.includes('defineLayers')) {
        const layerMap = extractLayerDefinitions(result);
        if (layerMap) {
          const varMatch = result.match(/const\s+(\w+)\s*=\s*defineLayers\s*\(/);
          if (varMatch) {
            const inlined = inlineLayerReferences(result, varMatch[1], layerMap);
            if (baseOptions.debug && inlined !== result) {
              console.log(`[gwen:physics3d] Inlined ${layerMap.size} layer constants in ${id}`);
            }
            result = inlined;
          }
        }
      }

      // ── BVH pre-baking (async, build mode only) ────────────────────────────
      if (bvhPrebake && !id.includes('node_modules')) {
        const bvhResult = await transformBvhReferences(
          result,
          id,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (this as any).emitFile?.bind(this),
        );
        if (bvhResult !== null) result = bvhResult;
      }

      return result !== code ? { code: result, map: null } : undefined;
    },
  };
}
