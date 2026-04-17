// packages/core/src/scene/index.ts
// Scope: scene definition and routing only.
// Actor, prefab, layout, and emit exports live in @gwenjs/core/actor.
export { defineScene } from "./runtime/define-scene";
export type { SceneDefinition, SceneFactory, SceneRegistry } from "./runtime/define-scene";

export {
  useSystem,
  onEnter,
  onExit,
  onTransitionLeave,
  onTransitionEnter,
} from "./runtime/scene-context";
export type { SystemHandle } from "./runtime/system-handle";
