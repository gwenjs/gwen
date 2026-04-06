/**
 * GWEN Math — scalar helpers.
 *
 * Pure, allocation-free utilities for common 1-D math operations.
 * All functions are tree-shakeable.
 */

// ── Constants ─────────────────────────────────────────────────────────────────

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;
export const TAU = Math.PI * 2;
export const EPSILON = 1e-6;

// ── Basic interpolation ───────────────────────────────────────────────────────

/**
 * Linear interpolation between `a` and `b` by factor `t`.
 *
 * @param a - Start value.
 * @param b - End value.
 * @param t - Interpolation factor — not clamped; `0` returns `a`, `1` returns `b`.
 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Clamped linear interpolation — `t` is clamped to `[0, 1]`.
 */
export function lerpClamped(a: number, b: number, t: number): number {
  return lerp(a, b, clamp01(t));
}

/**
 * Inverse linear interpolation — returns the `t` that maps `v` back onto `[a, b]`.
 *
 * Returns `0` when `a === b` to avoid division by zero.
 */
export function inverseLerp(a: number, b: number, v: number): number {
  const d = b - a;
  return d === 0 ? 0 : (v - a) / d;
}

/**
 * Remap `v` from the range `[inMin, inMax]` to `[outMin, outMax]`.
 *
 * The result is **not** clamped — use {@link remapClamped} if you need that.
 */
export function remap(
  v: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
): number {
  return lerp(outMin, outMax, inverseLerp(inMin, inMax, v));
}

/**
 * Remap with output clamped to `[outMin, outMax]`.
 */
export function remapClamped(
  v: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
): number {
  return clamp(remap(v, inMin, inMax, outMin, outMax), outMin, outMax);
}

// ── Clamping ──────────────────────────────────────────────────────────────────

/** Clamp `v` to `[min, max]`. */
export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/** Clamp `v` to `[0, 1]`. */
export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// ── Smoothing ─────────────────────────────────────────────────────────────────

/**
 * Ken Perlin's cubic smooth-step.
 *
 * Returns 0 at `x ≤ edge0`, 1 at `x ≥ edge1`, and a smooth curve in between.
 * Input is clamped before mapping.
 */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/**
 * Quintic smooth-step (C² continuity at the edges).
 *
 * Same API as {@link smoothstep} but uses a degree-5 polynomial which has
 * zero first *and* second derivatives at the edges — eliminates "cubic seams"
 * in animated transitions.
 */
export function smootherstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

// ── Trigonometry ──────────────────────────────────────────────────────────────

/** Convert degrees to radians. */
export function degToRad(deg: number): number {
  return deg * DEG2RAD;
}

/** Convert radians to degrees. */
export function radToDeg(rad: number): number {
  return rad * RAD2DEG;
}

// ── Modular arithmetic ────────────────────────────────────────────────────────

/**
 * Non-negative remainder (always in `[0, length)`).
 *
 * Unlike the `%` operator this never returns a negative value.
 */
export function repeat(t: number, length: number): number {
  return t - Math.floor(t / length) * length;
}

/**
 * Ping-pong `t` between 0 and `length`.
 *
 * The value oscillates: 0 → length → 0 → length → …
 */
export function pingPong(t: number, length: number): number {
  const r = repeat(t, length * 2);
  return length - Math.abs(r - length);
}

/**
 * Wrap an angle (radians) to `(-π, π]`.
 */
export function wrapAngle(angle: number): number {
  const a = repeat(angle + Math.PI, TAU);
  return a - Math.PI;
}

// ── Comparison ────────────────────────────────────────────────────────────────

/**
 * Return `true` if `|a - b| <= epsilon`.
 * Defaults to {@link EPSILON} (`1e-6`).
 */
export function approxEqual(a: number, b: number, epsilon = EPSILON): boolean {
  return Math.abs(a - b) <= epsilon;
}

/**
 * Integer sign: `-1`, `0`, or `1`.
 */
export function sign(v: number): -1 | 0 | 1 {
  return v < 0 ? -1 : v > 0 ? 1 : 0;
}

// ── Misc ──────────────────────────────────────────────────────────────────────

/**
 * Move `current` towards `target` by at most `maxDelta` (never overshoots).
 */
export function moveTowards(current: number, target: number, maxDelta: number): number {
  const d = target - current;
  if (Math.abs(d) <= maxDelta) return target;
  return current + sign(d) * maxDelta;
}

/**
 * Move an angle (radians) towards `target` using the shortest arc,
 * stepping by at most `maxDelta`.
 */
export function moveTowardsAngle(current: number, target: number, maxDelta: number): number {
  const delta = wrapAngle(target - current);
  if (Math.abs(delta) <= maxDelta) return target;
  return current + sign(delta) * maxDelta;
}
