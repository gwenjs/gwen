import { describe, it, expect } from 'vitest';
import {
  quatIdentity,
  quatFromAxisAngle,
  quatFromEuler,
  quatFromTo,
  quatMultiply,
  quatConjugate,
  quatInverse,
  quatNormalize,
  quatRotateVec3,
  quatNlerp,
  quatSlerp,
  quatToEuler,
  quatEquals,
} from '../src/quat.js';
import { vec3Length } from '../src/vec3.js';

const _approx = (a: number, b: number, eps = 1e-4) => Math.abs(a - b) < eps;

describe('quatIdentity', () => {
  it('returns (0,0,0,1)', () => expect(quatIdentity()).toEqual({ x: 0, y: 0, z: 0, w: 1 }));
});

describe('quatFromAxisAngle', () => {
  it('90° around Z axis', () => {
    const q = quatFromAxisAngle({ x: 0, y: 0, z: 1 }, Math.PI / 2);
    const v = quatRotateVec3(q, { x: 1, y: 0, z: 0 });
    expect(v.x).toBeCloseTo(0, 4);
    expect(v.y).toBeCloseTo(1, 4);
    expect(v.z).toBeCloseTo(0, 4);
  });
  it('0° returns identity', () => {
    const q = quatFromAxisAngle({ x: 0, y: 1, z: 0 }, 0);
    expect(quatEquals(q, quatIdentity())).toBe(true);
  });
});

describe('quatFromEuler', () => {
  it('zero Euler = identity', () => {
    expect(quatEquals(quatFromEuler(0, 0, 0), quatIdentity())).toBe(true);
  });
  it('round-trip through quatToEuler', () => {
    const euler = { x: 0.3, y: 0.5, z: 0.1 };
    const q = quatFromEuler(euler.x, euler.y, euler.z);
    const back = quatToEuler(q);
    expect(back.x).toBeCloseTo(euler.x, 4);
    expect(back.y).toBeCloseTo(euler.y, 4);
    expect(back.z).toBeCloseTo(euler.z, 4);
  });
});

describe('quatFromTo', () => {
  it('rotates X to Y', () => {
    const q = quatFromTo({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
    const v = quatRotateVec3(q, { x: 1, y: 0, z: 0 });
    expect(v.x).toBeCloseTo(0, 4);
    expect(v.y).toBeCloseTo(1, 4);
    expect(v.z).toBeCloseTo(0, 4);
  });
  it('same direction = identity', () => {
    const q = quatFromTo({ x: 1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
    expect(quatEquals(q, quatIdentity())).toBe(true);
  });
});

describe('quatMultiply', () => {
  it('identity * identity = identity', () => {
    const q = quatMultiply(quatIdentity(), quatIdentity());
    expect(quatEquals(q, quatIdentity())).toBe(true);
  });
  it('q * q_inverse = identity', () => {
    const q = quatFromAxisAngle({ x: 0, y: 1, z: 0 }, 1.2);
    const result = quatMultiply(q, quatInverse(q));
    expect(quatEquals(result, quatIdentity())).toBe(true);
  });
});

describe('quatNormalize', () => {
  it('normalises a non-unit quaternion', () => {
    const q = { x: 1, y: 1, z: 1, w: 1 };
    const n = quatNormalize(q);
    const len = Math.sqrt(n.x * n.x + n.y * n.y + n.z * n.z + n.w * n.w);
    expect(len).toBeCloseTo(1);
  });
});

describe('quatConjugate', () => {
  it('negates xyz, keeps w', () => {
    const q = { x: 1, y: 2, z: 3, w: 4 };
    expect(quatConjugate(q)).toEqual({ x: -1, y: -2, z: -3, w: 4 });
  });
  it('conjugate === inverse for unit quaternion', () => {
    const q = quatNormalize({ x: 1, y: 2, z: 3, w: 4 });
    const conj = quatConjugate(q);
    const inv = quatInverse(q);
    expect(conj.x).toBeCloseTo(inv.x, 5);
    expect(conj.w).toBeCloseTo(inv.w, 5);
  });
});

describe('quatRotateVec3', () => {
  it('identity leaves vector unchanged', () => {
    const v = { x: 1, y: 2, z: 3 };
    const r = quatRotateVec3(quatIdentity(), v);
    expect(r.x).toBeCloseTo(v.x);
    expect(r.y).toBeCloseTo(v.y);
    expect(r.z).toBeCloseTo(v.z);
  });
  it('preserves vector length', () => {
    const q = quatFromAxisAngle({ x: 0, y: 1, z: 0 }, 1.23);
    const v = { x: 3, y: 4, z: 5 };
    const r = quatRotateVec3(q, v);
    expect(vec3Length(r)).toBeCloseTo(vec3Length(v), 4);
  });
});

describe('quatSlerp', () => {
  it('at t=0 returns a', () => {
    const a = quatIdentity();
    const b = quatFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 2);
    const r = quatSlerp(a, b, 0);
    expect(quatEquals(r, a)).toBe(true);
  });
  it('at t=1 returns b', () => {
    const a = quatIdentity();
    const b = quatFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 2);
    const r = quatSlerp(a, b, 1);
    expect(quatEquals(r, b)).toBe(true);
  });
  it('at t=0.5 is halfway rotation', () => {
    const a = quatIdentity();
    const b = quatFromAxisAngle({ x: 0, y: 0, z: 1 }, Math.PI);
    const mid = quatSlerp(a, b, 0.5);
    // halfway = 90° around Z
    const v = quatRotateVec3(mid, { x: 1, y: 0, z: 0 });
    expect(v.x).toBeCloseTo(0, 3);
    expect(v.y).toBeCloseTo(1, 3);
  });
  it('result is always unit length', () => {
    const a = quatFromAxisAngle({ x: 1, y: 0, z: 0 }, 0.5);
    const b = quatFromAxisAngle({ x: 0, y: 1, z: 0 }, 1.2);
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const r = quatSlerp(a, b, t);
      const len = Math.sqrt(r.x * r.x + r.y * r.y + r.z * r.z + r.w * r.w);
      expect(len).toBeCloseTo(1, 5);
    }
  });
});

describe('quatNlerp', () => {
  it('result is unit length', () => {
    const a = quatIdentity();
    const b = quatFromAxisAngle({ x: 0, y: 1, z: 0 }, 1);
    const r = quatNlerp(a, b, 0.5);
    const len = Math.sqrt(r.x * r.x + r.y * r.y + r.z * r.z + r.w * r.w);
    expect(len).toBeCloseTo(1, 5);
  });
});

describe('quatEquals', () => {
  it('identity equals itself', () => expect(quatEquals(quatIdentity(), quatIdentity())).toBe(true));
  it('q and -q represent the same rotation', () => {
    const q = quatNormalize({ x: 0.5, y: 0.5, z: 0.5, w: 0.5 });
    const neg = { x: -q.x, y: -q.y, z: -q.z, w: -q.w };
    expect(quatEquals(q, neg)).toBe(true);
  });
  it('different rotations are not equal', () => {
    const a = quatFromAxisAngle({ x: 0, y: 1, z: 0 }, 0.5);
    const b = quatFromAxisAngle({ x: 0, y: 1, z: 0 }, 1.5);
    expect(quatEquals(a, b)).toBe(false);
  });
});
