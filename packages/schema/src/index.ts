/**
 * GWEN Configuration Schema - Main Entry Point
 *
 * Single source of truth for GWEN engine configuration types and defaults.
 *
 * @module @gwenjs/schema
 */

// ─── types ──────────────────────────────────────────────────────────────────
export type {
  GwenHookHandler,
  GwenModuleEntry,
  GwenOptions,
  GwenConfigInput,
  DeepPartial,
  EngineAPI,
} from "./config";

export type {
  EngineLifecycleHooks,
  PluginLifecycleHooks,
  EntityLifecycleHooks,
  ComponentLifecycleHooks,
  SceneLifecycleHooks,
  ExtensionLifecycleHooks,
  GwenHooks,
} from "./hooks";

// ─── Runtime ─────────────────────────────────────────────────────────────────
export { defaultOptions, resolveConfig } from "./defaults";
export { validateResolvedConfig, assertModuleFirstInput } from "./validate";
// ─── Disposable ──────────────────────────────────────────────────────────────

export type { GwenDisposable, DisposableRegistryBase } from "./disposable";

// ─── Errors ──────────────────────────────────────────────────────────────────

export { GwenError } from "./errors";
export type {
  GwenErrorLevel,
  GwenErrorPayload,
  GwenErrorTarget,
  GwenErrorBusBase,
  GwenErrorOptions,
} from "./errors";
export { GwenErrorCode } from "./error-codes";

// ─── Logger ──────────────────────────────────────────────────────────────────

export type { LogLevel, LogEntry, GwenLogger } from "./logger";
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
  GwenProvides,
} from "./plugin";

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
export type { EngineErrorPayload, GwenRuntimeHooks, PluginErrorEvent } from "./runtime-hooks";

// ─── Scope ───────────────────────────────────────────────────────────────────

export type { GwenScopeType, GwenScopeMeta, IGwenScope } from "./scope";

// ─── Module ──────────────────────────────────────────────────────────────────

export type {
  AutoImport,
  GwenTypeTemplate,
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
