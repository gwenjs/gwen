/**
 * GWEN Math — 4-D vector operations.
 *
 * All functions are pure (return new objects) unless the name ends in `Mut`.
 */

import type { Vec4 } from './types.js';

// ── Constructors ──────────────────────────────────────────────────────────────

/** Create a Vec4. */
export function vec4(x: number, y: number, z: number, w: number): Vec4 {
  return { x, y, z, w };
}

/** Vec4 at the origin `(0, 0, 0, 0)`. */
export function vec4Zero(): Vec4 {
  return { x: 0, y: 0, z: 0, w: 0 };
}

/** Vec4 unit `(1, 1, 1, 1)`. */
export function vec4One(): Vec4 {
  return { x: 1, y: 1, z: 1, w: 1 };
}

/** Homogeneous point `(x, y, z, 1)`. */
export function vec4Point(x: number, y: number, z: number): Vec4 {
  return { x, y, z, w: 1 };
}

/** Homogeneous direction `(x, y, z, 0)`. */
export function vec4Dir(x: number, y: number, z: number): Vec4 {
  return { x, y, z, w: 0 };
}

/** Shallow clone. */
export function vec4Clone(v: Vec4): Vec4 {
  return { x: v.x, y: v.y, z: v.z, w: v.w };
}

// ── Arithmetic ────────────────────────────────────────────────────────────────

/** `a + b`. */
export function vec4Add(a: Vec4, b: Vec4): Vec4 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z, w: a.w + b.w };
}

/** `a + b` — mutates `a`. */
export function vec4AddMut(a: Vec4, b: Vec4): Vec4 {
  a.x += b.x;
  a.y += b.y;
  a.z += b.z;
  a.w += b.w;
  return a;
}

/** `a - b`. */
export function vec4Sub(a: Vec4, b: Vec4): Vec4 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z, w: a.w - b.w };
}

/** `a - b` — mutates `a`. */
export function vec4SubMut(a: Vec4, b: Vec4): Vec4 {
  a.x -= b.x;
  a.y -= b.y;
  a.z -= b.z;
  a.w -= b.w;
  return a;
}

/** `v * s`. */
export function vec4Scale(v: Vec4, s: number): Vec4 {
  return { x: v.x * s, y: v.y * s, z: v.z * s, w: v.w * s };
}

/** `v * s` — mutates `v`. */
export function vec4ScaleMut(v: Vec4, s: number): Vec4 {
  v.x *= s;
  v.y *= s;
  v.z *= s;
  v.w *= s;
  return v;
}

/** Component-wise multiply. */
export function vec4Mul(a: Vec4, b: Vec4): Vec4 {
  return { x: a.x * b.x, y: a.y * b.y, z: a.z * b.z, w: a.w * b.w };
}

/** Negate. */
export function vec4Negate(v: Vec4): Vec4 {
  return { x: -v.x, y: -v.y, z: -v.z, w: -v.w };
}

/** Dot product. */
export function vec4Dot(a: Vec4, b: Vec4): number {
  return a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
}

/** Squared length. */
export function vec4LengthSq(v: Vec4): number {
  return v.x * v.x + v.y * v.y + v.z * v.z + v.w * v.w;
}

/** Length. */
export function vec4Length(v: Vec4): number {
  return Math.sqrt(vec4LengthSq(v));
}

/** Normalize. Returns `(0,0,0,0)` for zero-length vectors. */
export function vec4Normalize(v: Vec4): Vec4 {
  const len = vec4Length(v);
  if (len === 0) return vec4Zero();
  return vec4Scale(v, 1 / len);
}

/** Linear interpolation: `a + (b - a) * t`. */
export function vec4Lerp(a: Vec4, b: Vec4, t: number): Vec4 {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
    w: a.w + (b.w - a.w) * t,
  };
}

/** Strict equality. */
export function vec4Equals(a: Vec4, b: Vec4): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z && a.w === b.w;
}
