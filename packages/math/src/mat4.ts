/**
 * GWEN Math — 4×4 matrix operations (row-major storage).
 *
 * Used for 3D model/view/projection transforms.
 *
 * Storage: rows 0–3, each with columns 0–3.
 * All functions are pure (return new objects) unless the name ends in `Mut`.
 */

import type { Vec3, Vec4 } from './types.js';
import type { Quat } from './types.js';
import type { Mat3 } from './mat3.js';

/** 4×4 matrix (row-major storage). */
export interface Mat4 {
  m00: number;
  m01: number;
  m02: number;
  m03: number;
  m10: number;
  m11: number;
  m12: number;
  m13: number;
  m20: number;
  m21: number;
  m22: number;
  m23: number;
  m30: number;
  m31: number;
  m32: number;
  m33: number;
}

// ── Constructors ──────────────────────────────────────────────────────────────

/**
 * Create a Mat4 from 16 values in row-major order.
 *
 * @example
 * ```ts
 * const identity = mat4(1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1)
 * ```
 */
export function mat4(
  m00: number,
  m01: number,
  m02: number,
  m03: number,
  m10: number,
  m11: number,
  m12: number,
  m13: number,
  m20: number,
  m21: number,
  m22: number,
  m23: number,
  m30: number,
  m31: number,
  m32: number,
  m33: number,
): Mat4 {
  return { m00, m01, m02, m03, m10, m11, m12, m13, m20, m21, m22, m23, m30, m31, m32, m33 };
}

/** Identity 4×4 matrix. */
export function mat4Identity(): Mat4 {
  return mat4(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
}

/** Zero 4×4 matrix. */
export function mat4Zero(): Mat4 {
  return mat4(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
}

/** Shallow clone. */
export function mat4Clone(m: Mat4): Mat4 {
  return { ...m };
}

// ── Arithmetic ────────────────────────────────────────────────────────────────

/** Matrix multiply: `a * b`. */
export function mat4Mul(a: Mat4, b: Mat4): Mat4 {
  return mat4(
    a.m00 * b.m00 + a.m01 * b.m10 + a.m02 * b.m20 + a.m03 * b.m30,
    a.m00 * b.m01 + a.m01 * b.m11 + a.m02 * b.m21 + a.m03 * b.m31,
    a.m00 * b.m02 + a.m01 * b.m12 + a.m02 * b.m22 + a.m03 * b.m32,
    a.m00 * b.m03 + a.m01 * b.m13 + a.m02 * b.m23 + a.m03 * b.m33,
    a.m10 * b.m00 + a.m11 * b.m10 + a.m12 * b.m20 + a.m13 * b.m30,
    a.m10 * b.m01 + a.m11 * b.m11 + a.m12 * b.m21 + a.m13 * b.m31,
    a.m10 * b.m02 + a.m11 * b.m12 + a.m12 * b.m22 + a.m13 * b.m32,
    a.m10 * b.m03 + a.m11 * b.m13 + a.m12 * b.m23 + a.m13 * b.m33,
    a.m20 * b.m00 + a.m21 * b.m10 + a.m22 * b.m20 + a.m23 * b.m30,
    a.m20 * b.m01 + a.m21 * b.m11 + a.m22 * b.m21 + a.m23 * b.m31,
    a.m20 * b.m02 + a.m21 * b.m12 + a.m22 * b.m22 + a.m23 * b.m32,
    a.m20 * b.m03 + a.m21 * b.m13 + a.m22 * b.m23 + a.m23 * b.m33,
    a.m30 * b.m00 + a.m31 * b.m10 + a.m32 * b.m20 + a.m33 * b.m30,
    a.m30 * b.m01 + a.m31 * b.m11 + a.m32 * b.m21 + a.m33 * b.m31,
    a.m30 * b.m02 + a.m31 * b.m12 + a.m32 * b.m22 + a.m33 * b.m32,
    a.m30 * b.m03 + a.m31 * b.m13 + a.m32 * b.m23 + a.m33 * b.m33,
  );
}

/** Transform a Vec4 by this matrix: `m * v`. */
export function mat4MulVec4(m: Mat4, v: Vec4): Vec4 {
  return {
    x: m.m00 * v.x + m.m01 * v.y + m.m02 * v.z + m.m03 * v.w,
    y: m.m10 * v.x + m.m11 * v.y + m.m12 * v.z + m.m13 * v.w,
    z: m.m20 * v.x + m.m21 * v.y + m.m22 * v.z + m.m23 * v.w,
    w: m.m30 * v.x + m.m31 * v.y + m.m32 * v.z + m.m33 * v.w,
  };
}

/**
 * Transform a Vec3 point by this matrix (assumes w=1, perspective-divides result).
 */
export function mat4MulPoint(m: Mat4, v: Vec3): Vec3 {
  const w = m.m30 * v.x + m.m31 * v.y + m.m32 * v.z + m.m33;
  const invW = w !== 0 ? 1 / w : 1;
  return {
    x: (m.m00 * v.x + m.m01 * v.y + m.m02 * v.z + m.m03) * invW,
    y: (m.m10 * v.x + m.m11 * v.y + m.m12 * v.z + m.m13) * invW,
    z: (m.m20 * v.x + m.m21 * v.y + m.m22 * v.z + m.m23) * invW,
  };
}

/**
 * Transform a Vec3 direction (w=0) — no translation applied.
 */
export function mat4MulDir(m: Mat4, v: Vec3): Vec3 {
  return {
    x: m.m00 * v.x + m.m01 * v.y + m.m02 * v.z,
    y: m.m10 * v.x + m.m11 * v.y + m.m12 * v.z,
    z: m.m20 * v.x + m.m21 * v.y + m.m22 * v.z,
  };
}

/** Transpose: rows ↔ columns. */
export function mat4Transpose(m: Mat4): Mat4 {
  return mat4(
    m.m00,
    m.m10,
    m.m20,
    m.m30,
    m.m01,
    m.m11,
    m.m21,
    m.m31,
    m.m02,
    m.m12,
    m.m22,
    m.m32,
    m.m03,
    m.m13,
    m.m23,
    m.m33,
  );
}

/**
 * Extract the upper-left 3×3 sub-matrix.
 * Useful for computing normal matrices.
 */
export function mat4ToMat3(m: Mat4): Mat3 {
  return {
    m00: m.m00,
    m01: m.m01,
    m02: m.m02,
    m10: m.m10,
    m11: m.m11,
    m12: m.m12,
    m20: m.m20,
    m21: m.m21,
    m22: m.m22,
  };
}

// ── 3D Transform factories ────────────────────────────────────────────────────

/** Translation matrix. */
export function mat4Translate(tx: number, ty: number, tz: number): Mat4 {
  return mat4(1, 0, 0, tx, 0, 1, 0, ty, 0, 0, 1, tz, 0, 0, 0, 1);
}

/** Scale matrix. */
export function mat4Scale(sx: number, sy: number, sz: number): Mat4 {
  return mat4(sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, sz, 0, 0, 0, 0, 1);
}

/** Rotation around the X axis. `angle` in radians. */
export function mat4RotateX(angle: number): Mat4 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return mat4(1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0, 0, 0, 0, 1);
}

/** Rotation around the Y axis. `angle` in radians. */
export function mat4RotateY(angle: number): Mat4 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return mat4(c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, 0, 0, 0, 1);
}

/** Rotation around the Z axis. `angle` in radians. */
export function mat4RotateZ(angle: number): Mat4 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return mat4(c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
}

/** Build a rotation matrix from a unit quaternion. */
export function mat4FromQuat(q: Quat): Mat4 {
  const { x, y, z, w } = q;
  const x2 = x + x,
    y2 = y + y,
    z2 = z + z;
  const xx = x * x2,
    xy = x * y2,
    xz = x * z2;
  const yy = y * y2,
    yz = y * z2,
    zz = z * z2;
  const wx = w * x2,
    wy = w * y2,
    wz = w * z2;
  return mat4(
    1 - (yy + zz),
    xy - wz,
    xz + wy,
    0,
    xy + wz,
    1 - (xx + zz),
    yz - wx,
    0,
    xz - wy,
    yz + wx,
    1 - (xx + yy),
    0,
    0,
    0,
    0,
    1,
  );
}

/**
 * TRS matrix: Translation × Rotation × Scale.
 * Efficiently combines the three transforms without separate matrix multiplies.
 */
export function mat4TRS(t: Vec3, r: Quat, s: Vec3): Mat4 {
  const { x, y, z, w } = r;
  const x2 = x + x,
    y2 = y + y,
    z2 = z + z;
  const xx = x * x2,
    xy = x * y2,
    xz = x * z2;
  const yy = y * y2,
    yz = y * z2,
    zz = z * z2;
  const wx = w * x2,
    wy = w * y2,
    wz = w * z2;
  return mat4(
    (1 - (yy + zz)) * s.x,
    (xy - wz) * s.y,
    (xz + wy) * s.z,
    t.x,
    (xy + wz) * s.x,
    (1 - (xx + zz)) * s.y,
    (yz - wx) * s.z,
    t.y,
    (xz - wy) * s.x,
    (yz + wx) * s.y,
    (1 - (xx + yy)) * s.z,
    t.z,
    0,
    0,
    0,
    1,
  );
}

// ── Projection ────────────────────────────────────────────────────────────────

/**
 * Perspective projection matrix (right-handed, depth range [-1, 1]).
 *
 * @param fovY  Vertical field-of-view in radians.
 * @param aspect  Viewport width / height.
 * @param near  Near clip plane (> 0).
 * @param far   Far clip plane (> near).
 */
export function mat4Perspective(fovY: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovY / 2);
  const nf = 1 / (near - far);
  return mat4(
    f / aspect,
    0,
    0,
    0,
    0,
    f,
    0,
    0,
    0,
    0,
    (far + near) * nf,
    2 * far * near * nf,
    0,
    0,
    -1,
    0,
  );
}

/**
 * Orthographic projection matrix (right-handed, depth range [-1, 1]).
 */
export function mat4Ortho(
  left: number,
  right: number,
  bottom: number,
  top: number,
  near: number,
  far: number,
): Mat4 {
  const rl = 1 / (right - left);
  const tb = 1 / (top - bottom);
  const fn = 1 / (far - near);
  return mat4(
    2 * rl,
    0,
    0,
    -(right + left) * rl,
    0,
    2 * tb,
    0,
    -(top + bottom) * tb,
    0,
    0,
    -2 * fn,
    -(far + near) * fn,
    0,
    0,
    0,
    1,
  );
}

/**
 * Look-at view matrix.
 *
 * @param eye     Camera position.
 * @param center  Target point to look at.
 * @param up      World up vector (usually `(0, 1, 0)`).
 */
export function mat4LookAt(eye: Vec3, center: Vec3, up: Vec3): Mat4 {
  const fx = center.x - eye.x;
  const fy = center.y - eye.y;
  const fz = center.z - eye.z;
  const fLen = Math.sqrt(fx * fx + fy * fy + fz * fz);
  if (fLen === 0) return mat4Identity();
  const invF = 1 / fLen;
  const f0 = fx * invF,
    f1 = fy * invF,
    f2 = fz * invF;

  // right = normalize(f × up)
  let rx = f1 * up.z - f2 * up.y;
  let ry = f2 * up.x - f0 * up.z;
  let rz = f0 * up.y - f1 * up.x;
  const rLen = Math.sqrt(rx * rx + ry * ry + rz * rz);
  if (rLen === 0) return mat4Identity();
  const invR = 1 / rLen;
  rx *= invR;
  ry *= invR;
  rz *= invR;

  // recalculated up = right × f
  const ux = ry * f2 - rz * f1;
  const uy = rz * f0 - rx * f2;
  const uz = rx * f1 - ry * f0;

  return mat4(
    rx,
    ry,
    rz,
    -(rx * eye.x + ry * eye.y + rz * eye.z),
    ux,
    uy,
    uz,
    -(ux * eye.x + uy * eye.y + uz * eye.z),
    -f0,
    -f1,
    -f2,
    f0 * eye.x + f1 * eye.y + f2 * eye.z,
    0,
    0,
    0,
    1,
  );
}

/** Strict equality. */
export function mat4Equals(a: Mat4, b: Mat4): boolean {
  return (
    a.m00 === b.m00 &&
    a.m01 === b.m01 &&
    a.m02 === b.m02 &&
    a.m03 === b.m03 &&
    a.m10 === b.m10 &&
    a.m11 === b.m11 &&
    a.m12 === b.m12 &&
    a.m13 === b.m13 &&
    a.m20 === b.m20 &&
    a.m21 === b.m21 &&
    a.m22 === b.m22 &&
    a.m23 === b.m23 &&
    a.m30 === b.m30 &&
    a.m31 === b.m31 &&
    a.m32 === b.m32 &&
    a.m33 === b.m33
  );
}
