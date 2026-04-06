/**
 * @module math.bench
 *
 * Math utility benchmarks for @gwenjs/math.
 *
 * Math operations are called millions of times per frame in real games.
 * These benchmarks verify that utility functions have minimal overhead and
 * guard against accidental regressions introduced by refactoring.
 *
 * All pre-computed fixtures are created OUTSIDE `bench()` calls to measure
 * only the function under test — not the setup cost.
 *
 * Baseline machine: M-series Mac, single-threaded Node 20.
 *
 * Run:
 *   pnpm --filter @gwenjs/math bench
 */

import { bench, describe } from 'vitest';
import {
  vec2,
  vec2Add,
  vec2Dot,
  vec2Normalize,
  vec2Lerp,
  vec3,
  vec3Cross,
  vec3Normalize,
  vec3Dot,
  mat4Identity,
  mat4Mul,
  mat4TRS,
  mat4Perspective,
  quatFromEuler,
  lerp,
  clamp,
} from '../src/index.js';
import type { Vec2, Vec3, Quat } from '../src/index.js';

// ── Pre-computed fixtures ─────────────────────────────────────────────────────

const A2: Vec2 = vec2(1.5, 2.3);
const B2: Vec2 = vec2(3.7, -1.1);
const LERP_T = 0.35;

const A3: Vec3 = vec3(1, 2, 3);
const B3: Vec3 = vec3(4, 5, 6);
const LONG3: Vec3 = vec3(12.5, -7.3, 0.8);

// Identity matrices used as operands.
const M1 = mat4Identity();
const M2 = mat4TRS(vec3(1, 2, 3), quatFromEuler(0.1, 0.2, 0.3), vec3(1, 1, 1));

// Translation / rotation / scale operands for TRS construction.
const TRS_T: Vec3 = vec3(5, -3, 1.5);
const TRS_R: Quat = quatFromEuler(0.5, -0.25, 0.75);
const TRS_S: Vec3 = vec3(2, 2, 2);

// ── Vec2 operations ───────────────────────────────────────────────────────────

describe('Vec2 operations', () => {
  bench('vec2Add() × 100 000', () => {
    let acc: Vec2 = A2;
    for (let i = 0; i < 100_000; i++) {
      acc = vec2Add(acc, B2);
    }
    return acc;
  });

  bench('vec2Dot() × 100 000', () => {
    let sum = 0;
    for (let i = 0; i < 100_000; i++) {
      sum += vec2Dot(A2, B2);
    }
    return sum;
  });

  bench('vec2Normalize() × 100 000', () => {
    let v: Vec2 = A2;
    for (let i = 0; i < 100_000; i++) {
      v = vec2Normalize(v);
    }
    return v;
  });

  bench('vec2Lerp() × 100 000', () => {
    let v: Vec2 = A2;
    for (let i = 0; i < 100_000; i++) {
      v = vec2Lerp(A2, B2, LERP_T);
    }
    return v;
  });
});

// ── Vec3 operations ───────────────────────────────────────────────────────────

describe('Vec3 operations', () => {
  bench('vec3Cross() × 100 000', () => {
    let v: Vec3 = A3;
    for (let i = 0; i < 100_000; i++) {
      v = vec3Cross(A3, B3);
    }
    return v;
  });

  bench('vec3Normalize() × 100 000', () => {
    let v: Vec3 = LONG3;
    for (let i = 0; i < 100_000; i++) {
      v = vec3Normalize(v);
    }
    return v;
  });

  bench('vec3Dot() × 100 000', () => {
    let sum = 0;
    for (let i = 0; i < 100_000; i++) {
      sum += vec3Dot(A3, B3);
    }
    return sum;
  });
});

// ── Mat4 operations ───────────────────────────────────────────────────────────

describe('Mat4 operations', () => {
  bench('mat4Mul() × 10 000', () => {
    let m = M1;
    for (let i = 0; i < 10_000; i++) {
      m = mat4Mul(m, M2);
    }
    return m;
  });

  bench('mat4TRS() × 10 000', () => {
    let m = M1;
    for (let i = 0; i < 10_000; i++) {
      m = mat4TRS(TRS_T, TRS_R, TRS_S);
    }
    return m;
  });

  bench('mat4Perspective() × 10 000', () => {
    let m = M1;
    for (let i = 0; i < 10_000; i++) {
      m = mat4Perspective(Math.PI / 3, 16 / 9, 0.1, 1000);
    }
    return m;
  });
});

// ── Scalar operations (baseline) ──────────────────────────────────────────────

describe('Scalar operations', () => {
  bench('lerp() × 1 000 000', () => {
    let v = 0;
    for (let i = 0; i < 1_000_000; i++) {
      v = lerp(v, 1, 0.001);
    }
    return v;
  });

  bench('clamp() × 1 000 000', () => {
    let v = 0;
    for (let i = 0; i < 1_000_000; i++) {
      v = clamp(i * 0.0001 - 50, 0, 1);
    }
    return v;
  });
});
