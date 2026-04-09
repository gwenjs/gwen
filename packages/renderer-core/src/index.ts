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

// LayerManager — getOrCreateLayerManager is the only public entry point.
// LayerManager itself is intentionally not exported: plugin authors must use
// getOrCreateLayerManager(engine, container) so the instance is always bound
// to the engine logger and shared across all renderer plugins.
export { getOrCreateLayerManager } from "./get-or-create-layer-manager.js";

// defineRendererService
export {
  defineRendererService,
  type RendererServiceDef,
  type RendererMountContext,
  type RendererFlushContext,
  type ManagedRendererService,
  type RendererServiceInstance,
} from "./define-renderer-service.js";

// Errors
export {
  RendererErrorCodes,
  type RendererErrorCode,
  RendererAlreadyRegisteredError,
  RendererContractVersionError,
  EmptyLayersError,
  UnknownLayerError,
} from "./errors.js";

// Import from @gwenjs/core to enable the declare module augmentation below.
import type {} from "@gwenjs/core";

// Renderer stats are exposed by the shared LayerManager at runtime via
// `layerManager.getStats()`. This package does not attach renderer stats to
// `engine.getStats()` — type-augmenting EngineStats would imply runtime
// population that never happens.
declare module "@gwenjs/core" {
  interface GwenProvides {
    /**
     * The shared LayerManager for this engine instance.
     * Created automatically by the first renderer plugin via `getOrCreateLayerManager()`.
     * Do not create or provide this manually.
     *
     * Use `engine.inject('layerManager').getStats()` to read renderer stats.
     */
    layerManager: import("./layer-manager.js").LayerManager;
  }
}
