// packages/core/src/scene/index.ts
// Scope: scene definition and routing only.
// Actor, prefab, layout, and emit exports live in @gwenjs/core/actor.
export { defineScene } from "./defines/define-scene";
export type { SceneDefinition, SceneFactory, SceneRegistry } from "./defines/define-scene";

export { useSystem, onEnter, onExit } from "./scene-context.js";
export type { SystemHandle } from "./system-handle";

export * from "../router/index.js";
