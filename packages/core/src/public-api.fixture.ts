/* oxlint-disable no-unused-vars -- type fixture: the checker is the assertion */

import type * as Root from "@gwenjs/core";
import type * as T_system from "@gwenjs/core/system";
import type * as T_actor from "@gwenjs/core/actor";
import type * as T_scene from "@gwenjs/core/scene";
import type * as T_tween from "@gwenjs/core/tween";
import type * as T_testing from "@gwenjs/core/testing";
import type * as T_internal from "@gwenjs/core/internal";
import type * as T_wasm_light from "@gwenjs/core/wasm/light";
import type * as T_wasm_physics2d from "@gwenjs/core/wasm/physics2d";
import type * as T_wasm_physics3d from "@gwenjs/core/wasm/physics3d";

type _0 = [
  Root.Color,
  Root.ComponentAccessor<never>,
  Root.ComponentBody<never>,
  Root.ComponentDefinition<never>,
  Root.ComponentSchema,
  Root.ComponentType,
  Root.CoreVariant,
  Root.EasingName,
  Root.EngineConfig,
  Root.EngineErrorBus,
  Root.EngineErrorPayload,
  Root.EngineFramePhaseMs,
  Root.EngineState,
  Root.EngineStateChange,
  Root.EngineStateChangePayload,
  Root.GwenEngineState,
  Root.GwenEngineStateChangeReason,
  Root.EngineStats,
  Root.EntityId,
  Root.GwenDisposable,
  Root.GwenEngine,
  Root.GwenEngineOptions,
  Root.GwenHookable<never>,
  Root.GwenHooks,
  Root.GwenPlugin,
  Root.GwenPluginNotFoundErrorOptions,
  Root.GwenProvides,
  Root.GwenRuntimeHooks,
  Root.HookHandlerMap,
  Root.IGwenLogger,
  Root.InferComponent<never>,
  Root.InferHooks<never>,
  Root.InferSchemaType<never>,
  Root.LogEntry,
  Root.LogLevel,
  Root.MemoryRegion,
  Root.PlacementBridge,
  Root.PluginErrorContext,
  Root.SchemaLayout<never>,
  Root.SchemaType,
  Root.TweenHandle<never>,
  Root.TweenOptions<never>,
  Root.TweenableValue,
  Root.Vector2D,
  Root.WasmBridge,
  Root.WasmChannelOptions,
  Root.WasmMemoryOptions,
  Root.WasmMemoryRegion,
  Root.WasmModuleHandle,
  Root.WasmModuleOptions,
  Root.WasmRegionView,
  Root.WasmRingBuffer,
];
type _1 = [
  T_system.ComponentDef,
  T_system.DiscoverablePlugin,
  T_system.EntityAccessor<never>,
  T_system.LiveQuery<never>,
];
type _2 = [
  T_actor.ActorDefinition<never, never>,
  T_actor.ActorHandle<never, never>,
  T_actor.ActorInstance<never>,
  T_actor.ActorPlugin<never>,
  T_actor.ActorPool<never, never>,
  T_actor.ChildrenHandle,
  T_actor.CustomScope,
  T_actor.LayoutDefinition<never>,
  T_actor.LayoutHandle<never>,
  T_actor.PlaceHandle<never>,
  T_actor.PoolHooks,
  T_actor.PoolOptions,
  T_actor.PoolStats,
  T_actor.PrefabDefinition<never>,
  T_actor.PrefabHandle<never>,
  T_actor.RenderFn,
  T_actor.TransformHandle,
  T_actor.UpdateFn,
  T_actor.UseLayoutOptions,
  T_actor.VoidFn,
  T_actor.WatchActorLeaksOptions,
];
type _3 = [
  T_scene.EventsOf<never>,
  T_scene.RouteConfig<never>,
  T_scene.SceneDefinition,
  T_scene.SceneFactory,
  T_scene.SceneInput,
  T_scene.SceneRegistry,
  T_scene.SceneRouterDefinition<never>,
  T_scene.SceneRouterHandle<never>,
  T_scene.SceneRouterOptions<never>,
  T_scene.StatesOf<never>,
  T_scene.SystemHandle,
  T_scene.TransitionEffect,
];
type _4 = [
  T_tween.EasingName,
  T_tween.TweenHandle<never>,
  T_tween.TweenOptions<never>,
  T_tween.TweenableValue,
];
type _5 = [T_testing.CreateRealEngineOptions, T_testing.RealEngineHandle];
type _6 = [
  T_internal.GwenCoreWasm,
  T_internal.GwenTransformImports,
  T_internal.InitWasmOptions,
  T_internal.TweenPluginOptions,
  T_internal.TweenPoolPolicy,
  T_internal.TweenSlot,
  T_internal.WasmEngine,
  T_internal.WasmEnginePhysics2D,
  T_internal.WasmEnginePhysics3D,
  T_internal.WasmEntityId,
];
type _7 = [T_wasm_light.InitInput, T_wasm_light.InitOutput, T_wasm_light.SyncInitInput];
type _8 = [T_wasm_physics2d.InitInput, T_wasm_physics2d.InitOutput, T_wasm_physics2d.SyncInitInput];
type _9 = [T_wasm_physics3d.InitInput, T_wasm_physics3d.InitOutput, T_wasm_physics3d.SyncInitInput];

// @ts-expect-error TS2305 — removed from @gwenjs/core
import { engineContext } from "@gwenjs/core";

// @ts-expect-error TS2305 — removed from @gwenjs/core
import { executeAsync } from "@gwenjs/core";

// @ts-expect-error TS2305 — removed from @gwenjs/core
import { WasmBridgeImpl } from "@gwenjs/core";

// @ts-expect-error TS2305 — removed from @gwenjs/core
import { getWasmBridge } from "@gwenjs/core";

// @ts-expect-error TS2305 — removed from @gwenjs/core
import { detectCoreVariant } from "@gwenjs/core";

// @ts-expect-error TS2305 — removed from @gwenjs/core
import { detectSharedMemoryRequired } from "@gwenjs/core";

// @ts-expect-error TS2305 — removed from @gwenjs/core
import { createGwenHooks } from "@gwenjs/core";

// @ts-expect-error TS2305 — removed from @gwenjs/core
import { SharedMemoryManager } from "@gwenjs/core";

// @ts-expect-error TS2305 — removed from @gwenjs/core
import { TRANSFORM_STRIDE } from "@gwenjs/core";

// @ts-expect-error TS2305 — removed from @gwenjs/core
import { TRANSFORM3D_STRIDE } from "@gwenjs/core";

// @ts-expect-error TS2305 — removed from @gwenjs/core
import { FLAG_HAS_TRANSFORM } from "@gwenjs/core";

// @ts-expect-error TS2305 — removed from @gwenjs/core
import { FLAGS_OFFSET } from "@gwenjs/core";

// @ts-expect-error TS2305 — removed from @gwenjs/core
import { SENTINEL } from "@gwenjs/core";

// @ts-expect-error TS2305 — removed from @gwenjs/core
import { MAX_SAB_BYTES } from "@gwenjs/core";

// @ts-expect-error TS2305 — removed from @gwenjs/core
import { buildTransformImports } from "@gwenjs/core";

// @ts-expect-error TS2305 — removed from @gwenjs/core
import { StringPool } from "@gwenjs/core";

// @ts-expect-error TS2305 — removed from @gwenjs/core
import { StringPoolManager } from "@gwenjs/core";

// @ts-expect-error TS2305 — removed from @gwenjs/core
import { GlobalStringPoolManager } from "@gwenjs/core";

// @ts-expect-error TS2305 — removed from @gwenjs/core
import { entityIndex } from "@gwenjs/core";

// @ts-expect-error TS2305 — removed from @gwenjs/core
import { createDisposable } from "@gwenjs/core";

// @ts-expect-error TS2305 — removed from @gwenjs/core
import { TRANSFORM_OFFSETS } from "@gwenjs/core";

// @ts-expect-error TS2305 — removed from @gwenjs/core
import { Transform3D } from "@gwenjs/core";

// @ts-expect-error TS2305 — removed from @gwenjs/core
import { readTransform3DPosition } from "@gwenjs/core";

// @ts-expect-error TS2305 — removed from @gwenjs/core
import { readTransform3DRotation } from "@gwenjs/core";

// @ts-expect-error TS2305 — removed from @gwenjs/core
import { readTransform3DScale } from "@gwenjs/core";

// @ts-expect-error TS2305 — removed from @gwenjs/core
import { writeTransform3DPosition } from "@gwenjs/core";

// @ts-expect-error TS2305 — removed from @gwenjs/core
import { writeTransform3DRotation } from "@gwenjs/core";

// @ts-expect-error TS2305 — removed from @gwenjs/core
import { writeTransform3DScale } from "@gwenjs/core";

// @ts-expect-error TS2305 — removed from @gwenjs/core
import { EASING_MAP } from "@gwenjs/core";

// @ts-expect-error TS2305 — removed from @gwenjs/core
import { TweenPool } from "@gwenjs/core";

// @ts-expect-error TS2305 — removed from @gwenjs/core
import { TweenManager } from "@gwenjs/core";

// @ts-expect-error TS2305 — removed from @gwenjs/core
import { getTweenManager } from "@gwenjs/core";

// @ts-expect-error TS2305 — removed from @gwenjs/core
import { TweenPlugin } from "@gwenjs/core";

// @ts-expect-error TS2305 — removed from @gwenjs/core
import { linear } from "@gwenjs/core";

// @ts-expect-error TS2305 — removed from @gwenjs/core
import { easeInQuad } from "@gwenjs/core";

// @ts-expect-error TS2305 — removed from @gwenjs/core
import { easeOutQuad } from "@gwenjs/core";

// @ts-expect-error TS2305 — removed from @gwenjs/core
import { easeInOutQuad } from "@gwenjs/core";

// @ts-expect-error TS2305 — removed from @gwenjs/core
import { easeInCubic } from "@gwenjs/core";

// @ts-expect-error TS2305 — removed from @gwenjs/core
import { easeOutCubic } from "@gwenjs/core";

// @ts-expect-error TS2305 — removed from @gwenjs/core
import { easeInOutCubic } from "@gwenjs/core";

// @ts-expect-error TS2305 — removed from @gwenjs/core
import { easeInQuart } from "@gwenjs/core";

// @ts-expect-error TS2305 — removed from @gwenjs/core
import { easeOutQuart } from "@gwenjs/core";

// @ts-expect-error TS2305 — removed from @gwenjs/core
import { easeInOutQuart } from "@gwenjs/core";

// @ts-expect-error TS2305 — removed from @gwenjs/core
import { easeInSine } from "@gwenjs/core";

// @ts-expect-error TS2305 — removed from @gwenjs/core
import { easeOutSine } from "@gwenjs/core";

// @ts-expect-error TS2305 — removed from @gwenjs/core
import { easeInOutSine } from "@gwenjs/core";

// @ts-expect-error TS2305 — removed from @gwenjs/core
import { easeInExpo } from "@gwenjs/core";

// @ts-expect-error TS2305 — removed from @gwenjs/core
import { easeOutExpo } from "@gwenjs/core";

// @ts-expect-error TS2305 — removed from @gwenjs/core
import { easeInOutExpo } from "@gwenjs/core";

// @ts-expect-error TS2305 — removed from @gwenjs/core
import { easeInBack } from "@gwenjs/core";

// @ts-expect-error TS2305 — removed from @gwenjs/core
import { easeOutBack } from "@gwenjs/core";

// @ts-expect-error TS2305 — removed from @gwenjs/core
import { easeInOutBack } from "@gwenjs/core";

// @ts-expect-error TS2305 — removed from @gwenjs/core
import { easeInElastic } from "@gwenjs/core";

// @ts-expect-error TS2305 — removed from @gwenjs/core
import { easeOutElastic } from "@gwenjs/core";

// @ts-expect-error TS2305 — removed from @gwenjs/core
import { easeInOutElastic } from "@gwenjs/core";

// @ts-expect-error TS2305 — removed from @gwenjs/core
import { easeInBounce } from "@gwenjs/core";

// @ts-expect-error TS2305 — removed from @gwenjs/core
import { easeOutBounce } from "@gwenjs/core";

// @ts-expect-error TS2305 — removed from @gwenjs/core
import { easeInOutBounce } from "@gwenjs/core";

// @ts-expect-error TS2305 — removed from @gwenjs/core
import { spring } from "@gwenjs/core";

// @ts-expect-error TS2305 — removed from @gwenjs/core
import { onEnable } from "@gwenjs/core";

// @ts-expect-error TS2305 — removed from @gwenjs/core
import { onDisable } from "@gwenjs/core";

// @ts-expect-error TS2305 — removed from @gwenjs/core
import { WasmEntityId } from "@gwenjs/core";

// @ts-expect-error TS2305 — removed from @gwenjs/core
import { WasmEngine } from "@gwenjs/core";

// @ts-expect-error TS2305 — removed from @gwenjs/core
import { WasmEnginePhysics2D } from "@gwenjs/core";

// @ts-expect-error TS2305 — removed from @gwenjs/core
import { WasmEnginePhysics3D } from "@gwenjs/core";

// @ts-expect-error TS2305 — removed from @gwenjs/core
import { GwenCoreWasm } from "@gwenjs/core";

// @ts-expect-error TS2305 — removed from @gwenjs/core
import { InitWasmOptions } from "@gwenjs/core";

// @ts-expect-error TS2305 — removed from @gwenjs/core
import { GwenTransformImports } from "@gwenjs/core";

// @ts-expect-error TS2305 — removed from @gwenjs/core
import { TweenSlot } from "@gwenjs/core";

// @ts-expect-error TS2305 — removed from @gwenjs/core
import { TweenPoolPolicy } from "@gwenjs/core";

// @ts-expect-error TS2305 — removed from @gwenjs/core
import { TweenPluginOptions } from "@gwenjs/core";

// @ts-expect-error TS2305 — removed from @gwenjs/core/actor
import { emit } from "@gwenjs/core/actor";

// @ts-expect-error TS2305 — removed from @gwenjs/core/actor
import { _getActorEntityId } from "@gwenjs/core/actor";

// @ts-expect-error TS2305 — removed from @gwenjs/core/testing
import { _injectMockWasmEngine } from "@gwenjs/core/testing";

// @ts-expect-error TS2305 — removed from @gwenjs/core/testing
import { _injectMockWasmExports } from "@gwenjs/core/testing";

// @ts-expect-error TS2305 — removed from @gwenjs/core/testing
import { _resetWasmBridge } from "@gwenjs/core/testing";
