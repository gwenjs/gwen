/**
 * GWEN Math — quaternion operations.
 *
 * Quaternions represent 3-D rotations as `(x, y, z, w)` where
 * the identity is `(0, 0, 0, 1)` — same convention as `Types.quat`
 * in `@gwenjs/core`.
 *
 * All functions are pure unless the name ends in `Mut`.
 */

import type { Quat, Vec3 } from './types.js';
import { EPSILON } from './scalar.js';

// ── Constructors ──────────────────────────────────────────────────────────────

/** Identity quaternion `(0, 0, 0, 1)`. */
export function quatIdentity(): Quat {
  return { x: 0, y: 0, z: 0, w: 1 };
}

/** Shallow clone. */
export function quatClone(q: Quat): Quat {
  return { x: q.x, y: q.y, z: q.z, w: q.w };
}

/**
 * Create a quaternion from an axis-angle representation.
 *
 * @param axis  - Unit vector axis.
 * @param angle - Rotation angle in **radians**.
 */
export function quatFromAxisAngle(axis: Vec3, angle: number): Quat {
  const half = angle * 0.5;
  const s = Math.sin(half);
  return {
    x: axis.x * s,
    y: axis.y * s,
    z: axis.z * s,
    w: Math.cos(half),
  };
}

/**
 * Create a quaternion from Euler angles (radians) — **YXZ** intrinsic order
 * (yaw, pitch, roll), which is the most common convention for games.
 *
 * @param x - Pitch (rotation around X-axis).
 * @param y - Yaw   (rotation around Y-axis).
 * @param z - Roll  (rotation around Z-axis).
 */
export function quatFromEuler(x: number, y: number, z: number): Quat {
  const cx = Math.cos(x * 0.5),
    sx = Math.sin(x * 0.5);
  const cy = Math.cos(y * 0.5),
    sy = Math.sin(y * 0.5);
  const cz = Math.cos(z * 0.5),
    sz = Math.sin(z * 0.5);

  // YXZ order
  return {
    x: sx * cy * cz + cx * sy * sz,
    y: cx * sy * cz - sx * cy * sz,
    z: cx * cy * sz - sx * sy * cz,
    w: cx * cy * cz + sx * sy * sz,
  };
}

/**
 * Create a quaternion that rotates `from` direction to `to` direction.
 * Both inputs are assumed to be unit vectors.
 */
export function quatFromTo(from: Vec3, to: Vec3): Quat {
  const dot = from.x * to.x + from.y * to.y + from.z * to.z;

  if (dot >= 1 - EPSILON) return quatIdentity();

  if (dot <= -1 + EPSILON) {
    // 180° rotation — pick an arbitrary perpendicular axis
    let axis: Vec3 = { x: 1, y: 0, z: 0 };
    const absDot = Math.abs(from.x);
    if (absDot < 0.577) {
      const len = Math.sqrt(from.y * from.y + from.z * from.z);
      axis = { x: 0, y: from.z / len, z: -from.y / len };
    }
    return { x: axis.x, y: axis.y, z: axis.z, w: 0 };
  }

  const cx = from.y * to.z - from.z * to.y;
  const cy = from.z * to.x - from.x * to.z;
  const cz = from.x * to.y - from.y * to.x;
  const q = { x: cx, y: cy, z: cz, w: 1 + dot };
  return quatNormalize(q);
}

/**
 * Rotation quaternion that points `forward` towards `target`, using `up` as the
 * reference up vector (default `(0, 1, 0)`).
 */
export function quatLookAt(forward: Vec3, up: Vec3 = { x: 0, y: 1, z: 0 }): Quat {
  // Build an orthonormal basis
  const f = _normalize3(forward);
  const r = _normalize3(_cross3(f, up));
  const u = _cross3(r, f);

  // Convert rotation matrix to quaternion
  const trace = r.x + u.y - f.z; // note: forward is -Z in right-handed
  let q: Quat;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    q = {
      w: 0.25 / s,
      x: (u.z - -f.y) * s,
      y: (-f.x - r.z) * s,
      z: (r.y - u.x) * s,
    };
  } else if (r.x > u.y && r.x > -f.z) {
    const s = 2 * Math.sqrt(1 + r.x - u.y + f.z);
    q = {
      w: (u.z + f.y) / s,
      x: 0.25 * s,
      y: (r.y + u.x) / s,
      z: (-f.x + r.z) / s,
    };
  } else if (u.y > -f.z) {
    const s = 2 * Math.sqrt(1 + u.y - r.x + f.z);
    q = {
      w: (-f.x + r.z) / s,
      x: (r.y + u.x) / s,
      y: 0.25 * s,
      z: (u.z + f.y) / s,
    };
  } else {
    const s = 2 * Math.sqrt(1 - f.z - r.x - u.y);
    q = {
      w: (r.y - u.x) / s,
      x: (-f.x + r.z) / s,
      y: (u.z + f.y) / s,
      z: 0.25 * s,
    };
  }
  return quatNormalize(q);
}

// ── Arithmetic ────────────────────────────────────────────────────────────────

/** Quaternion multiplication `a * b` — applies rotation `b` then `a`. */
export function quatMultiply(a: Quat, b: Quat): Quat {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

/** Dot product of two quaternions (used for slerp). */
export function quatDot(a: Quat, b: Quat): number {
  return a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
}

/** Conjugate (inverse for unit quaternions). */
export function quatConjugate(q: Quat): Quat {
  return { x: -q.x, y: -q.y, z: -q.z, w: q.w };
}

/** Inverse — works for non-unit quaternions (falls back to conjugate when unit). */
export function quatInverse(q: Quat): Quat {
  const lenSq = q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w;
  if (lenSq < EPSILON) return quatIdentity();
  const invLen = 1 / lenSq;
  return { x: -q.x * invLen, y: -q.y * invLen, z: -q.z * invLen, w: q.w * invLen };
}

/** Normalise to unit length. Returns identity if near-zero. */
export function quatNormalize(q: Quat): Quat {
  const len = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w);
  if (len < EPSILON) return quatIdentity();
  return { x: q.x / len, y: q.y / len, z: q.z / len, w: q.w / len };
}

// ── Rotation ──────────────────────────────────────────────────────────────────

/**
 * Rotate a 3-D vector by a unit quaternion.
 * Uses the formula `q * (0, v) * q⁻¹`.
 */
export function quatRotateVec3(q: Quat, v: Vec3): Vec3 {
  // Optimised sandwich product
  const qx = q.x,
    qy = q.y,
    qz = q.z,
    qw = q.w;
  const vx = v.x,
    vy = v.y,
    vz = v.z;
  // t = 2 * cross(q.xyz, v)
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  return {
    x: vx + qw * tx + qy * tz - qz * ty,
    y: vy + qw * ty + qz * tx - qx * tz,
    z: vz + qw * tz + qx * ty - qy * tx,
  };
}

// ── Interpolation ─────────────────────────────────────────────────────────────

/**
 * Normalised linear interpolation — cheaper than slerp but slightly non-constant
 * angular velocity near 180°.
 */
export function quatNlerp(a: Quat, b: Quat, t: number): Quat {
  // Ensure shortest path
  const d = quatDot(a, b);
  const bx = d < 0 ? -b.x : b.x;
  const by = d < 0 ? -b.y : b.y;
  const bz = d < 0 ? -b.z : b.z;
  const bw = d < 0 ? -b.w : b.w;
  const inv = 1 - t;
  return quatNormalize({
    x: inv * a.x + t * bx,
    y: inv * a.y + t * by,
    z: inv * a.z + t * bz,
    w: inv * a.w + t * bw,
  });
}

/**
 * Spherical linear interpolation — constant angular velocity.
 * Falls back to {@link quatNlerp} when the angle is very small.
 */
export function quatSlerp(a: Quat, b: Quat, t: number): Quat {
  let dot = quatDot(a, b);

  // Choose shortest arc
  let bx = b.x,
    by = b.y,
    bz = b.z,
    bw = b.w;
  if (dot < 0) {
    dot = -dot;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }

  if (dot > 1 - EPSILON) {
    // Very close — use nlerp
    return quatNormalize({
      x: a.x + t * (bx - a.x),
      y: a.y + t * (by - a.y),
      z: a.z + t * (bz - a.z),
      w: a.w + t * (bw - a.w),
    });
  }

  const theta = Math.acos(dot);
  const sinTheta = Math.sin(theta);
  const wa = Math.sin((1 - t) * theta) / sinTheta;
  const wb = Math.sin(t * theta) / sinTheta;
  return {
    x: wa * a.x + wb * bx,
    y: wa * a.y + wb * by,
    z: wa * a.z + wb * bz,
    w: wa * a.w + wb * bw,
  };
}

// ── Conversion ────────────────────────────────────────────────────────────────

/**
 * Extract Euler angles (radians) from a unit quaternion — **YXZ** intrinsic order.
 * Returns `{ x: pitch, y: yaw, z: roll }`.
 *
 * Decomposition matches Three.js Euler('YXZ') convention.
 */
export function quatToEuler(q: Quat): Vec3 {
  const { x, y, z, w } = q;

  // X (pitch) — the "singular" axis in YXZ decomposition
  const sinX = 2 * (w * x - y * z);
  let px: number;
  if (Math.abs(sinX) >= 1 - EPSILON) {
    px = Math.sign(sinX) * (Math.PI / 2); // clamp to ±90°
  } else {
    px = Math.asin(sinX);
  }

  // Y (yaw)
  const py = Math.atan2(2 * (x * z + w * y), 1 - 2 * (x * x + y * y));

  // Z (roll)
  const pz = Math.atan2(2 * (x * y + w * z), 1 - 2 * (x * x + z * z));

  return { x: px, y: py, z: pz };
}

// ── Comparison ────────────────────────────────────────────────────────────────

/** Return `true` if `a` and `b` represent the same rotation within `epsilon`. */
export function quatEquals(a: Quat, b: Quat, epsilon = EPSILON): boolean {
  return (
    Math.abs(quatDot(a, b)) >= 1 - epsilon ||
    (Math.abs(a.x - b.x) <= epsilon &&
      Math.abs(a.y - b.y) <= epsilon &&
      Math.abs(a.z - b.z) <= epsilon &&
      Math.abs(a.w - b.w) <= epsilon)
  );
}

// ── Private helpers ───────────────────────────────────────────────────────────

function _normalize3(v: Vec3): Vec3 {
  const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  if (len < EPSILON) return { x: 0, y: 0, z: 0 };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function _cross3(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}
