/**
 * GWEN Math — damped harmonic spring simulation.
 *
 * Simulates a mass-spring-damper system using a semi-implicit Euler integrator.
 * This produces physically plausible, framerate-independent animations that
 * can overshoot (unlike `damp`) when `damping < 2 * sqrt(stiffness)`.
 *
 * ## Quick-start
 *
 * ```ts
 * import { makeSpring1D, stepSpring1D } from '@gwenjs/math';
 *
 * const opts  = { stiffness: 200, damping: 20 };
 * const state = makeSpring1D(0); // start at 0
 *
 * // In your game loop:
 * stepSpring1D(state, 100, opts, dt); // animate towards 100
 * entity.x = state.value;
 * ```
 *
 * ## Tuning tips
 *
 * | Feel     | stiffness | damping                       |
 * |----------|-----------|-------------------------------|
 * | Snappy   | 400–800   | `2 * sqrt(stiffness) * 0.8`   |
 * | Bouncy   | 150–300   | `2 * sqrt(stiffness) * 0.3`   |
 * | Critical | any       | `2 * sqrt(stiffness)` exactly  |
 * | Slow     | 20–80     | `2 * sqrt(stiffness) * 1.2`   |
 */

import type {
  Vec2,
  Vec3,
  SpringState1D,
  SpringState2D,
  SpringState3D,
  SpringOptions,
} from './types.js';

// ── Factory helpers ───────────────────────────────────────────────────────────

/** Create a 1-D spring state starting at `initialValue`. */
export function makeSpring1D(initialValue: number, initialVelocity = 0): SpringState1D {
  return { value: initialValue, velocity: initialVelocity };
}

/** Create a 2-D spring state starting at `(x, y)`. */
export function makeSpring2D(x = 0, y = 0, vx = 0, vy = 0): SpringState2D {
  return { x, y, vx, vy };
}

/** Create a 3-D spring state starting at `(x, y, z)`. */
export function makeSpring3D(x = 0, y = 0, z = 0, vx = 0, vy = 0, vz = 0): SpringState3D {
  return { x, y, z, vx, vy, vz };
}

// ── Internal step kernel ──────────────────────────────────────────────────────

/**
 * Advance one scalar spring step.
 * @internal
 */
function _step1D(
  value: number,
  velocity: number,
  target: number,
  stiffness: number,
  damping: number,
  dt: number,
): [value: number, velocity: number] {
  const force = -stiffness * (value - target) - damping * velocity;
  const newVelocity = velocity + force * dt;
  const newValue = value + newVelocity * dt;
  return [newValue, newVelocity];
}

// ── 1-D spring ────────────────────────────────────────────────────────────────

/**
 * Advance a 1-D spring simulation by `dt` seconds.
 *
 * **Mutates** `state` in-place and returns it for chaining.
 */
export function stepSpring1D(
  state: SpringState1D,
  target: number,
  opts: SpringOptions,
  dt: number,
): SpringState1D {
  const [v, vel] = _step1D(state.value, state.velocity, target, opts.stiffness, opts.damping, dt);
  state.value = v;
  state.velocity = vel;
  return state;
}

/**
 * Functional variant — returns a new {@link SpringState1D} without mutating inputs.
 */
export function spring1D(
  state: Readonly<SpringState1D>,
  target: number,
  opts: SpringOptions,
  dt: number,
): SpringState1D {
  const [v, vel] = _step1D(state.value, state.velocity, target, opts.stiffness, opts.damping, dt);
  return { value: v, velocity: vel };
}

// ── 2-D spring ────────────────────────────────────────────────────────────────

/**
 * Advance a 2-D spring simulation by `dt` seconds.
 *
 * **Mutates** `state` in-place and returns it for chaining.
 */
export function stepSpring2D(
  state: SpringState2D,
  target: Vec2,
  opts: SpringOptions,
  dt: number,
): SpringState2D {
  const [x, vx] = _step1D(state.x, state.vx, target.x, opts.stiffness, opts.damping, dt);
  const [y, vy] = _step1D(state.y, state.vy, target.y, opts.stiffness, opts.damping, dt);
  state.x = x;
  state.vx = vx;
  state.y = y;
  state.vy = vy;
  return state;
}

/**
 * Functional variant — returns a new {@link SpringState2D} without mutating inputs.
 */
export function spring2D(
  state: Readonly<SpringState2D>,
  target: Vec2,
  opts: SpringOptions,
  dt: number,
): SpringState2D {
  const [x, vx] = _step1D(state.x, state.vx, target.x, opts.stiffness, opts.damping, dt);
  const [y, vy] = _step1D(state.y, state.vy, target.y, opts.stiffness, opts.damping, dt);
  return { x, y, vx, vy };
}

// ── 3-D spring ────────────────────────────────────────────────────────────────

/**
 * Advance a 3-D spring simulation by `dt` seconds.
 *
 * **Mutates** `state` in-place and returns it for chaining.
 */
export function stepSpring3D(
  state: SpringState3D,
  target: Vec3,
  opts: SpringOptions,
  dt: number,
): SpringState3D {
  const [x, vx] = _step1D(state.x, state.vx, target.x, opts.stiffness, opts.damping, dt);
  const [y, vy] = _step1D(state.y, state.vy, target.y, opts.stiffness, opts.damping, dt);
  const [z, vz] = _step1D(state.z, state.vz, target.z, opts.stiffness, opts.damping, dt);
  state.x = x;
  state.vx = vx;
  state.y = y;
  state.vy = vy;
  state.z = z;
  state.vz = vz;
  return state;
}

/**
 * Functional variant — returns a new {@link SpringState3D} without mutating inputs.
 */
export function spring3D(
  state: Readonly<SpringState3D>,
  target: Vec3,
  opts: SpringOptions,
  dt: number,
): SpringState3D {
  const [x, vx] = _step1D(state.x, state.vx, target.x, opts.stiffness, opts.damping, dt);
  const [y, vy] = _step1D(state.y, state.vy, target.y, opts.stiffness, opts.damping, dt);
  const [z, vz] = _step1D(state.z, state.vz, target.z, opts.stiffness, opts.damping, dt);
  return { x, y, z, vx, vy, vz };
}

// ── Convenience presets ───────────────────────────────────────────────────────

/** Critically damped spring preset — no overshoot, fast settling. */
export function criticalOpts(stiffness: number): SpringOptions {
  return { stiffness, damping: 2 * Math.sqrt(stiffness) };
}

/** Under-damped (bouncy) spring preset. `ratio` < 1 for oscillation (default 0.4). */
export function bouncyOpts(stiffness: number, ratio = 0.4): SpringOptions {
  return { stiffness, damping: 2 * Math.sqrt(stiffness) * ratio };
}

/** Over-damped (sluggish) spring preset. `ratio` > 1 (default 1.5). */
export function sluggishOpts(stiffness: number, ratio = 1.5): SpringOptions {
  return { stiffness, damping: 2 * Math.sqrt(stiffness) * ratio };
}
