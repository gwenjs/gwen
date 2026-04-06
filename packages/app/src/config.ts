/**
 * @file RFC-004 — resolveConfig, resolveGwenConfig (Node.js only)
 *
 * Browser-safe types and defineConfig live in ./types.ts.
 * This file imports c12 and must only be used in Node.js contexts.
 */

import { defu } from 'defu';

import type { GwenUserConfig, GwenModuleEntry, ResolvedGwenConfig } from './types';
import { loadRawGwenConfig } from './config-loader';

// Re-export all browser-safe types so CLI code can import from a single place
export type {
  GwenModuleOptions,
  GwenModuleEntry,
  GwenUserConfig,
  ResolvedGwenConfig,
  GwenBuildHooks,
} from './types';

const DEFAULT_ENGINE = {
  maxEntities: 10_000,
  targetFPS: 60,
  variant: 'light' as const,
  loop: 'internal' as const,
  maxDeltaSeconds: 0.1,
};

/**
 * Merge defaults into user config to produce a {@link ResolvedGwenConfig}.
 * Used internally by `GwenApp` and tests.
 *
 * @param config - User-supplied config (may be partial)
 */
export function resolveConfig(config: GwenUserConfig): ResolvedGwenConfig {
  return {
    ...config,
    modules: config.modules ?? [],
    engine: { ...DEFAULT_ENGINE, ...config.engine },
  };
}

/**
 * Loads `gwen.config.ts` from the project root using `c12` (with `jiti` for
 * TypeScript support) and merges it with defaults.
 *
 * Called by CLI commands (`gwen dev`, `gwen build`, `gwen prepare`) and
 * the Vite plugin to resolve the project configuration at build time.
 *
 * @param rootDir - Project root directory (defaults to `process.cwd()`).
 * @returns Fully resolved configuration with all defaults applied.
 *
 * @example
 * ```typescript
 * const config = await resolveGwenConfig()
 * // config.engine.maxEntities === 10_000 (default)
 * ```
 */
export async function resolveGwenConfig(rootDir?: string): Promise<ResolvedGwenConfig> {
  const { config: userConfig } = await loadRawGwenConfig(rootDir ?? process.cwd());

  return defu(
    {
      ...userConfig,
      modules: userConfig.modules ?? [],
      engine: userConfig.engine ?? {},
    },
    {
      modules: [] as GwenModuleEntry[],
      engine: DEFAULT_ENGINE,
    },
  ) as ResolvedGwenConfig;
}
