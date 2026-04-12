// packages/core/src/router/index.ts
export { defineSceneRouter } from "./defines/define-scene-router";
export { useSceneRouter } from "./uses/use-scene-router";
export type {
  RouteConfig,
  SceneRouterOptions,
  SceneRouterDefinition,
  SceneRouterHandle,
  EventsOf,
  StatesOf,
  TransitionEffect,
  SceneInput,
} from "./router-types.js";
