// packages/core/src/actor/index.ts

// Actor definition + lifecycle composables
export {
  defineActor,
  onStart,
  onDestroy,
  onEvent,
  useEntityId,
  // Still exported for internal monorepo packages (physics2d, physics3d) that
  // have not yet been migrated to useEntityId(). External consumers should use
  // useEntityId() instead.
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
export { placeActor, placeGroup, placePrefab } from "./place";

// Types
export type { ActorHandle, PrefabHandle } from "./uses/use-actor";
export type { TransformHandle } from "./uses/use-transform";
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
