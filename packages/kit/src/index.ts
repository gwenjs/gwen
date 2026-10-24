/**
 * @gwenjs/kit — shared types only.
 *
 * For plugin authoring:  import from '@gwenjs/kit/plugin'
 * For module authoring:  import from '@gwenjs/kit/module'
 */
// Types sourced from @gwenjs/schema — re-exported here for convenience.
export type { AutoImport, VitePlugin, ViteUserConfig, DeepPartial } from "@gwenjs/schema";

export type {
  GwenConfig,
  MergePluginsPrefabExtensions,
  MergePluginsSceneExtensions,
  MergePluginsUIExtensions,
} from "./config.js";

// Observability composables for plugin authors
export { useLogger, useErrorReporter, usePerfMark } from "./observability.js";

// Scope API for plugin authors
export { useCurrentScope } from "./context.js";
export { getCurrentScope, _setCurrentScope } from "./scope-slot.js";
export { GwenContextError, GwenComposableError, GwenContextErrorCodes } from "./context-errors.js";
export type { GwenContextErrorCode } from "./context-errors.js";
