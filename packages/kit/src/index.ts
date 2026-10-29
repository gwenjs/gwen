/**
 * @gwenjs/kit — shared types only.
 *
 * For plugin authoring:  import from '@gwenjs/kit/plugin'
 * For module authoring:  import from '@gwenjs/kit/module'
 */
// Types sourced from @gwenjs/schema — re-exported here for convenience.
export type { AutoImport, VitePlugin, ViteUserConfig, DeepPartial } from "@gwenjs/schema";

export type {
  MergePluginsPrefabExtensions,
  MergePluginsSceneExtensions,
  MergePluginsUIExtensions,
} from "./config.js";

// Observability composables for plugin authors
export { useLogger, useErrorReporter, usePerfMark } from "./observability.js";

// Scope API for plugin authors
export { useCurrentScope } from "./context.js";
export { getCurrentScope, _setCurrentScope } from "./scope-slot.js";
export { _engineSlot, tryUseEngine } from "./engine-slot.js";
export type { EngineSlot } from "./engine-slot.js";
export {
  GwenContextError,
  GwenContextErrorCodes,
  GWEN_CONTEXT_BOUNDARIES,
} from "./context-errors.js";
export { KitErrorCodes } from "./error-codes.js";
export type { GwenContextErrorCode, GwenContextBoundary } from "./context-errors.js";
