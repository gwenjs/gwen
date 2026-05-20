// packages/core/src/actor/index.ts

// Actor definition + lifecycle composables
export {
  defineActor,
  onStart,
  onDestroy,
  onRelease,
  onReset,
  onEnable,
  onDisable,
  useEntityId,
  _getActorEntityId,
} from "./runtime/define-actor";

// Frame hooks (re-exported — also valid in system context)
export { onUpdate, onBeforeUpdate, onAfterUpdate, onRender } from "../system/runtime/define-system";

// Prefab
export { definePrefab } from "./runtime/define-prefab";

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
export { useActor, usePrefab, useComponent } from "./runtime/use-actor";
export { defineLayout } from "./runtime/define-layout";
export { useLayout } from "./runtime/use-layout";
export { useTransform } from "./runtime/use-transform";
export { watchActorLeaks } from "./runtime/watch-actor-leaks";
export { placeActor, placeGroup, placePrefab } from "./runtime/place";

// Actor Pool
export {
  defineActorPool,
  useActorPool,
  DormantTag,
  PoolExhaustedError,
} from "./runtime/pool/index";
export type {
  ActorPool,
  PoolOptions,
  PoolStats,
  PoolHooks,
  CustomScope,
} from "./runtime/pool/index";

// Types
export type { ActorHandle, PrefabHandle } from "./runtime/use-actor";
export type { TransformHandle } from "./runtime/use-transform";
export type { WatchActorLeaksOptions } from "./runtime/watch-actor-leaks";
export type { PrefabDefinition, PrefabComponentEntry } from "./runtime/define-prefab";
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
} from "./runtime/types";
export { useActorQuery } from "./runtime/use-actor-query";
