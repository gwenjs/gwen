// GWEN Engine Core — Public API (engine primitives only)
// Game-loop primitives live in subpaths:
//   @gwenjs/core/system  — defineSystem, onUpdate, useQuery, ...
//   @gwenjs/core/actor   — defineActor, onStart, onDestroy, definePrefab, ...
//   @gwenjs/core/scene   — defineScene, defineSceneRouter, ...

// Shared types
export * from './types';
export * from './schema';

// Hooks system
export { createGwenHooks } from './hooks';
export type { GwenHooks, GwenHookable } from './hooks';

// Engine
export { createEngine, GwenPluginNotFoundError, CoreErrorCodes } from './engine/gwen-engine';
export { GwenConfigError } from './errors';
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
} from './engine/gwen-engine';
export type { WasmMemoryRegion, WasmMemoryOptions, WasmChannelOptions } from './engine/gwen-engine';

// Logger
export { createLogger } from './logger/index.js';
export type { GwenLogger, LogLevel, LogEntry } from './logger/index.js';

// Runtime hooks interface
export type { GwenRuntimeHooks, EngineErrorPayload } from './engine/runtime-hooks';

// Engine context
export { engineContext, useEngine, GwenContextError } from './context';

// WASM Bridge
export {
  initWasm,
  getWasmBridge,
  _resetWasmBridge,
  _injectMockWasmEngine,
} from './engine/wasm-bridge';
export type {
  WasmBridge,
  WasmEntityId,
  WasmEngine,
  WasmEnginePhysics2D,
  WasmEnginePhysics3D,
  GwenCoreWasm,
  CoreVariant,
  InitWasmOptions,
} from './engine/wasm-bridge';

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
} from './wasm/shared-memory';
export type { MemoryRegion } from './wasm/shared-memory';

// WASM transform buffer host imports
export { buildTransformImports } from './wasm/transform-imports';
export type { GwenTransformImports } from './wasm/transform-imports';

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
} from './components/transform3d';
export { GlobalStringPoolManager, StringPoolManager, StringPool } from './utils/string-pool';

// Core variant detection
export { detectCoreVariant } from './utils/variant-detector';
export { detectSharedMemoryRequired } from './utils/variant-detector';

// Tween & Animation System
export * from './tween/index.js';
