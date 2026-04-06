/**
 * GWEN Math — exponential smoothing (damp).
 *
 * Frame-rate independent smoothing based on the formula:
 *
 *   `value = lerp(current, target, 1 - exp(-lambda * dt))`
 *
 * This is mathematically equivalent to an infinite-impulse-response (IIR) low-pass
 * filter and is the preferred way to smooth continuous values in game loops.
 *
 * Reference: Freya Holmér "Lerp smoothing is broken" — use `damp` instead.
 */

import { lerp, wrapAngle } from './scalar.js';
import type { Vec2, Vec3 } from './types.js';

// ── Scalar damp ───────────────────────────────────────────────────────────────

/**
 * Exponentially decay `current` towards `target`.
 *
 * @param current - Present value.
 * @param target  - Desired value.
 * @param lambda  - Decay rate (> 0). Higher ⟹ faster.
 *                  `lambda ≈ 1/halfLifeSeconds * ln(2)`.
 * @param dt      - Delta time in **seconds**.
 */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

/**
 * Exponentially decay an angle (radians) towards `target` via the shortest arc.
 */
export function dampAngle(current: number, target: number, lambda: number, dt: number): number {
  const delta = wrapAngle(target - current);
  return current + delta * (1 - Math.exp(-lambda * dt));
}

// ── Vec2 damp ─────────────────────────────────────────────────────────────────

/**
 * Exponentially decay a 2-D vector towards `target`.
 * Returns a new object — does not mutate inputs.
 */
export function dampVec2(current: Vec2, target: Vec2, lambda: number, dt: number): Vec2 {
  const f = 1 - Math.exp(-lambda * dt);
  return {
    x: current.x + (target.x - current.x) * f,
    y: current.y + (target.y - current.y) * f,
  };
}

/**
 * Exponentially decay a 2-D vector in-place.
 * Mutates and returns `current` for chaining.
 */
export function dampVec2Mut(current: Vec2, target: Vec2, lambda: number, dt: number): Vec2 {
  const f = 1 - Math.exp(-lambda * dt);
  current.x += (target.x - current.x) * f;
  current.y += (target.y - current.y) * f;
  return current;
}

// ── Vec3 damp ─────────────────────────────────────────────────────────────────

/**
 * Exponentially decay a 3-D vector towards `target`.
 * Returns a new object — does not mutate inputs.
 */
export function dampVec3(current: Vec3, target: Vec3, lambda: number, dt: number): Vec3 {
  const f = 1 - Math.exp(-lambda * dt);
  return {
    x: current.x + (target.x - current.x) * f,
    y: current.y + (target.y - current.y) * f,
    z: current.z + (target.z - current.z) * f,
  };
}

/**
 * Exponentially decay a 3-D vector in-place.
 * Mutates and returns `current` for chaining.
 */
export function dampVec3Mut(current: Vec3, target: Vec3, lambda: number, dt: number): Vec3 {
  const f = 1 - Math.exp(-lambda * dt);
  current.x += (target.x - current.x) * f;
  current.y += (target.y - current.y) * f;
  current.z += (target.z - current.z) * f;
  return current;
}
