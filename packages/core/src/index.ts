// GWEN Engine Core — Public API (engine primitives only)
// Game-loop primitives live in subpaths:
//   @gwenjs/core/system  — defineSystem, onUpdate, useQuery, ...
//   @gwenjs/core/actor   — defineActor, onStart, onDestroy, definePrefab, ...
//   @gwenjs/core/scene   — defineScene, defineSceneRouter, ...

// Shared types
export * from "./types";
export * from "./schema";

// Hooks system
export { createGwenHooks, useHook, onCleanup, withCleanup } from "./hooks";
export type { GwenHooks, GwenHookable } from "./hooks";

// Event emission — symmetric counterpart to useHook, works in any engine context
export { emit } from "./hooks";

// Engine
export {
  createEngine,
  setupGwen,
  GwenPluginNotFoundError,
  CoreErrorCodes,
} from "./engine/gwen-engine";
export { GwenConfigError, GwenActorError, ActorErrorCodes } from "./errors";
export { GwenComposableError, ComposableErrorCodes } from "./engine/engine-errors.js";
export type {
  GwenEngine,
  GwenPlugin,
  GwenProvides,
  GwenEngineOptions,
  GwenPluginNotFoundErrorOptions,
  EngineStats,
  EngineFramePhaseMs,
  WasmModuleHandle,
  WasmModuleOptions,
  WasmRegionView,
  WasmRingBuffer,
  EngineErrorBus,
  PlacementBridge,
  PluginErrorContext,
} from "./engine/gwen-engine";
export type { WasmMemoryRegion, WasmMemoryOptions, WasmChannelOptions } from "./engine/gwen-engine";

// Logger
export { createLogger } from "./logger/index.js";
export type { GwenLogger, LogLevel, LogEntry } from "./logger/index.js";

// Runtime hooks interface
export type { GwenRuntimeHooks, EngineErrorPayload } from "./engine/runtime-hooks";

// Engine context
export {
  engineContext,
  useEngine,
  GwenContextError,
  executeAsync,
  withAsyncContext,
} from "./engine/context";
export type { GwenContextErrorCode } from "./engine/context";

// WASM Bridge
export {
  initWasm,
  getWasmBridge,
  _resetWasmBridge,
  _injectMockWasmEngine,
} from "./engine/wasm-bridge";
export type {
  WasmBridge,
  WasmEntityId,
  WasmEngine,
  WasmEnginePhysics2D,
  WasmEnginePhysics3D,
  GwenCoreWasm,
  CoreVariant,
  InitWasmOptions,
} from "./engine/wasm-bridge";

// WASM shared memory
export {
  SharedMemoryManager,
  TRANSFORM_STRIDE,
  TRANSFORM3D_STRIDE,
  FLAG_PHYSICS_ACTIVE,
  FLAGS_OFFSET,
  FLAGS3D_OFFSET,
  SENTINEL,
  MAX_SAB_BYTES,
} from "./hooks/wasm/shared-memory.js";
export type { MemoryRegion } from "./hooks/wasm/shared-memory.js";

// WASM transform buffer host imports
export { buildTransformImports } from "./hooks/wasm/transform-imports.js";
export type { GwenTransformImports } from "./hooks/wasm/transform-imports.js";

// 3D Transform component
export {
  TRANSFORM_OFFSETS,
  Transform3D,
  readTransform3DPosition,
  readTransform3DRotation,
  readTransform3DScale,
  writeTransform3DPosition,
  writeTransform3DRotation,
  writeTransform3DScale,
} from "./components/transform3d";
export { GlobalStringPoolManager, StringPoolManager, StringPool } from "./utils/string-pool";

// Core variant detection
export { detectCoreVariant } from "./utils/variant-detector";
export { detectSharedMemoryRequired } from "./utils/variant-detector";

// Tween & Animation System
export * from "./tween/index.js";

export { ErrorCodes } from "./engine/engine-errors.js";
