/**
 * @file Public API for `@gwenjs/renderer-core`.
 *
 * Import types and utilities from this entry point in renderer plugins and game code.
 * Import the testing utility from `@gwenjs/renderer-core/testing`.
 *
 * @example
 * ```ts
 * import {
 *   RENDERER_CONTRACT_VERSION,
 *   type RendererService,
 *   type LayerDef,
 *   type SpriteHandle,
 *   type HTMLHandle,
 *   type MeshHandle,
 *   LayerManager,
 *   RendererErrorCodes,
 *   RendererAlreadyRegisteredError,
 * } from '@gwenjs/renderer-core'
 * ```
 */

// Contract types
export {
  RENDERER_CONTRACT_VERSION,
  type RendererService,
  type LayerDef,
  type AnimOpts,
  type SpriteHandle,
  type HTMLHandle,
  type AnimatorHandle,
  type MeshHandle,
} from "./types.js";

// Stats types and factory
export {
  type RendererLayerStats,
  type RendererRendererStats,
  type RendererStats,
  type RendererStatsCollector,
  createRendererStats,
  RendererStatsCollectorImpl,
} from "./stats.js";

// LayerManager
export { LayerManager } from "./layer-manager.js";

// Errors
export {
  RendererErrorCodes,
  type RendererErrorCode,
  RendererAlreadyRegisteredError,
  RendererContractVersionError,
  UnknownLayerError,
} from "./errors.js";

// TODO(renderer-core): Module augmentation for EngineStats deferred to Task 8.
// When vite.config.ts is added, augment.ts can be exported and EngineStats declaration
// merging will work. For now, see ./augment.ts for the planned augmentation.
