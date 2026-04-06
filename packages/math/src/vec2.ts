/**
 * GWEN Math — 2-D vector operations.
 *
 * All functions are pure (return new objects) unless the name ends in `Mut`.
 * This allows safe use in reactive contexts while still enabling in-place
 * mutation for hot-path game loops.
 */

import type { Vec2 } from './types.js';
import { EPSILON } from './scalar.js';

// ── Constructors ──────────────────────────────────────────────────────────────

/** Create a Vec2. */
export function vec2(x: number, y: number): Vec2 {
  return { x, y };
}

/** Vec2 at the origin `(0, 0)`. */
export function vec2Zero(): Vec2 {
  return { x: 0, y: 0 };
}

/** Vec2 unit `(1, 1)`. */
export function vec2One(): Vec2 {
  return { x: 1, y: 1 };
}

/** Unit vector pointing right `(1, 0)`. */
export function vec2Right(): Vec2 {
  return { x: 1, y: 0 };
}

/** Unit vector pointing up `(0, 1)`. */
export function vec2Up(): Vec2 {
  return { x: 0, y: 1 };
}

/**
 * Create a Vec2 from a polar angle (radians).
 * Produces a unit vector `(cos θ, sin θ)`.
 */
export function vec2FromAngle(angle: number): Vec2 {
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

// ── Arithmetic ────────────────────────────────────────────────────────────────

/** `a + b`. */
export function vec2Add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

/** `a + b` — mutates `a`. */
export function vec2AddMut(a: Vec2, b: Vec2): Vec2 {
  a.x += b.x;
  a.y += b.y;
  return a;
}

/** `a - b`. */
export function vec2Sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

/** `a - b` — mutates `a`. */
export function vec2SubMut(a: Vec2, b: Vec2): Vec2 {
  a.x -= b.x;
  a.y -= b.y;
  return a;
}

/** `v * scalar`. */
export function vec2Scale(v: Vec2, s: number): Vec2 {
  return { x: v.x * s, y: v.y * s };
}

/** `v * scalar` — mutates `v`. */
export function vec2ScaleMut(v: Vec2, s: number): Vec2 {
  v.x *= s;
  v.y *= s;
  return v;
}

/** Component-wise multiply `a * b`. */
export function vec2Mul(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x * b.x, y: a.y * b.y };
}

/** `-v`. */
export function vec2Negate(v: Vec2): Vec2 {
  return { x: -v.x, y: -v.y };
}

/** Shallow clone. */
export function vec2Clone(v: Vec2): Vec2 {
  return { x: v.x, y: v.y };
}

// ── Geometry ──────────────────────────────────────────────────────────────────

/** Dot product. */
export function vec2Dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

/**
 * 2-D "cross product" (scalar) — the z-component of `a × b` treated as 3-D vectors.
 * Positive ⟹ `b` is counter-clockwise from `a`.
 */
export function vec2Cross(a: Vec2, b: Vec2): number {
  return a.x * b.y - a.y * b.x;
}

/** Squared length — cheaper than {@link vec2Length} (avoids sqrt). */
export function vec2LengthSq(v: Vec2): number {
  return v.x * v.x + v.y * v.y;
}

/** Euclidean length. */
export function vec2Length(v: Vec2): number {
  return Math.sqrt(v.x * v.x + v.y * v.y);
}

/** Squared distance — cheaper than {@link vec2Distance}. */
export function vec2DistanceSq(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

/** Euclidean distance. */
export function vec2Distance(a: Vec2, b: Vec2): number {
  return Math.sqrt(vec2DistanceSq(a, b));
}

/**
 * Return a unit vector in the same direction as `v`.
 * Returns `(0, 0)` if `v` is near-zero.
 */
export function vec2Normalize(v: Vec2): Vec2 {
  const len = vec2Length(v);
  if (len < EPSILON) return { x: 0, y: 0 };
  return { x: v.x / len, y: v.y / len };
}

/**
 * Counter-clockwise perpendicular: `(-y, x)`.
 */
export function vec2Perp(v: Vec2): Vec2 {
  return { x: -v.y, y: v.x };
}

/**
 * Angle of `v` in radians, measured from the positive X-axis.
 * Range: `(-π, π]`.
 */
export function vec2Angle(v: Vec2): number {
  return Math.atan2(v.y, v.x);
}

/**
 * Angle between `a` and `b` in radians `[0, π]`.
 */
export function vec2AngleBetween(a: Vec2, b: Vec2): number {
  const lenProduct = vec2Length(a) * vec2Length(b);
  if (lenProduct < EPSILON) return 0;
  return Math.acos(Math.max(-1, Math.min(1, vec2Dot(a, b) / lenProduct)));
}

/**
 * Rotate `v` by `angle` radians counter-clockwise.
 */
export function vec2Rotate(v: Vec2, angle: number): Vec2 {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: v.x * cos - v.y * sin,
    y: v.x * sin + v.y * cos,
  };
}

/**
 * Reflect `v` about `normal` (must be unit length).
 * `r = v - 2 * dot(v, n) * n`
 */
export function vec2Reflect(v: Vec2, normal: Vec2): Vec2 {
  const d = 2 * vec2Dot(v, normal);
  return { x: v.x - d * normal.x, y: v.y - d * normal.y };
}

/**
 * Linear interpolation between `a` and `b` by factor `t`.
 */
export function vec2Lerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  };
}

/**
 * Clamp the length of `v` to at most `maxLength`.
 */
export function vec2ClampLength(v: Vec2, maxLength: number): Vec2 {
  const len = vec2Length(v);
  if (len <= maxLength || len < EPSILON) return vec2Clone(v);
  return vec2Scale(v, maxLength / len);
}

// ── Comparison ────────────────────────────────────────────────────────────────

/** Return `true` if `a` and `b` are component-wise within `epsilon`. */
export function vec2Equals(a: Vec2, b: Vec2, epsilon = EPSILON): boolean {
  return Math.abs(a.x - b.x) <= epsilon && Math.abs(a.y - b.y) <= epsilon;
}

/** Return `true` if both components are exactly zero. */
export function vec2IsZero(v: Vec2): boolean {
  return v.x === 0 && v.y === 0;
}
