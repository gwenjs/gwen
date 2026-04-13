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
export { emit } from "./emit";

// Actor composables
export { useActor, usePrefab, useComponent } from "./uses/use-actor";
export { defineLayout } from "./defines/define-layout";
export { useLayout } from "./uses/use-layout";
export { useTransform } from "./uses/use-transform";
export { watchActorLeaks } from "./uses/watch-actor-leaks";
export { placeActor, placeGroup, placePrefab } from "./place";

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
