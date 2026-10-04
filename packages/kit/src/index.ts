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

// Observability composables for plugin authors
export { useLogger, useErrorReporter, usePerfMark } from "./observability.js";

// Error bus — implementation lives in @gwenjs/core. Do not duplicate it here.
export { createErrorBus } from "@gwenjs/core";

// Scope API for plugin authors
export { useCurrentScope, createChildScope } from "./context.js";
