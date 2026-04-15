/**
 * @gwenjs/kit — shared types only.
 *
 * For plugin authoring:  import from '@gwenjs/kit/plugin'
 * For module authoring:  import from '@gwenjs/kit/module'
 */
// Types sourced from @gwenjs/schema — re-exported here for convenience.
export type {
  AutoImport,
  GwenTypeTemplate,
  VitePlugin,
  ViteUserConfig,
  DeepPartial,
} from "@gwenjs/schema";

export type {
  GwenConfig,
  MergePluginsPrefabExtensions,
  MergePluginsSceneExtensions,
  MergePluginsUIExtensions,
} from "./config.js";

// ─── Backwards compat — plugin types moved to @gwenjs/schema ─────────────────

/**
 * @deprecated Import {@link GwenPlugin} from `'@gwenjs/schema'` instead.
 *
 * `GwenPlugin` was previously only importable from `@gwenjs/core`. It has
 * moved to `@gwenjs/schema` to break the potential circular dependency between
 * `@gwenjs/kit` and `@gwenjs/core`.
 *
 * **Migration:**
 * ```ts
 * // Before:
 * import type { GwenPlugin } from '@gwenjs/kit'
 * // After:
 * import type { GwenPlugin } from '@gwenjs/schema'
 * ```
 *
 * Will be removed in v2.0.
 */
export type { GwenPlugin } from "@gwenjs/schema";

/**
 * @deprecated Import {@link GwenEngineBase} from `'@gwenjs/schema'` instead.
 *
 * Re-exported from `@gwenjs/kit` for backwards compatibility. Will be removed in v2.0.
 *
 * **Migration:**
 * ```ts
 * // Before:
 * import type { GwenEngineBase } from '@gwenjs/kit'
 * // After:
 * import type { GwenEngineBase } from '@gwenjs/schema'
 * ```
 */
export type { GwenEngineBase } from "@gwenjs/schema";
