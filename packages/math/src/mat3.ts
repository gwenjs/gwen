/**
 * GWEN Math — 3×3 matrix operations (column-major, row-major storage).
 *
 * Used primarily for 2D transforms and 3D normal-matrix calculations.
 *
 * Storage: `[m00, m01, m02, m10, m11, m12, m20, m21, m22]` (row-major).
 *
 * All functions are pure (return new objects) unless the name ends in `Mut`.
 */

/** 3×3 matrix (row-major storage). */
export interface Mat3 {
  /** Row 0, Col 0 */ m00: number;
  /** Row 0, Col 1 */ m01: number;
  /** Row 0, Col 2 */ m02: number;
  /** Row 1, Col 0 */ m10: number;
  /** Row 1, Col 1 */ m11: number;
  /** Row 1, Col 2 */ m12: number;
  /** Row 2, Col 0 */ m20: number;
  /** Row 2, Col 1 */ m21: number;
  /** Row 2, Col 2 */ m22: number;
}

import type { Vec3 } from './types.js';

// ── Constructors ──────────────────────────────────────────────────────────────

/**
 * Create a Mat3 from 9 values (row-major order).
 *
 * @example
 * ```ts
 * const identity = mat3(1,0,0, 0,1,0, 0,0,1)
 * ```
 */
export function mat3(
  m00: number,
  m01: number,
  m02: number,
  m10: number,
  m11: number,
  m12: number,
  m20: number,
  m21: number,
  m22: number,
): Mat3 {
  return { m00, m01, m02, m10, m11, m12, m20, m21, m22 };
}

/** Identity 3×3 matrix. */
export function mat3Identity(): Mat3 {
  return mat3(1, 0, 0, 0, 1, 0, 0, 0, 1);
}

/** Zero 3×3 matrix. */
export function mat3Zero(): Mat3 {
  return mat3(0, 0, 0, 0, 0, 0, 0, 0, 0);
}

/** Shallow clone. */
export function mat3Clone(m: Mat3): Mat3 {
  return { ...m };
}

// ── Arithmetic ────────────────────────────────────────────────────────────────

/** Matrix multiply: `a * b`. */
export function mat3Mul(a: Mat3, b: Mat3): Mat3 {
  return mat3(
    a.m00 * b.m00 + a.m01 * b.m10 + a.m02 * b.m20,
    a.m00 * b.m01 + a.m01 * b.m11 + a.m02 * b.m21,
    a.m00 * b.m02 + a.m01 * b.m12 + a.m02 * b.m22,
    a.m10 * b.m00 + a.m11 * b.m10 + a.m12 * b.m20,
    a.m10 * b.m01 + a.m11 * b.m11 + a.m12 * b.m21,
    a.m10 * b.m02 + a.m11 * b.m12 + a.m12 * b.m22,
    a.m20 * b.m00 + a.m21 * b.m10 + a.m22 * b.m20,
    a.m20 * b.m01 + a.m21 * b.m11 + a.m22 * b.m21,
    a.m20 * b.m02 + a.m21 * b.m12 + a.m22 * b.m22,
  );
}

/** Transform a Vec3 by this matrix: `m * v`. */
export function mat3MulVec3(m: Mat3, v: Vec3): Vec3 {
  return {
    x: m.m00 * v.x + m.m01 * v.y + m.m02 * v.z,
    y: m.m10 * v.x + m.m11 * v.y + m.m12 * v.z,
    z: m.m20 * v.x + m.m21 * v.y + m.m22 * v.z,
  };
}

/** Transpose: rows ↔ columns. */
export function mat3Transpose(m: Mat3): Mat3 {
  return mat3(m.m00, m.m10, m.m20, m.m01, m.m11, m.m21, m.m02, m.m12, m.m22);
}

/** Determinant. */
export function mat3Det(m: Mat3): number {
  return (
    m.m00 * (m.m11 * m.m22 - m.m12 * m.m21) -
    m.m01 * (m.m10 * m.m22 - m.m12 * m.m20) +
    m.m02 * (m.m10 * m.m21 - m.m11 * m.m20)
  );
}

/**
 * Inverse. Returns `null` for singular matrices (det ≈ 0).
 */
export function mat3Inverse(m: Mat3): Mat3 | null {
  const det = mat3Det(m);
  if (Math.abs(det) < 1e-10) return null;
  const inv = 1 / det;
  return mat3(
    (m.m11 * m.m22 - m.m12 * m.m21) * inv,
    (m.m02 * m.m21 - m.m01 * m.m22) * inv,
    (m.m01 * m.m12 - m.m02 * m.m11) * inv,
    (m.m12 * m.m20 - m.m10 * m.m22) * inv,
    (m.m00 * m.m22 - m.m02 * m.m20) * inv,
    (m.m02 * m.m10 - m.m00 * m.m12) * inv,
    (m.m10 * m.m21 - m.m11 * m.m20) * inv,
    (m.m01 * m.m20 - m.m00 * m.m21) * inv,
    (m.m00 * m.m11 - m.m01 * m.m10) * inv,
  );
}

// ── 2D Transform factories ────────────────────────────────────────────────────

/** 2D translation matrix (homogeneous). */
export function mat3Translate(tx: number, ty: number): Mat3 {
  return mat3(1, 0, tx, 0, 1, ty, 0, 0, 1);
}

/** 2D rotation matrix. `angle` in radians. */
export function mat3Rotate(angle: number): Mat3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return mat3(c, -s, 0, s, c, 0, 0, 0, 1);
}

/** 2D scale matrix. */
export function mat3Scale(sx: number, sy: number): Mat3 {
  return mat3(sx, 0, 0, 0, sy, 0, 0, 0, 1);
}

/** Normal matrix: transpose of the inverse of a Mat4's upper-left 3×3 (extracted here directly). */
export function mat3NormalFromMat3(m: Mat3): Mat3 | null {
  return mat3Transpose(mat3Inverse(m) ?? mat3Identity()) ?? null;
}

/** Strict equality. */
export function mat3Equals(a: Mat3, b: Mat3): boolean {
  return (
    a.m00 === b.m00 &&
    a.m01 === b.m01 &&
    a.m02 === b.m02 &&
    a.m10 === b.m10 &&
    a.m11 === b.m11 &&
    a.m12 === b.m12 &&
    a.m20 === b.m20 &&
    a.m21 === b.m21 &&
    a.m22 === b.m22
  );
}
