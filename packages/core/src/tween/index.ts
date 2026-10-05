/**
 * @file GWEN Tween & Animation System — public barrel
 *
 * Import from `@gwenjs/core/tween`. Pool and plugin types live in
 * `@gwenjs/core/internal`.
 */

export {
  linear,
  easeInQuad,
  easeOutQuad,
  easeInOutQuad,
  easeInCubic,
  easeOutCubic,
  easeInOutCubic,
  easeInQuart,
  easeOutQuart,
  easeInOutQuart,
  easeInSine,
  easeOutSine,
  easeInOutSine,
  easeInExpo,
  easeOutExpo,
  easeInOutExpo,
  easeInBack,
  easeOutBack,
  easeInOutBack,
  easeInElastic,
  easeOutElastic,
  easeInOutElastic,
  easeInBounce,
  easeOutBounce,
  easeInOutBounce,
  spring,
} from "./runtime/easing";
export type { EasingName } from "./runtime/easing";
export type { TweenableValue, TweenOptions, TweenHandle } from "./runtime/tween-types";
export { useTween } from "./runtime/use-tween";
export { defineSequence } from "./runtime/define-sequence";
