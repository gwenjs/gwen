// packages/core/src/actor/index.ts

// Actor definition + lifecycle composables
export {
  defineActor,
  onStart,
  onDestroy,
  onEvent,
  onRelease,
  onReset,
  useEntityId,
  _getActorEntityId,
} from "./defines/define-actor";

// Frame hooks (re-exported — also valid in system context)
export { onUpdate, onBeforeUpdate, onAfterUpdate, onRender } from "../system/defines/define-system";

// Prefab + events
export { definePrefab } from "./defines/define-prefab";
export { defineEvents } from "./defines/define-events";

/**
 * @deprecated Import `emit` from `'@gwenjs/core'` instead.
 *
 * `emit` is not actor-specific — it works in any engine context (system,
 * actor, plugin). It has been moved to the main `'@gwenjs/core'` entry point
 * alongside its symmetric counterpart `useHook`.
 *
 * **Migration:**
 * ```ts
 * // Before:
 * import { emit } from '@gwenjs/core/actor'
 * // After:
 * import { emit } from '@gwenjs/core'
 * ```
 *
 * Will be removed in v2.0.
 */
export { emit } from "../hooks/emit";

// Actor composables
export { useActor, usePrefab, useComponent } from "./uses/use-actor";
export { defineLayout } from "./defines/define-layout";
export { useLayout } from "./uses/use-layout";
export { useTransform } from "./uses/use-transform";
export { watchActorLeaks } from "./uses/watch-actor-leaks";
export { placeActor, placeGroup, placePrefab } from "./place";

// Actor Pool
export { defineActorPool, useActorPool, DormantTag, PoolExhaustedError } from "./pool/index";
export type { ActorPool, PoolOptions, PoolStats, PoolHooks, CustomScope } from "./pool/index";

// Types
export type { ActorHandle, PrefabHandle } from "./uses/use-actor";
export type { TransformHandle } from "./uses/use-transform";
export type { WatchActorLeaksOptions } from "./uses/watch-actor-leaks";
export type { PrefabDefinition, PrefabComponentEntry } from "./defines/define-prefab";
export type { InferEvents, EventHandlerMap } from "./defines/define-events";
export type {
  ActorDefinition,
  ActorInstance,
  ActorPlugin,
  PlaceHandle,
  LayoutDefinition,
  LayoutHandle,
  UseLayoutOptions,
  UpdateFn,
  RenderFn,
  VoidFn,
} from "./types";
