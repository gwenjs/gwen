// packages/core/src/actor/index.ts

// Actor definition + lifecycle composables
export {
  defineActor,
  onStart,
  onDestroy,
  onEvent,
  useEntityId,
  _getActorEntityId,
} from "../scene/define-actor.js";

// Frame hooks (re-exported — also valid in system context)
export { onUpdate, onBeforeUpdate, onAfterUpdate, onRender } from "../system.js";

// Prefab + events
export { definePrefab } from "../define-prefab.js";
export { defineEvents } from "../define-events.js";
export { emit } from "../scene/emit.js";

// Actor composables
export { useActor, usePrefab, useComponent } from "../scene/use-actor.js";
export { defineLayout } from "../scene/define-layout.js";
export { useLayout } from "../scene/use-layout.js";
export { useTransform } from "../scene/use-transform.js";
export { placeActor, placeGroup, placePrefab } from "../scene/place.js";

// Types
export type { ActorHandle, PrefabHandle } from "../scene/use-actor.js";
export type { TransformHandle } from "../scene/use-transform.js";
export type { PrefabDefinition, PrefabComponentEntry } from "../define-prefab.js";
export type { InferEvents, EventHandlerMap } from "../define-events.js";
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
} from "../scene/types.js";
