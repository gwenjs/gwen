/**
 * @file GWEN Tween & Animation System — public barrel
 *
 * Re-exports all tween-related types, classes, and composables from a single
 * entry point. Import from `@gwenjs/core` or directly from this barrel.
 *
 * @since 1.0.0
 */

export * from "./runtime/easing";
export * from "./runtime/tween-types";
export { TweenPool, type TweenSlot, type TweenPoolPolicy } from "./runtime/tween-pool";
export { TweenManager, getTweenManager } from "./runtime/tween-manager";
export { useTween } from "./runtime/use-tween";
export { defineSequence } from "./runtime/define-sequence";
