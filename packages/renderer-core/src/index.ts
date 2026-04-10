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

// ── Camera and viewport types ────────────────────────────────────────────────
export type {
  WorldTransform,
  CameraProjection,
  ViewportRegion,
  ViewportContext,
  CameraState,
} from "./camera-types.js";

// ── CameraManager ────────────────────────────────────────────────────────────
export type { CameraManager } from "./camera-manager.js";
export { CameraManagerImpl } from "./camera-manager.js";
export { getOrCreateCameraManager } from "./get-or-create-camera-manager.js";
export { useCameraManager } from "./use-camera-manager.js";

// ── ViewportManager ──────────────────────────────────────────────────────────
export type { ViewportManager } from "./viewport-manager.js";
export { ViewportManagerImpl } from "./viewport-manager.js";
export { getOrCreateViewportManager } from "./get-or-create-viewport-manager.js";
export { useViewportManager } from "./use-viewport-manager.js";

// ── GwenProvides augmentation — cameraManager + viewportManager ──────────────
// Import to activate the declare module augmentation below.
import type { CameraManager as CM } from "./camera-manager.js";
import type { ViewportManager as VM } from "./viewport-manager.js";

declare module "@gwenjs/core" {
  interface GwenProvides {
    /**
     * Per-frame camera state store. Written by CameraSystem, read by renderers.
     * Installed automatically when CameraCorePlugin is used.
     */
    cameraManager: CM;
    /**
     * Screen region registry. Written by @gwenjs/app or useViewportManager() at runtime.
     * Installed automatically when CameraCorePlugin is used.
     */
    viewportManager: VM;
  }
}

// ── GwenRuntimeHooks augmentation — viewport:* hooks ─────────────────────────
// camera:* hooks are declared in @gwenjs/camera-core (emitted by CameraSystem).
import type { ViewportRegion as VR } from "./camera-types.js";

declare module "@gwenjs/core" {
  interface GwenRuntimeHooks {
    /**
     * Fired when a new viewport is registered via `ViewportManager.set()`.
     * Renderer plugins subscribe to this to create their viewport containers.
     */
    "viewport:add": (payload: { id: string; region: VR }) => void;
    /**
     * Fired when an existing viewport is resized via `ViewportManager.set()`.
     */
    "viewport:resize": (payload: { id: string; region: VR }) => void;
    /**
     * Fired when a viewport is removed via `ViewportManager.remove()`.
     */
    "viewport:remove": (payload: { id: string }) => void;
  }
}
