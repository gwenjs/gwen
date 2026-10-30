/**
 * GWEN schema entry point.
 *
 * @module @gwenjs/schema
 */

// ─── types ──────────────────────────────────────────────────────────────────
export type { GwenHookHandler, DeepPartial } from "./config";

// ─── Disposable ──────────────────────────────────────────────────────────────

export type { GwenDisposable, DisposableRegistryBase } from "./disposable";

// ─── Errors ──────────────────────────────────────────────────────────────────

export { GwenError, GWEN_DOCS_BASE, errorDocsAnchor, errorDocsUrl } from "./errors";
export type {
  GwenErrorLevel,
  GwenErrorPayload,
  GwenErrorTarget,
  GwenErrorBusBase,
  GwenErrorOptions,
} from "./errors";

// ─── Logger ──────────────────────────────────────────────────────────────────

export type {
  GwenLogLevel,
  GwenLogEntry,
  IGwenLogProvider,
  IGwenLogger,
} from "./logger-structured";

// ─── Plugin ──────────────────────────────────────────────────────────────────

export type {
  HookBusBase,
  GwenEngineBase,
  PluginErrorContext,
  GwenPlugin,
  GwenPluginRequirement,
  GwenPluginRequires,
  GwenProvides,
} from "./plugin";
export { GWEN_PLUGIN_KEYS, GWEN_PLUGIN_LIFECYCLE_HOOKS } from "./plugin-lifecycle";
export type { ForbiddenPluginKey } from "./plugin-lifecycle";

// ─── Entity ──────────────────────────────────────────────────────────────────

export { createEntityId, unpackEntityId, entityIndex, entityGeneration } from "./entity";
export type { EntityId, ComponentType } from "./entity";

// ─── Engine state ────────────────────────────────────────────────────────────

export type {
  EngineStateChangePayload,
  GwenEngineState,
  GwenEngineStateChangeReason,
} from "./engine-state";

// ─── Extensions ──────────────────────────────────────────────────────────────

export type { GwenPrefabExtensions, GwenSceneExtensions, GwenUIExtensions } from "./extensions";

// ─── Hook map ────────────────────────────────────────────────────────────────

export type { HookHandlerMap, InferHooks } from "./hook-types";
export type {
  EngineErrorPayload,
  GwenRuntimeHooks,
  PluginErrorEvent,
  ServiceChangeEvent,
  ServiceChangeReason,
} from "./runtime-hooks";

// ─── Renderer contract ───────────────────────────────────────────────────────

export { RENDERER_CONTRACT_VERSION, RENDER_VIEW_MATRIX_LENGTH } from "./renderer";
export type {
  CameraProjection,
  CameraState,
  CameraStateStore,
  LayerDef,
  LayerHost,
  RenderView,
  RendererKind,
  RendererLayerStats,
  RendererRendererStats,
  RendererService,
  RendererStats,
  RendererStatsCollector,
  ScreenInfoStore,
  SurfaceRendererService,
  Vec3Like,
  ViewportBounds,
  ViewportBoundsProvider,
  ViewportContext,
  ViewportPixels,
  ViewportRegion,
  ViewportScreenInfo,
  ViewportStore,
  WorldTransform,
} from "./renderer";

// ─── Transform 2D ────────────────────────────────────────────────────────────

export { TRANSFORM_2D_SERVICE } from "./transforms";
export type { TransformReader2D, TransformRef2D, TransformSample2D } from "./transforms";

// ─── Scope ───────────────────────────────────────────────────────────────────

export type { GwenScopeType, GwenScopeMeta, IGwenScope } from "./scope";

// ─── Engine config ───────────────────────────────────────────────────────────

export { ENGINE_DEFAULTS, checkEngineConfig, formatReceived } from "./engine-config";
export type { GwenEngineConfig, GwenConfigIssue } from "./engine-config";

// ─── Module ──────────────────────────────────────────────────────────────────

export type {
  AutoImport,
  VitePlugin,
  ViteUserConfig,
  GwenBuildHooks,
  GwenBaseConfig,
  GwenKit,
  GwenModuleDefinition,
  GwenModule,
  GwenModuleOptions,
  PluginDeclaration,
} from "./module";
