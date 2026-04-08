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
export { getOrCreateLayerManager } from "./get-or-create-layer-manager.js";

// defineRendererService
export {
  defineRendererService,
  type RendererServiceDef,
  type RendererMountContext,
  type RendererFlushContext,
  type ManagedRendererService,
} from "./define-renderer-service.js";

// Errors
export {
  RendererErrorCodes,
  type RendererErrorCode,
  RendererAlreadyRegisteredError,
  RendererContractVersionError,
  UnknownLayerError,
} from "./errors.js";

// Import from @gwenjs/core to enable the declare module augmentation below.
import type {} from "@gwenjs/core";

// Augment EngineStats with renderer stats.
// This declaration merging makes engine.getStats().renderers available
// when @gwenjs/renderer-core is installed.
declare module "@gwenjs/core" {
  interface EngineStats {
    /**
     * Renderer stats snapshot. Only populated when `import.meta.env.DEV || engine.debug`.
     * `undefined` in production builds without debug mode.
     */
    renderers?: import("./stats.js").RendererStats;
  }

  interface GwenProvides {
    /**
     * The shared LayerManager for this engine instance.
     * Created automatically by the first renderer plugin via `getOrCreateLayerManager()`.
     * Do not create or provide this manually.
     */
    layerManager: import("./layer-manager.js").LayerManager;
  }
}
