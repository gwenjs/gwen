/** Hot-reload entry points. Re-exported by `@gwenjs/core/internal`. @internal */

export type { GwenHotKind, GwenHotReloadReason, GwenHotReport } from "./types.js";
export { hotReplaceSystem } from "./hot-replace-system.js";
export { hotCompareComponent } from "./hot-compare-component.js";
