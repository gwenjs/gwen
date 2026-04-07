// packages/core/src/scene/index.ts
// Scope: scene definition and routing only.
// Actor, prefab, layout, and emit exports live in @gwenjs/core/actor.
export { defineScene } from "./define-scene.js";
export type { SceneDefinition, SceneFactory, SceneOptions, SceneRegistry } from "./define-scene.js";

export * from "../router/index.js";
