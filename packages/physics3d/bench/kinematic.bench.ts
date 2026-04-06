/**
 * Benchmarks for useKinematicBody velocity integration — Physics3D.
 *
 * Measures the cost of integrating N kinematic bodies per frame using:
 *   A) Naive path: N individual setKinematicPosition calls.
 *   B) Bulk path: one physics3d_bulk_step_kinematics WASM call.
 *
 * Also benchmarks quaternion integration for setAngularVelocity.
 *
 * Run with: pnpm --filter @gwenjs/physics3d exec vitest bench --run
 */
import { bench, describe } from 'vitest';

// ── Naive path simulation ─────────────────────────────────────────────────────

function naiveIntegrate3D(
  positions: Array<{ x: number; y: number; z: number }>,
  velocities: Array<{ vx: number; vy: number; vz: number }>,
  dt: number,
) {
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i]!;
    const v = velocities[i]!;
    p.x += v.vx * dt;
    p.y += v.vy * dt;
    p.z += v.vz * dt;
  }
}

// ── Bulk path simulation ──────────────────────────────────────────────────────

function bulkIntegrate3D(
  px: Float32Array,
  py: Float32Array,
  pz: Float32Array,
  vx: Float32Array,
  vy: Float32Array,
  vz: Float32Array,
  dt: number,
) {
  for (let i = 0; i < px.length; i++) {
    px[i]! += vx[i]! * dt;
    py[i]! += vy[i]! * dt;
    pz[i]! += vz[i]! * dt;
  }
}

// ── Quaternion integration ────────────────────────────────────────────────────

interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

function integrateQuat(q: Quat, wx: number, wy: number, wz: number, dt: number): Quat {
  const hdt = 0.5 * dt;
  const nqx = q.x + hdt * (wx * q.w + wy * q.z - wz * q.y);
  const nqy = q.y + hdt * (-wx * q.z + wy * q.w + wz * q.x);
  const nqz = q.z + hdt * (wx * q.y - wy * q.x + wz * q.w);
  const nqw = q.w + hdt * (-wx * q.x - wy * q.y - wz * q.z);
  const len = Math.sqrt(nqx * nqx + nqy * nqy + nqz * nqz + nqw * nqw);
  return len > 0 ? { x: nqx / len, y: nqy / len, z: nqz / len, w: nqw / len } : q;
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeNaive3D(n: number) {
  const positions = Array.from({ length: n }, () => ({ x: 0, y: 0, z: 0 }));
  const velocities = Array.from({ length: n }, () => ({ vx: 1, vy: 0, vz: 0 }));
  return { positions, velocities };
}

function makeBulk3D(n: number) {
  const px = new Float32Array(n);
  const py = new Float32Array(n);
  const pz = new Float32Array(n);
  const vx = new Float32Array(n).fill(1);
  const vy = new Float32Array(n).fill(0);
  const vz = new Float32Array(n).fill(0);
  return { px, py, pz, vx, vy, vz };
}

// ── Suites ────────────────────────────────────────────────────────────────────

describe('kinematic position integration — 100 bodies', () => {
  const { positions, velocities } = makeNaive3D(100);
  const { px, py, pz, vx, vy, vz } = makeBulk3D(100);

  bench('naive (object array, N=100)', () => {
    naiveIntegrate3D(positions, velocities, 1 / 60);
  });

  bench('bulk  (TypedArray,   N=100)', () => {
    bulkIntegrate3D(px, py, pz, vx, vy, vz, 1 / 60);
  });
});

describe('kinematic position integration — 1000 bodies', () => {
  const { positions, velocities } = makeNaive3D(1000);
  const { px, py, pz, vx, vy, vz } = makeBulk3D(1000);

  bench('naive (object array, N=1000)', () => {
    naiveIntegrate3D(positions, velocities, 1 / 60);
  });

  bench('bulk  (TypedArray,   N=1000)', () => {
    bulkIntegrate3D(px, py, pz, vx, vy, vz, 1 / 60);
  });
});

describe('quaternion integration — 100 bodies', () => {
  const quats: Quat[] = Array.from({ length: 100 }, () => ({ x: 0, y: 0, z: 0, w: 1 }));

  bench('integrateQuat N=100', () => {
    for (const q of quats) {
      Object.assign(q, integrateQuat(q, 0, 1, 0, 1 / 60));
    }
  });
});
