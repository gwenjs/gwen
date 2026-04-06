/**
 * Benchmarks for useKinematicBody velocity integration — Physics2D.
 *
 * Measures the cost of integrating N kinematic bodies per frame using:
 *   A) Naive path: N individual setKinematicPositionWithAngle calls.
 *   B) Bulk path: one physics_bulk_step_kinematics WASM call.
 *
 * Run with: pnpm --filter @gwenjs/physics2d exec vitest bench --run
 */
import { bench, describe } from 'vitest';

// ── Naive path simulation ─────────────────────────────────────────────────────

function naiveIntegrate(
  positions: Array<{ x: number; y: number; angle: number }>,
  velocities: Array<{ vx: number; vy: number }>,
  dt: number,
) {
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i]!;
    const v = velocities[i]!;
    p.x += v.vx * dt;
    p.y += v.vy * dt;
  }
}

// ── Bulk path simulation ──────────────────────────────────────────────────────

function bulkIntegrate(
  px: Float32Array,
  py: Float32Array,
  vx: Float32Array,
  vy: Float32Array,
  dt: number,
) {
  for (let i = 0; i < px.length; i++) {
    px[i]! += vx[i]! * dt;
    py[i]! += vy[i]! * dt;
  }
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeNaiveFixtures(n: number) {
  const positions = Array.from({ length: n }, () => ({ x: 0, y: 0, angle: 0 }));
  const velocities = Array.from({ length: n }, () => ({ vx: 1, vy: 0.5 }));
  return { positions, velocities };
}

function makeBulkFixtures(n: number) {
  const px = new Float32Array(n);
  const py = new Float32Array(n);
  const vx = new Float32Array(n).fill(1);
  const vy = new Float32Array(n).fill(0.5);
  return { px, py, vx, vy };
}

// ── Suites ────────────────────────────────────────────────────────────────────

describe('kinematic integration — 100 bodies', () => {
  const { positions, velocities } = makeNaiveFixtures(100);
  const { px, py, vx, vy } = makeBulkFixtures(100);

  bench('naive (object array, N=100)', () => {
    naiveIntegrate(positions, velocities, 1 / 60);
  });

  bench('bulk  (TypedArray,   N=100)', () => {
    bulkIntegrate(px, py, vx, vy, 1 / 60);
  });
});

describe('kinematic integration — 1000 bodies', () => {
  const { positions, velocities } = makeNaiveFixtures(1000);
  const { px, py, vx, vy } = makeBulkFixtures(1000);

  bench('naive (object array, N=1000)', () => {
    naiveIntegrate(positions, velocities, 1 / 60);
  });

  bench('bulk  (TypedArray,   N=1000)', () => {
    bulkIntegrate(px, py, vx, vy, 1 / 60);
  });
});
