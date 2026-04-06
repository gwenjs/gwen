/**
 * GWEN Easing Functions — 24 standard easing curves for animations.
 *
 * All functions accept normalized time `t ∈ [0, 1]` and return eased progress.
 * Each function is a named export for tree-shaking.
 *
 * @since 1.0.0
 */

/**
 * Easing function name — a key into the easing function registry.
 * Used by {@link useTween} to resolve string easing names to functions.
 *
 * @since 1.0.0
 */
export type EasingName =
  | 'linear'
  | 'easeInQuad'
  | 'easeOutQuad'
  | 'easeInOutQuad'
  | 'easeInCubic'
  | 'easeOutCubic'
  | 'easeInOutCubic'
  | 'easeInQuart'
  | 'easeOutQuart'
  | 'easeInOutQuart'
  | 'easeInSine'
  | 'easeOutSine'
  | 'easeInOutSine'
  | 'easeInExpo'
  | 'easeOutExpo'
  | 'easeInOutExpo'
  | 'easeInBack'
  | 'easeOutBack'
  | 'easeInOutBack'
  | 'easeInElastic'
  | 'easeOutElastic'
  | 'easeInOutElastic'
  | 'easeInBounce'
  | 'easeOutBounce'
  | 'easeInOutBounce'
  | 'spring';

// ── Linear ───────────────────────────────────────────────────────────────────

/**
 * Linear interpolation — no easing, constant speed.
 *
 * @param t - Normalized time `[0, 1]`
 * @returns Eased value
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * linear(0.5) // → 0.5
 * ```
 */
export function linear(t: number): number {
  return t;
}

// ── Quadratic ────────────────────────────────────────────────────────────────

/**
 * Ease in quadratic — accelerating from zero velocity.
 *
 * @param t - Normalized time `[0, 1]`
 * @returns Eased value
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * easeInQuad(0.5) // → 0.25
 * ```
 */
export function easeInQuad(t: number): number {
  return t * t;
}

/**
 * Ease out quadratic — decelerating to zero velocity.
 *
 * @param t - Normalized time `[0, 1]`
 * @returns Eased value
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * easeOutQuad(0.5) // → 0.75
 * ```
 */
export function easeOutQuad(t: number): number {
  return t * (2 - t);
}

/**
 * Ease in-out quadratic — acceleration until halfway, then deceleration.
 *
 * @param t - Normalized time `[0, 1]`
 * @returns Eased value
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * easeInOutQuad(0.25) // → 0.125
 * easeInOutQuad(0.75) // → 0.875
 * ```
 */
export function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

// ── Cubic ────────────────────────────────────────────────────────────────────

/**
 * Ease in cubic — accelerating from zero velocity (stronger than quadratic).
 *
 * @param t - Normalized time `[0, 1]`
 * @returns Eased value
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * easeInCubic(0.5) // → 0.125
 * ```
 */
export function easeInCubic(t: number): number {
  return t * t * t;
}

/**
 * Ease out cubic — decelerating to zero velocity (stronger than quadratic).
 *
 * @param t - Normalized time `[0, 1]`
 * @returns Eased value
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * easeOutCubic(0.5) // → 0.875
 * ```
 */
export function easeOutCubic(t: number): number {
  const f = t - 1;
  return f * f * f + 1;
}

/**
 * Ease in-out cubic — acceleration until halfway, then deceleration (stronger).
 *
 * @param t - Normalized time `[0, 1]`
 * @returns Eased value
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * easeInOutCubic(0.25) // → 0.0625
 * easeInOutCubic(0.75) // → 0.9375
 * ```
 */
export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// ── Quartic ──────────────────────────────────────────────────────────────────

/**
 * Ease in quartic — accelerating from zero velocity (t⁴).
 *
 * @param t - Normalized time `[0, 1]`
 * @returns Eased value
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * easeInQuart(0.5) // → 0.0625
 * ```
 */
export function easeInQuart(t: number): number {
  return t * t * t * t;
}

/**
 * Ease out quartic — decelerating to zero velocity (t⁴).
 *
 * @param t - Normalized time `[0, 1]`
 * @returns Eased value
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * easeOutQuart(0.5) // → 0.9375
 * ```
 */
export function easeOutQuart(t: number): number {
  return 1 - Math.pow(1 - t, 4);
}

/**
 * Ease in-out quartic — acceleration until halfway, then deceleration (t⁴).
 *
 * @param t - Normalized time `[0, 1]`
 * @returns Eased value
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * easeInOutQuart(0.25) // → 0.03125
 * easeInOutQuart(0.75) // → 0.96875
 * ```
 */
export function easeInOutQuart(t: number): number {
  const f = t - 1;
  return t < 0.5 ? 8 * t * t * t * t : 1 - 8 * f * f * f * f;
}

// ── Sinusoidal ───────────────────────────────────────────────────────────────

/**
 * Ease in sinusoidal — accelerating from zero velocity (smooth wave).
 *
 * @param t - Normalized time `[0, 1]`
 * @returns Eased value
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * easeInSine(0.5) // ≈ 0.293
 * ```
 */
export function easeInSine(t: number): number {
  return 1 - Math.cos((t * Math.PI) / 2);
}

/**
 * Ease out sinusoidal — decelerating to zero velocity (smooth wave).
 *
 * @param t - Normalized time `[0, 1]`
 * @returns Eased value
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * easeOutSine(0.5) // ≈ 0.707
 * ```
 */
export function easeOutSine(t: number): number {
  return Math.sin((t * Math.PI) / 2);
}

/**
 * Ease in-out sinusoidal — acceleration until halfway, then deceleration.
 *
 * @param t - Normalized time `[0, 1]`
 * @returns Eased value
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * easeInOutSine(0.25) // ≈ 0.146
 * easeInOutSine(0.75) // ≈ 0.854
 * ```
 */
export function easeInOutSine(t: number): number {
  return -(Math.cos(Math.PI * t) - 1) / 2;
}

// ── Exponential ──────────────────────────────────────────────────────────────

/**
 * Ease in exponential — accelerating from zero velocity (rapid growth, eˣ).
 *
 * @param t - Normalized time `[0, 1]`
 * @returns Eased value
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * easeInExpo(0.5) // ≈ 0.0312
 * ```
 */
export function easeInExpo(t: number): number {
  return t === 0 ? 0 : Math.pow(2, 10 * t - 10);
}

/**
 * Ease out exponential — decelerating to zero velocity (rapid deceleration).
 *
 * @param t - Normalized time `[0, 1]`
 * @returns Eased value
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * easeOutExpo(0.5) // ≈ 0.969
 * ```
 */
export function easeOutExpo(t: number): number {
  return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

/**
 * Ease in-out exponential — acceleration until halfway, then deceleration.
 *
 * @param t - Normalized time `[0, 1]`
 * @returns Eased value
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * easeInOutExpo(0.25) // ≈ 0.0156
 * easeInOutExpo(0.75) // ≈ 0.984
 * ```
 */
export function easeInOutExpo(t: number): number {
  return t === 0
    ? 0
    : t === 1
      ? 1
      : t < 0.5
        ? Math.pow(2, 20 * t - 10) / 2
        : (2 - Math.pow(2, -20 * t + 10)) / 2;
}

// ── Back (overshoot) ─────────────────────────────────────────────────────────

/**
 * Ease in back — accelerating with overshoot at the start.
 *
 * @param t - Normalized time `[0, 1]`
 * @returns Eased value
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * easeInBack(0.5) // ≈ -0.087
 * ```
 */
export function easeInBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return c3 * t * t * t - c1 * t * t;
}

/**
 * Ease out back — decelerating with overshoot at the end.
 *
 * @param t - Normalized time `[0, 1]`
 * @returns Eased value
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * easeOutBack(0.5) // ≈ 1.087
 * ```
 */
export function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) * (t - 1) * (t - 1) + c1 * (t - 1) * (t - 1);
}

/**
 * Ease in-out back — acceleration with overshoot, then deceleration with overshoot.
 *
 * @param t - Normalized time `[0, 1]`
 * @returns Eased value
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * easeInOutBack(0.25) // ≈ -0.044
 * easeInOutBack(0.75) // ≈ 1.044
 * ```
 */
export function easeInOutBack(t: number): number {
  const c1 = 1.70158;
  const c2 = c1 * 1.525;
  return t < 0.5
    ? (2 * t * (2 * t) * ((c2 + 1) * 2 * t - c2)) / 2
    : ((2 * t - 2) * (2 * t - 2) * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2;
}

// ── Elastic (oscillate) ──────────────────────────────────────────────────────

/**
 * Ease in elastic — oscillating at the start with elastic decay.
 *
 * @param t - Normalized time `[0, 1]`
 * @returns Eased value
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * easeInElastic(0.5) // ≈ -0.195
 * ```
 */
export function easeInElastic(t: number): number {
  const c4 = (2 * Math.PI) / 3;
  return t === 0 ? 0 : t === 1 ? 1 : -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * c4);
}

/**
 * Ease out elastic — oscillating at the end with elastic decay.
 *
 * @param t - Normalized time `[0, 1]`
 * @returns Eased value
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * easeOutElastic(0.5) // ≈ 1.195
 * ```
 */
export function easeOutElastic(t: number): number {
  const c4 = (2 * Math.PI) / 3;
  return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
}

/**
 * Ease in-out elastic — oscillating at start and end with elastic decay.
 *
 * @param t - Normalized time `[0, 1]`
 * @returns Eased value
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * easeInOutElastic(0.25) // ≈ -0.098
 * easeInOutElastic(0.75) // ≈ 1.098
 * ```
 */
export function easeInOutElastic(t: number): number {
  const c5 = (2 * Math.PI) / 4.5;
  return t === 0
    ? 0
    : t === 1
      ? 1
      : t < 0.5
        ? -(Math.pow(2, 20 * t - 10) * Math.sin((20 * t - 11.125) * c5)) / 2
        : (Math.pow(2, -20 * t + 10) * Math.sin((20 * t - 11.125) * c5)) / 2 + 1;
}

// ── Bounce (decay) ───────────────────────────────────────────────────────────

/**
 * Ease in bounce — bouncing at the start, settling quickly.
 *
 * @param t - Normalized time `[0, 1]`
 * @returns Eased value
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * easeInBounce(0.5) // ≈ 0.273
 * ```
 */
export function easeInBounce(t: number): number {
  return 1 - easeOutBounce(1 - t);
}

/**
 * Ease out bounce — bouncing to settle at the end.
 *
 * @param t - Normalized time `[0, 1]`
 * @returns Eased value
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * easeOutBounce(0.5) // ≈ 0.727
 * ```
 */
export function easeOutBounce(t: number): number {
  const n1 = 7.5625;
  const d1 = 2.75;

  if (t < 1 / d1) {
    return n1 * t * t;
  } else if (t < 2 / d1) {
    t -= 1.5 / d1;
    return n1 * t * t + 0.75;
  } else if (t < 2.5 / d1) {
    t -= 2.25 / d1;
    return n1 * t * t + 0.9375;
  } else {
    t -= 2.625 / d1;
    return n1 * t * t + 0.984375;
  }
}

/**
 * Ease in-out bounce — bouncing at start, then settling at end.
 *
 * @param t - Normalized time `[0, 1]`
 * @returns Eased value
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * easeInOutBounce(0.25) // ≈ 0.136
 * easeInOutBounce(0.75) // ≈ 0.864
 * ```
 */
export function easeInOutBounce(t: number): number {
  return t < 0.5 ? (1 - easeOutBounce(1 - 2 * t)) / 2 : (1 + easeOutBounce(2 * t - 1)) / 2;
}

// ── Spring (critically-damped) ───────────────────────────────────────────────

/**
 * Spring easing — critically-damped spring approximation.
 * Starts fast with slight overshoot, then quickly settles.
 *
 * Uses the formula: `1 - (1 + 20*t) * exp(-20*t)`
 *
 * @param t - Normalized time `[0, 1]`
 * @returns Eased value
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * spring(0.25) // ≈ 0.449
 * spring(0.5)  // ≈ 0.889
 * spring(1.0)  // ≈ 1.0
 * ```
 */
export function spring(t: number): number {
  return 1 - (1 + 20 * t) * Math.exp(-20 * t);
}

// ── Registry ─────────────────────────────────────────────────────────────────

/**
 * Lookup map to resolve easing function names to their implementations.
 * Used internally by tween systems to support string-based easing references.
 *
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * const fn = EASING_MAP['easeInCubic'];
 * console.log(fn(0.5)); // → 0.125
 * ```
 */
export const EASING_MAP: Record<EasingName, (t: number) => number> = {
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
};
