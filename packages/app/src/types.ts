/**
 * @file @gwenjs/app — browser-safe types and defineConfig helper.
 *
 * This file has NO Node.js dependencies. It is safe to import in browser
 * contexts (e.g. gwen.config.ts bundled by Vite).
 */

import type { GwenPlugin, GwenBuildHooks } from '@gwenjs/kit';

export type { GwenBuildHooks } from '@gwenjs/kit';

// ─── GwenModuleOptions (augmentable) ─────────────────────────────────────────

/**
 * Augmented by each module package to add typed options.
 *
 * @example Adding physics2d options
 * ```typescript
 * // In @gwenjs/physics2d:
 * declare module '@gwenjs/app' {
 *   interface GwenModuleOptions {
 *     physics2d: { gravity: number }
 *   }
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface GwenModuleOptions {}

/**
 * A module entry in `gwen.config.ts`.
 * Either a string (package name) or a `[name, options]` tuple.
 *
 * @example
 * ```typescript
 * modules: [
 *   '@gwenjs/physics2d',
 *   ['@gwenjs/input', { gamepad: true }],
 * ]
 * ```
 */
export type GwenModuleEntry = string | [name: string, options?: Record<string, unknown>];

/**
 * The full GWEN framework configuration shape.
 *
 * Module-specific options are typed via {@link GwenModuleOptions} declaration merging.
 *
 * @example
 * ```typescript
 * // gwen.config.ts
 * import { defineConfig } from '@gwenjs/app'
 * export default defineConfig({
 *   modules: ['@gwenjs/physics2d'],
 *   engine: { maxEntities: 5_000 },
 * })
 * ```
 */
export interface GwenUserConfig {
  /**
   * List of modules to activate. Each entry is either a string or a `[name, options]` tuple.
   */
  modules?: GwenModuleEntry[];

  /** Core engine configuration */
  engine?: {
    maxEntities?: number;
    targetFPS?: number;
    variant?: 'light' | 'physics2d' | 'physics3d';
    loop?: 'internal' | 'external';
    maxDeltaSeconds?: number;
  };

  /** Direct Vite config extension (simple case). */
  vite?: Record<string, unknown>;

  /** Build-time hook subscriptions. */
  hooks?: Partial<GwenBuildHooks>;

  /** Plugins to register directly (without a module). */
  plugins?: GwenPlugin[];

  /** Module-specific options (typed via GwenModuleOptions augmentation). */
  [key: string]: unknown;
}

/** Fully resolved config (same shape as user config, with defaults filled in). */
export type ResolvedGwenConfig = GwenUserConfig & {
  engine: Required<NonNullable<GwenUserConfig['engine']>>;
  modules: GwenModuleEntry[];
};

/**
 * Identity helper for `gwen.config.ts`. Provides TypeScript inference for module options.
 * This is a pure function with no Node.js dependencies — safe to import in the browser.
 *
 * @example
 * ```typescript
 * import { defineConfig } from '@gwenjs/app'
 * export default defineConfig({
 *   modules: ['@gwenjs/physics2d'],
 *   engine: { maxEntities: 5_000 },
 * })
 * ```
 */
export function defineConfig(config: GwenUserConfig): GwenUserConfig {
  return config;
}
