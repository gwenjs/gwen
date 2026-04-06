/**
 * GWEN Math — shared primitive types.
 *
 * These mirror the spatial primitives defined in `@gwenjs/core`
 * (`Types.vec2`, `Types.vec3`, `Types.quat`, `Types.color`) so components and
 * math helpers stay structurally compatible without a hard dependency.
 */

/** 2-component vector. */
export interface Vec2 {
  x: number;
  y: number;
}

/** 3-component vector. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** 4-component vector. */
export interface Vec4 {
  x: number;
  y: number;
  z: number;
  w: number;
}

/**
 * Unit quaternion — represents a 3D rotation.
 * Identity: `{ x: 0, y: 0, z: 0, w: 1 }`.
 */
export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

/** RGBA colour — each channel in `[0, 1]`. */
export interface Color {
  r: number;
  g: number;
  b: number;
  a: number;
}

// ── Spring states ─────────────────────────────────────────────────────────────

/** Mutable state for a 1-D spring simulation. */
export interface SpringState1D {
  /** Current value. */
  value: number;
  /** Current velocity (units / second). */
  velocity: number;
}

/** Mutable state for a 2-D spring simulation. */
export interface SpringState2D {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/** Mutable state for a 3-D spring simulation. */
export interface SpringState3D {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

/** Tuning parameters shared by all spring helpers. */
export interface SpringOptions {
  /**
   * Stiffness (spring constant *k*).
   * Higher ⟹ snappier response.
   * Typical range: `1` – `500`.
   */
  stiffness: number;
  /**
   * Damping coefficient.
   * `2 * sqrt(stiffness)` gives critical damping (no overshoot).
   * Lower ⟹ more oscillation; higher ⟹ slower return.
   */
  damping: number;
}
