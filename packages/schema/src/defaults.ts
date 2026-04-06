/**
 * GWEN Configuration Schema - Defaults and Resolution
 *
 * Default configuration values and merge logic using defu.
 *
 * @module @gwenjs/schema
 */

import { defu } from 'defu';
import type { GwenOptions, GwenConfigInput, GwenPluginBase, GwenModuleEntry } from './config';
import { validateResolvedConfig } from './validate.js';

function isPluginBase(value: unknown): value is GwenPluginBase {
  return (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    typeof (value as { name?: unknown }).name === 'string'
  );
}

function toPluginArray(value: unknown): GwenPluginBase[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isPluginBase);
}

function toModuleArray(value: unknown): GwenModuleEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value as GwenModuleEntry[];
}

/**
 * Default GWEN configuration values.
 *
 * Used as the base for all configurations. User-provided values are merged
 * on top of these defaults using `defu()`.
 */
export const defaultOptions: GwenOptions = {
  engine: {
    maxEntities: 5000,
    targetFPS: 60,
    debug: false,
    enableStats: true,
    sparseTransformSync: true,
    loop: 'internal',
    maxDeltaSeconds: 0.1,
  },
  html: {
    title: 'GWEN Project',
    background: '#000000',
  },
  modules: [],
  plugins: [],
  scenes: [],
  scenesMode: 'auto',
  srcDir: 'src',
  outDir: 'dist',
};

/**
 * Resolve a partial user configuration into a fully normalized GwenOptions.
 *
 * This function:
 * 1. Merges user input with defaults using deep merge (defu)
 * 2. Unifies `tsPlugins` and `wasmPlugins` arrays into single `plugins` array
 * 3. Validates the final configuration with custom rules
 * 4. Returns a fully typed and validated GwenOptions
 *
 * @param input - Partial user configuration (can include legacy `tsPlugins`/`wasmPlugins`)
 * @returns Fully resolved and validated GwenOptions
 * @throws Error if validation fails with descriptive message
 *
 * @example
 * ```ts
 * const config = resolveConfig({
 *   engine: { maxEntities: 10_000 },
 *   plugins: [myPlugin],
 * });
 * ```
 */
export function resolveConfig(input: GwenConfigInput = {}): GwenOptions {
  // Start with defaults and merge input using defu (right-side wins, deep merge)
  const merged = defu(input, defaultOptions) as GwenOptions;

  const modules = toModuleArray(input.modules ?? merged.modules);

  // Unify legacy plugin arrays into single plugins array
  const plugins: GwenPluginBase[] = [...toPluginArray(merged.plugins)];

  // Add legacy tsPlugins if present
  plugins.push(...toPluginArray(input.tsPlugins));

  // Add legacy wasmPlugins if present
  plugins.push(...toPluginArray(input.wasmPlugins));

  // Create the final resolved config
  const resolvedBase: GwenOptions = {
    engine: merged.engine,
    html: merged.html,
    modules,
    plugins,
    scenes: merged.scenes ?? [],
    scenesMode: merged.scenesMode ?? 'auto',
    srcDir: merged.srcDir,
    outDir: merged.outDir,
  };

  const resolved: GwenOptions = {
    ...resolvedBase,
    ...(merged.mainScene !== undefined ? { mainScene: merged.mainScene } : {}),
    ...(merged.rootDir !== undefined ? { rootDir: merged.rootDir } : {}),
    ...(merged.dev !== undefined ? { dev: merged.dev } : {}),
  };

  // Validate and return
  return validateResolvedConfig(resolved);
}
