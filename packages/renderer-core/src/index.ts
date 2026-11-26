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
  type RendererKind,
  type RendererService,
  type SurfaceRendererService,
  type RenderView,
  type LayerDef,
  type AnimOpts,
  type SpriteHandle,
  type HTMLHandle,
  type AnimatorHandle,
  type MeshHandle,
} from "./types.js";

export { writeCameraViews } from "./write-camera-views.js";

// Stats types and factory
export type {
  RendererLayerStats,
  RendererRendererStats,
  RendererStats,
  RendererStatsCollector,
} from "./stats.js";

// LayerManager itself is intentionally not exported. RenderHostPlugin (gwen:viewports)
// creates the shared instance. Plugin authors register on it with
// engine.inject('layerManager').register(service); the host mounts and unmounts.
export { RenderHostPlugin } from "./render-host-plugin.js";
export type { RenderHostOptions } from "./render-host-plugin.js";

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
  SurfaceInvalidError,
  LayerOrderConflictError,
  UnknownLayerError,
} from "./errors.js";

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
export { useCameraManager } from "./use-camera-manager.js";

// ── ViewportManager ──────────────────────────────────────────────────────────
export type { ViewportManager } from "./viewport-manager.js";
export { useViewportManager } from "./use-viewport-manager.js";

// ── ScreenPlugin ─────────────────────────────────────────────────────────────
export {
  ScreenErrorCodes,
  type ScreenErrorCode,
  ScreenResizeObserverError,
  ScreenViewportNotFoundError,
} from "./screen-errors.js";

export type { ScreenSizeProvider } from "./screen-size-providers.js";
export { BrowserSizeProvider, StaticSizeProvider } from "./screen-size-providers.js";

export type {
  ViewportPixels,
  ViewportBounds,
  ViewportScreenInfo,
  ViewportBoundsProvider,
  ScreenService,
} from "./screen-service.js";

export { ScreenPlugin } from "./screen-plugin.js";
export type { ScreenPluginOptions } from "./screen-plugin.js";
export { useScreen } from "./use-screen.js";

// cameraManager, viewportManager, layerManager, screenService and the
// viewport:* hooks are declared on GwenProvides / GwenRuntimeHooks in
// @gwenjs/schema. This package re-exports the same types.
