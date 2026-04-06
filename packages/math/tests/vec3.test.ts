import { describe, it, expect } from 'vitest';
import {
  vec3,
  vec3Zero,
  vec3One,
  vec3Right,
  vec3Up,
  vec3Forward,
  vec3Clone,
  vec3Add,
  vec3AddMut,
  vec3Sub,
  vec3SubMut,
  vec3Scale,
  vec3ScaleMut,
  vec3Mul,
  vec3Negate,
  vec3Dot,
  vec3Cross,
  vec3LengthSq,
  vec3Length,
  vec3DistanceSq,
  vec3Distance,
  vec3Normalize,
  vec3AngleBetween,
  vec3Reflect,
  vec3Project,
  vec3Reject,
  vec3Lerp,
  vec3ClampLength,
  vec3Equals,
  vec3IsZero,
} from '../src/vec3.js';

describe('constructors', () => {
  it('vec3', () => expect(vec3(1, 2, 3)).toEqual({ x: 1, y: 2, z: 3 }));
  it('vec3Zero', () => expect(vec3Zero()).toEqual({ x: 0, y: 0, z: 0 }));
  it('vec3One', () => expect(vec3One()).toEqual({ x: 1, y: 1, z: 1 }));
  it('vec3Right', () => expect(vec3Right()).toEqual({ x: 1, y: 0, z: 0 }));
  it('vec3Up', () => expect(vec3Up()).toEqual({ x: 0, y: 1, z: 0 }));
  it('vec3Forward', () => expect(vec3Forward()).toEqual({ x: 0, y: 0, z: -1 }));
  it('clone returns new object', () => {
    const v = { x: 1, y: 2, z: 3 };
    const c = vec3Clone(v);
    expect(c).toEqual(v);
    expect(c).not.toBe(v);
  });
});

describe('arithmetic', () => {
  it('add', () =>
    expect(vec3Add({ x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 6 })).toEqual({ x: 5, y: 7, z: 9 }));
  it('addMut', () => {
    const a = { x: 1, y: 2, z: 3 };
    vec3AddMut(a, { x: 4, y: 5, z: 6 });
    expect(a).toEqual({ x: 5, y: 7, z: 9 });
  });
  it('sub', () =>
    expect(vec3Sub({ x: 5, y: 7, z: 9 }, { x: 1, y: 2, z: 3 })).toEqual({ x: 4, y: 5, z: 6 }));
  it('subMut', () => {
    const a = { x: 5, y: 7, z: 9 };
    vec3SubMut(a, { x: 1, y: 2, z: 3 });
    expect(a).toEqual({ x: 4, y: 5, z: 6 });
  });
  it('scale', () => expect(vec3Scale({ x: 1, y: 2, z: 3 }, 3)).toEqual({ x: 3, y: 6, z: 9 }));
  it('scaleMut', () => {
    const v = { x: 1, y: 2, z: 3 };
    vec3ScaleMut(v, 3);
    expect(v).toEqual({ x: 3, y: 6, z: 9 });
  });
  it('mul', () =>
    expect(vec3Mul({ x: 2, y: 3, z: 4 }, { x: 1, y: 2, z: 3 })).toEqual({ x: 2, y: 6, z: 12 }));
  it('negate', () => expect(vec3Negate({ x: 1, y: -2, z: 3 })).toEqual({ x: -1, y: 2, z: -3 }));
});

describe('geometry', () => {
  it('dot product', () => expect(vec3Dot({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 })).toBe(0));
  it('dot parallel', () => expect(vec3Dot({ x: 1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })).toBe(1));

  it('cross product of X × Y = Z', () => {
    const c = vec3Cross({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
    expect(c.x).toBeCloseTo(0);
    expect(c.y).toBeCloseTo(0);
    expect(c.z).toBeCloseTo(1);
  });
  it('cross is anti-commutative', () => {
    const a = { x: 1, y: 2, z: 3 },
      b = { x: 4, y: 5, z: 6 };
    const ab = vec3Cross(a, b);
    const ba = vec3Cross(b, a);
    expect(ab.x).toBeCloseTo(-ba.x);
    expect(ab.y).toBeCloseTo(-ba.y);
    expect(ab.z).toBeCloseTo(-ba.z);
  });

  it('lengthSq', () => expect(vec3LengthSq({ x: 1, y: 2, z: 2 })).toBe(9));
  it('length', () => expect(vec3Length({ x: 1, y: 2, z: 2 })).toBeCloseTo(3));
  it('distanceSq', () =>
    expect(vec3DistanceSq({ x: 0, y: 0, z: 0 }, { x: 1, y: 2, z: 2 })).toBe(9));
  it('distance', () =>
    expect(vec3Distance({ x: 0, y: 0, z: 0 }, { x: 1, y: 2, z: 2 })).toBeCloseTo(3));

  it('normalize produces unit vector', () => {
    const n = vec3Normalize({ x: 1, y: 2, z: 2 });
    expect(vec3Length(n)).toBeCloseTo(1);
  });
  it('normalize zero returns zero', () => {
    expect(vec3Normalize({ x: 0, y: 0, z: 0 })).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('angleBetween orthogonal is π/2', () => {
    expect(vec3AngleBetween({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 })).toBeCloseTo(Math.PI / 2);
  });

  it('reflect off XY plane (normal = Z)', () => {
    const r = vec3Reflect({ x: 1, y: 1, z: -1 }, { x: 0, y: 0, z: 1 });
    expect(r.x).toBeCloseTo(1);
    expect(r.y).toBeCloseTo(1);
    expect(r.z).toBeCloseTo(1);
  });

  it('project onto X axis', () => {
    const p = vec3Project({ x: 3, y: 4, z: 0 }, { x: 1, y: 0, z: 0 });
    expect(p).toEqual({ x: 3, y: 0, z: 0 });
  });

  it('reject from X axis is the remainder', () => {
    const r = vec3Reject({ x: 3, y: 4, z: 0 }, { x: 1, y: 0, z: 0 });
    expect(r.x).toBeCloseTo(0);
    expect(r.y).toBeCloseTo(4);
    expect(r.z).toBeCloseTo(0);
  });

  it('lerp midpoint', () => {
    const m = vec3Lerp({ x: 0, y: 0, z: 0 }, { x: 10, y: 20, z: 30 }, 0.5);
    expect(m).toEqual({ x: 5, y: 10, z: 15 });
  });

  it('clampLength — clamps when over max', () => {
    const v = { x: 1, y: 2, z: 2 }; // length = 3
    const c = vec3ClampLength(v, 1);
    expect(vec3Length(c)).toBeCloseTo(1);
  });
});

describe('comparison', () => {
  it('equals', () => {
    expect(vec3Equals({ x: 1, y: 2, z: 3 }, { x: 1, y: 2, z: 3 })).toBe(true);
    expect(vec3Equals({ x: 1, y: 2, z: 3 }, { x: 1, y: 2, z: 4 })).toBe(false);
  });
  it('isZero', () => {
    expect(vec3IsZero({ x: 0, y: 0, z: 0 })).toBe(true);
    expect(vec3IsZero({ x: 0, y: 0, z: 0.001 })).toBe(false);
  });
});
