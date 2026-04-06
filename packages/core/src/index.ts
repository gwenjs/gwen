// GWEN Engine Core — Public API

// Types (source of truth for shared types)
export * from './types';
export * from './schema';

// Hooks system
export { createGwenHooks } from './hooks';
export type { GwenHooks, GwenHookable } from './hooks';

// RFC-001: New GwenEngine interface & createEngine() factory
export { createEngine, GwenPluginNotFoundError, CoreErrorCodes } from './engine/gwen-engine';
export { GwenConfigError } from './errors';
export type {
  GwenEngine,
  // GwenPlugin is the RFC-001 interface (setup/teardown) — the primary plugin contract.
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

// Logger (RFC-011)
export { createLogger } from './logger/index.js';
export type { GwenLogger, LogLevel, LogEntry } from './logger/index.js';

// RFC-003: Runtime hooks interface (augmentable)
export type { GwenRuntimeHooks, EngineErrorPayload } from './engine/runtime-hooks';

// RFC-005: Composable context system (unctx-backed)
export { engineContext, useEngine, GwenContextError } from './context';
export {
  defineSystem,
  onUpdate,
  onBeforeUpdate,
  onAfterUpdate,
  onRender,
  useQuery,
  useService,
  useWasmModule,
} from './system';
export type { LiveQuery, ComponentDef, EntityAccessor } from './system';

// Scene primitives
export { defineScene } from './scene/define-scene.js';
export type {
  SceneDefinition,
  SceneFactory,
  SceneOptions,
  SceneRegistry,
} from './scene/define-scene.js';

export { definePrefab } from './define-prefab.js';
export type { PrefabDefinition, PrefabComponentEntry } from './define-prefab.js';

// RFC-011: Typed event declaration + emit helper
export { defineEvents } from './define-events.js';
export type { InferEvents, EventHandlerMap } from './define-events.js';
export { emit } from './scene/emit.js';

// Actor + Layout system (RFC-011, RFC-01)
export { defineActor, onStart, onDestroy, onEvent } from './scene/define-actor.js';
export { defineLayout } from './scene/define-layout.js';
export { useActor, usePrefab, useComponent } from './scene/use-actor.js';
export { useLayout } from './scene/use-layout.js';
export { useTransform } from './scene/use-transform.js';
export { placeActor, placeGroup, placePrefab } from './scene/place.js';
export type { ActorHandle, PrefabHandle } from './scene/use-actor.js';
export type {
  ActorDefinition,
  ActorInstance,
  ActorPlugin,
  PlaceHandle,
  LayoutDefinition,
  LayoutHandle,
  UseLayoutOptions,
} from './scene/types.js';
export type { TransformHandle } from './scene/use-transform.js';

// Scene Router (RFC-02)
export { defineSceneRouter } from './router/define-scene-router.js';
export { useSceneRouter } from './router/use-scene-router.js';
export type {
  RouteConfig,
  SceneRouterOptions,
  SceneRouterDefinition,
  SceneRouterHandle,
  EventsOf,
  StatesOf,
  TransitionEffect,
  SceneInput,
} from './router/router-types.js';

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

// WASM transform buffer host imports (RFC-GAP2 V1)
export { buildTransformImports } from './wasm/transform-imports';
export type { GwenTransformImports } from './wasm/transform-imports';

// 3D Transform component + low-level buffer accessors
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

// RFC-03: Tween & Animation System
export * from './tween/index.js';
