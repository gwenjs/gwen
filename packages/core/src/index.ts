// GWEN Engine Core — public API.
// Game-loop primitives live in subpaths:
//   @gwenjs/core/system  — defineSystem, onUpdate, useQuery, ...
//   @gwenjs/core/actor   — defineActor, onStart, onDestroy, definePrefab, ...
//   @gwenjs/core/scene   — defineScene, defineSceneRouter, ...
//   @gwenjs/core/tween   — easing functions
// Framework-only symbols live in @gwenjs/core/internal.

export type {
  EntityId,
  ComponentType,
  ComponentAccessor,
  Vector2D,
  Color,
  EngineConfig,
} from "./types";

export { createEntityId, unpackEntityId } from "./types";

export { Types, defineComponent } from "./schema";
export type {
  SchemaType,
  ComponentSchema,
  SchemaLayout,
  InferSchemaType,
  InferComponent,
  ComponentDefinition,
  ComponentBody,
} from "./schema";

export { useHook, onCleanup, withCleanup, defineHooks } from "./hooks";
export type { GwenHooks, GwenHookable, HookHandlerMap, InferHooks } from "./hooks";

export { emit } from "./hooks";

export {
  createEngine,
  setupGwen,
  GwenPluginNotFoundError,
  CoreErrorCodes,
  GwenWasmError,
  GwenWasmPanicError,
} from "./engine/gwen-engine";
export type { CoreWasmErrorCode } from "./engine/gwen-engine";
export { createErrorBus } from "./engine/error-bus";
export { GwenConfigError, GwenActorError, ActorErrorCodes } from "./errors";
export { GwenComposableError, ComposableErrorCodes } from "./engine/engine-errors";

export type { GwenDisposable } from "@gwenjs/schema";
export type {
  GwenEngine,
  EngineState,
  GwenPlugin,
  GwenProvides,
  GwenEngineOptions,
  GwenPluginNotFoundErrorOptions,
  EngineStats,
  EngineFramePhaseMs,
  WasmModuleHandle,
  WasmModuleOptions,
  EngineErrorBus,
  PlacementBridge,
  PluginErrorContext,
} from "./engine/gwen-engine";
export type { WasmMemoryRegion, WasmMemoryOptions, WasmChannelOptions } from "./engine/gwen-engine";
export type { WasmRegionView, WasmRingBuffer } from "./engine/wasm-module-handle";

export { createLogger, GwenLogger, consoleLogProvider } from "./logger/index";
export type { LogLevel, LogEntry, IGwenLogger } from "./logger/index";

export type { GwenRuntimeHooks, EngineErrorPayload } from "./engine/runtime-hooks";

export { useEngine, GwenContextError, withAsyncContext } from "./engine/context";

export type { WasmBridge, CoreVariant } from "./engine/wasm-bridge";

export type { MemoryRegion } from "./hooks/wasm/shared-memory";

export type { EasingName, TweenableValue, TweenOptions, TweenHandle } from "./tween/index";
export { useTween, defineSequence } from "./tween/index";
