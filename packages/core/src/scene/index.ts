// packages/core/src/scene/index.ts
export { defineScene } from './define-scene.js';
export { emit } from './emit.js';
export { defineActor, onStart, onDestroy, onEvent, _getActorEntityId } from './define-actor.js';
export { definePrefab } from './define-prefab.js';
export { useActor, usePrefab, useComponent } from './use-actor.js';
export { defineLayout } from './define-layout.js';
export { useLayout } from './use-layout.js';
export { useTransform } from './use-transform.js';
export { placeActor, placeGroup, placePrefab } from './place.js';
export { _withLayoutContext, _isInLayoutContext } from './place.js';
export type { ActorHandle, PrefabHandle } from './use-actor.js';
export type { SceneDefinition, SceneFactory, SceneOptions, SceneRegistry } from './define-scene.js';
export type { TransformHandle } from './use-transform.js';
export type {
  PrefabDefinition,
  PrefabComponentEntry,
  ActorDefinition,
  ActorInstance,
  ActorPlugin,
  UpdateFn,
  RenderFn,
  VoidFn,
  PlaceHandle,
  LayoutDefinition,
  LayoutHandle,
  UseLayoutOptions,
} from './types.js';
