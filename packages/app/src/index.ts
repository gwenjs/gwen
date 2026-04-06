/**
 * @file @gwenjs/app — public API surface.
 *
 * This is the primary entry point for GWEN project configuration and the
 * module system orchestrator. Import `defineConfig` here in `gwen.config.ts`.
 *
 * ⚠️  This module is browser-safe. Node.js-only APIs (resolveGwenConfig,
 * GwenApp) are exported from `@gwenjs/app/resolve` to avoid bundling
 * server-side dependencies (c12, fs, etc.) into the browser bundle.
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

// ─── Config helpers (browser-safe) ───────────────────────────────────────────

export { defineConfig } from './types';
export type {
  GwenUserConfig,
  ResolvedGwenConfig,
  GwenModuleOptions,
  GwenModuleEntry,
  /** Re-exported for convenience — build hooks live in kit but are surfaced here. */
  GwenBuildHooks,
} from './types';

// ─── Module authoring API (re-exported from @gwenjs/kit) ──────────────────

/**
 * Define a GWEN module — the primary way to extend a project's build pipeline.
 * Re-exported from `@gwenjs/kit` so that consumers only need to import
 * from `@gwenjs/app` for both project configuration and module authoring.
 */
export { defineGwenModule } from '@gwenjs/kit';
export type {
  GwenModule,
  GwenModuleDefinition,
  GwenKit,
  AutoImport,
  GwenTypeTemplate,
} from '@gwenjs/kit';
