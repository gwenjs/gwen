import { describe, it, expect } from 'vitest';
import {
  vec2,
  vec2Zero,
  vec2One,
  vec2Right,
  vec2Up,
  vec2FromAngle,
  vec2Add,
  vec2AddMut,
  vec2Sub,
  vec2SubMut,
  vec2Scale,
  vec2ScaleMut,
  vec2Mul,
  vec2Negate,
  vec2Clone,
  vec2Dot,
  vec2Cross,
  vec2LengthSq,
  vec2Length,
  vec2DistanceSq,
  vec2Distance,
  vec2Normalize,
  vec2Perp,
  vec2Angle,
  vec2AngleBetween,
  vec2Rotate,
  vec2Reflect,
  vec2Lerp,
  vec2ClampLength,
  vec2Equals,
  vec2IsZero,
} from '../src/vec2.js';

describe('constructors', () => {
  it('vec2', () => expect(vec2(3, 4)).toEqual({ x: 3, y: 4 }));
  it('vec2Zero', () => expect(vec2Zero()).toEqual({ x: 0, y: 0 }));
  it('vec2One', () => expect(vec2One()).toEqual({ x: 1, y: 1 }));
  it('vec2Right', () => expect(vec2Right()).toEqual({ x: 1, y: 0 }));
  it('vec2Up', () => expect(vec2Up()).toEqual({ x: 0, y: 1 }));
  it('vec2FromAngle — right axis at 0', () => {
    const v = vec2FromAngle(0);
    expect(v.x).toBeCloseTo(1);
    expect(v.y).toBeCloseTo(0);
  });
  it('vec2FromAngle — up axis at π/2', () => {
    const v = vec2FromAngle(Math.PI / 2);
    expect(v.x).toBeCloseTo(0);
    expect(v.y).toBeCloseTo(1);
  });
});

describe('arithmetic', () => {
  it('add', () => expect(vec2Add({ x: 1, y: 2 }, { x: 3, y: 4 })).toEqual({ x: 4, y: 6 }));
  it('addMut mutates a', () => {
    const a = { x: 1, y: 2 };
    vec2AddMut(a, { x: 3, y: 4 });
    expect(a).toEqual({ x: 4, y: 6 });
  });
  it('sub', () => expect(vec2Sub({ x: 5, y: 3 }, { x: 2, y: 1 })).toEqual({ x: 3, y: 2 }));
  it('subMut mutates a', () => {
    const a = { x: 5, y: 3 };
    vec2SubMut(a, { x: 2, y: 1 });
    expect(a).toEqual({ x: 3, y: 2 });
  });
  it('scale', () => expect(vec2Scale({ x: 2, y: 3 }, 4)).toEqual({ x: 8, y: 12 }));
  it('scaleMut', () => {
    const v = { x: 2, y: 3 };
    vec2ScaleMut(v, 4);
    expect(v).toEqual({ x: 8, y: 12 });
  });
  it('mul component-wise', () =>
    expect(vec2Mul({ x: 2, y: 3 }, { x: 4, y: 5 })).toEqual({ x: 8, y: 15 }));
  it('negate', () => expect(vec2Negate({ x: 1, y: -2 })).toEqual({ x: -1, y: 2 }));
  it('clone returns new object', () => {
    const v = { x: 1, y: 2 };
    const c = vec2Clone(v);
    expect(c).toEqual(v);
    expect(c).not.toBe(v);
  });
});

describe('geometry', () => {
  it('dot product', () => expect(vec2Dot({ x: 1, y: 0 }, { x: 0, y: 1 })).toBe(0));
  it('dot parallel', () => expect(vec2Dot({ x: 1, y: 0 }, { x: 1, y: 0 })).toBe(1));
  it('cross product scalar', () => {
    expect(vec2Cross({ x: 1, y: 0 }, { x: 0, y: 1 })).toBeCloseTo(1);
    expect(vec2Cross({ x: 0, y: 1 }, { x: 1, y: 0 })).toBeCloseTo(-1);
  });
  it('lengthSq', () => expect(vec2LengthSq({ x: 3, y: 4 })).toBe(25));
  it('length', () => expect(vec2Length({ x: 3, y: 4 })).toBeCloseTo(5));
  it('distanceSq', () => expect(vec2DistanceSq({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(25));
  it('distance', () => expect(vec2Distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBeCloseTo(5));

  it('normalize', () => {
    const n = vec2Normalize({ x: 3, y: 4 });
    expect(vec2Length(n)).toBeCloseTo(1);
  });
  it('normalize zero returns zero', () => {
    expect(vec2Normalize({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
  });

  it('perp is perpendicular', () => {
    const v = { x: 3, y: 4 };
    const p = vec2Perp(v);
    expect(vec2Dot(v, p)).toBeCloseTo(0);
  });

  it('angle of right vector is 0', () => expect(vec2Angle({ x: 1, y: 0 })).toBeCloseTo(0));
  it('angle of up vector is π/2', () => expect(vec2Angle({ x: 0, y: 1 })).toBeCloseTo(Math.PI / 2));

  it('angleBetween orthogonal is π/2', () => {
    expect(vec2AngleBetween({ x: 1, y: 0 }, { x: 0, y: 1 })).toBeCloseTo(Math.PI / 2);
  });

  it('rotate 90°', () => {
    const r = vec2Rotate({ x: 1, y: 0 }, Math.PI / 2);
    expect(r.x).toBeCloseTo(0);
    expect(r.y).toBeCloseTo(1);
  });

  it('reflect off Y-axis (normal = right)', () => {
    const reflected = vec2Reflect({ x: 1, y: 1 }, { x: 1, y: 0 });
    expect(reflected.x).toBeCloseTo(-1);
    expect(reflected.y).toBeCloseTo(1);
  });

  it('lerp midpoint', () => {
    const m = vec2Lerp({ x: 0, y: 0 }, { x: 10, y: 20 }, 0.5);
    expect(m).toEqual({ x: 5, y: 10 });
  });

  it('clampLength — no-op when under max', () => {
    const v = { x: 3, y: 4 }; // length = 5
    const c = vec2ClampLength(v, 10);
    expect(vec2Length(c)).toBeCloseTo(5);
  });
  it('clampLength — clamps when over max', () => {
    const v = { x: 3, y: 4 }; // length = 5
    const c = vec2ClampLength(v, 2);
    expect(vec2Length(c)).toBeCloseTo(2);
  });
});

describe('comparison', () => {
  it('equals with default epsilon', () => {
    expect(vec2Equals({ x: 1, y: 2 }, { x: 1, y: 2 })).toBe(true);
    expect(vec2Equals({ x: 1, y: 2 }, { x: 1.1, y: 2 })).toBe(false);
  });
  it('isZero', () => {
    expect(vec2IsZero({ x: 0, y: 0 })).toBe(true);
    expect(vec2IsZero({ x: 0.001, y: 0 })).toBe(false);
  });
});
