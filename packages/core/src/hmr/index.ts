/** Hot-reload entry points. Re-exported by `@gwenjs/core/internal`. @internal */

export type { GwenHotKind, GwenHotReloadReason, GwenHotReport } from "./types.js";
export { hotReplaceSystem } from "./hot-replace-system.js";
export { hotCompareComponent } from "./hot-compare-component.js";
export { hotReplaceActor } from "./hot-replace-actor.js";
export { hotReplaceLayout } from "./hot-replace-layout.js";
export { hotReplacePlugin } from "./hot-replace-plugin.js";
export { hotReplaceScene } from "./hot-replace-scene.js";
export { registerSceneHandles } from "./scene-handles.js";
