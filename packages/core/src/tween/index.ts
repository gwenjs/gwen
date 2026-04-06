/**
 * @file GWEN Tween & Animation System — public barrel
 *
 * Re-exports all tween-related types, classes, and composables from a single
 * entry point. Import from `@gwenjs/core` or directly from this barrel.
 *
 * @since 1.0.0
 */

export * from './easing.js';
export * from './tween-types.js';
export { TweenPool, type TweenSlot, type TweenPoolPolicy } from './tween-pool.js';
export { TweenManager, getTweenManager } from './tween-manager.js';
export { useTween } from './use-tween.js';
export { defineSequence } from './define-sequence.js';
