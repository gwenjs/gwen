// packages/core/src/scene/index.ts
// Scope: scene definition and routing only.
// Actor, prefab, layout, and emit exports live in @gwenjs/core/actor.
export { defineScene } from "./define-scene.js";
export type { SceneDefinition, SceneFactory, SceneRegistry } from "./define-scene.js";

export { useSystem, onEnter, onExit } from "./scene-context.js";
export type { SystemHandle } from "./system-handle.js";

export * from "../router/index.js";
