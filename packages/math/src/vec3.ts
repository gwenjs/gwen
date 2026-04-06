/**
 * GWEN Math — 3-D vector operations.
 *
 * All functions are pure (return new objects) unless the name ends in `Mut`.
 */

import type { Vec3 } from './types.js';
import { EPSILON } from './scalar.js';

// ── Constructors ──────────────────────────────────────────────────────────────

/** Create a Vec3. */
export function vec3(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

/** Vec3 at the origin `(0, 0, 0)`. */
export function vec3Zero(): Vec3 {
  return { x: 0, y: 0, z: 0 };
}

/** Vec3 unit `(1, 1, 1)`. */
export function vec3One(): Vec3 {
  return { x: 1, y: 1, z: 1 };
}

/** Right direction `(1, 0, 0)`. */
export function vec3Right(): Vec3 {
  return { x: 1, y: 0, z: 0 };
}

/** Up direction `(0, 1, 0)`. */
export function vec3Up(): Vec3 {
  return { x: 0, y: 1, z: 0 };
}

/** Forward direction `(0, 0, -1)` — right-handed coordinate system. */
export function vec3Forward(): Vec3 {
  return { x: 0, y: 0, z: -1 };
}

/** Shallow clone. */
export function vec3Clone(v: Vec3): Vec3 {
  return { x: v.x, y: v.y, z: v.z };
}

// ── Arithmetic ────────────────────────────────────────────────────────────────

/** `a + b`. */
export function vec3Add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

/** `a + b` — mutates `a`. */
export function vec3AddMut(a: Vec3, b: Vec3): Vec3 {
  a.x += b.x;
  a.y += b.y;
  a.z += b.z;
  return a;
}

/** `a - b`. */
export function vec3Sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

/** `a - b` — mutates `a`. */
export function vec3SubMut(a: Vec3, b: Vec3): Vec3 {
  a.x -= b.x;
  a.y -= b.y;
  a.z -= b.z;
  return a;
}

/** `v * scalar`. */
export function vec3Scale(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

/** `v * scalar` — mutates `v`. */
export function vec3ScaleMut(v: Vec3, s: number): Vec3 {
  v.x *= s;
  v.y *= s;
  v.z *= s;
  return v;
}

/** Component-wise multiply `a * b`. */
export function vec3Mul(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x * b.x, y: a.y * b.y, z: a.z * b.z };
}

/** `-v`. */
export function vec3Negate(v: Vec3): Vec3 {
  return { x: -v.x, y: -v.y, z: -v.z };
}

// ── Geometry ──────────────────────────────────────────────────────────────────

/** Dot product. */
export function vec3Dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/** Cross product — returns a vector perpendicular to both `a` and `b`. */
export function vec3Cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

/** Squared length — cheaper than {@link vec3Length}. */
export function vec3LengthSq(v: Vec3): number {
  return v.x * v.x + v.y * v.y + v.z * v.z;
}

/** Euclidean length. */
export function vec3Length(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

/** Squared distance. */
export function vec3DistanceSq(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x,
    dy = a.y - b.y,
    dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

/** Euclidean distance. */
export function vec3Distance(a: Vec3, b: Vec3): number {
  return Math.sqrt(vec3DistanceSq(a, b));
}

/**
 * Return a unit vector in the same direction as `v`.
 * Returns `(0, 0, 0)` if `v` is near-zero.
 */
export function vec3Normalize(v: Vec3): Vec3 {
  const len = vec3Length(v);
  if (len < EPSILON) return { x: 0, y: 0, z: 0 };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

/**
 * Angle between `a` and `b` in radians `[0, π]`.
 */
export function vec3AngleBetween(a: Vec3, b: Vec3): number {
  const lenProduct = vec3Length(a) * vec3Length(b);
  if (lenProduct < EPSILON) return 0;
  return Math.acos(Math.max(-1, Math.min(1, vec3Dot(a, b) / lenProduct)));
}

/**
 * Reflect `v` about `normal` (must be unit length).
 * `r = v - 2 * dot(v, n) * n`
 */
export function vec3Reflect(v: Vec3, normal: Vec3): Vec3 {
  const d = 2 * vec3Dot(v, normal);
  return {
    x: v.x - d * normal.x,
    y: v.y - d * normal.y,
    z: v.z - d * normal.z,
  };
}

/**
 * Project `v` onto unit vector `onto`.
 */
export function vec3Project(v: Vec3, onto: Vec3): Vec3 {
  const d = vec3Dot(v, onto);
  return { x: onto.x * d, y: onto.y * d, z: onto.z * d };
}

/**
 * Reject `v` from `onto` (component perpendicular to `onto`).
 */
export function vec3Reject(v: Vec3, onto: Vec3): Vec3 {
  const proj = vec3Project(v, onto);
  return { x: v.x - proj.x, y: v.y - proj.y, z: v.z - proj.z };
}

/**
 * Linear interpolation between `a` and `b` by factor `t`.
 */
export function vec3Lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

/**
 * Clamp the length of `v` to at most `maxLength`.
 */
export function vec3ClampLength(v: Vec3, maxLength: number): Vec3 {
  const len = vec3Length(v);
  if (len <= maxLength || len < EPSILON) return vec3Clone(v);
  return vec3Scale(v, maxLength / len);
}

// ── Comparison ────────────────────────────────────────────────────────────────

/** Return `true` if `a` and `b` are component-wise within `epsilon`. */
export function vec3Equals(a: Vec3, b: Vec3, epsilon = EPSILON): boolean {
  return (
    Math.abs(a.x - b.x) <= epsilon &&
    Math.abs(a.y - b.y) <= epsilon &&
    Math.abs(a.z - b.z) <= epsilon
  );
}

/** Return `true` if all components are exactly zero. */
export function vec3IsZero(v: Vec3): boolean {
  return v.x === 0 && v.y === 0 && v.z === 0;
}
