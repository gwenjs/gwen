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

export { createEngine, setupGwen } from "./engine/engine-factory";
export {
  GwenPluginNotFoundError,
  CoreErrorCodes,
  GwenWasmError,
  GwenWasmAbiError,
  GwenWasmPanicError,
  GwenEngineStateError,
} from "./engine/engine-errors";
export type { CoreWasmErrorCode, GwenEngineStateMethod } from "./engine/engine-errors";
export { EngineMemory } from "./engine/engine-memory";
export type {
  MemoryView,
  MemoryViewArray,
  MemoryViewDescriptor,
  MemoryViewType,
} from "./engine/engine-memory";
export { createErrorBus } from "./engine/error-bus";
export { GwenConfigError, GwenActorError, ActorErrorCodes } from "./errors";
export { GwenComposableError, ComposableErrorCodes } from "./engine/engine-errors";

export type { GwenDisposable } from "@gwenjs/schema";
export type {
  GwenEngine,
  EngineStateChangePayload,
  GwenEngineState,
  GwenEngineStateChangeReason,
  GwenPlugin,
  GwenProvides,
  GwenWasmModules,
  GwenEngineOptions,
  EngineStats,
  EngineFrame,
  EngineFramePhaseMs,
  WasmModuleHandle,
  WasmModuleOptions,
  EngineErrorBus,
  PlacementBridge,
  PluginErrorContext,
} from "./engine/engine-types";
export type { GwenPluginNotFoundErrorOptions } from "./engine/engine-errors";
export type {
  WasmMemoryRegion,
  WasmMemoryOptions,
  WasmChannelOptions,
} from "./engine/wasm-module-handle";
export type { WasmRegionView, WasmRingBuffer } from "./engine/wasm-module-handle";

export { createLogger, GwenLogger, consoleLogProvider } from "./logger/index";
export type { CreateLoggerOptions, IGwenLogger } from "./logger/index";

export type { GwenRuntimeHooks, EngineErrorPayload } from "./engine/runtime-hooks";

export { useEngine, GwenContextError, withAsyncContext } from "./engine/context";
export { createEngineLocal } from "./engine/engine-local";
export type { EngineLocal } from "./engine/engine-local";

export type { WasmBridge, CoreVariant } from "./engine/wasm-bridge";

export type { MemoryRegion } from "./hooks/wasm/shared-memory";
export { FLAG_TELEPORT } from "./hooks/wasm/shared-memory";
export { readInterpolatedTransform2D } from "./engine/transform-pair";
export type { InterpolatedTransform2D, TransformPair2D } from "./engine/transform-pair";

export type { EasingName, TweenableValue, TweenOptions, TweenHandle } from "./tween/index";
export { useTween, defineSequence } from "./tween/index";
