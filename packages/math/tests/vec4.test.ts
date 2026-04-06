import { describe, it, expect } from 'vitest';
import {
  vec4,
  vec4Zero,
  vec4One,
  vec4Point,
  vec4Dir,
  vec4Clone,
  vec4Add,
  vec4AddMut,
  vec4Sub,
  vec4SubMut,
  vec4Scale,
  vec4ScaleMut,
  vec4Mul,
  vec4Negate,
  vec4Dot,
  vec4LengthSq,
  vec4Length,
  vec4Normalize,
  vec4Lerp,
  vec4Equals,
} from '../src/vec4.js';

describe('vec4 constructors', () => {
  it('vec4', () => expect(vec4(1, 2, 3, 4)).toEqual({ x: 1, y: 2, z: 3, w: 4 }));

  it('vec4Zero', () => expect(vec4Zero()).toEqual({ x: 0, y: 0, z: 0, w: 0 }));

  it('vec4One', () => expect(vec4One()).toEqual({ x: 1, y: 1, z: 1, w: 1 }));

  it('vec4Point creates point with w=1', () =>
    expect(vec4Point(1, 2, 3)).toEqual({ x: 1, y: 2, z: 3, w: 1 }));

  it('vec4Dir creates direction with w=0', () =>
    expect(vec4Dir(1, 2, 3)).toEqual({ x: 1, y: 2, z: 3, w: 0 }));

  it('vec4Clone creates new object', () => {
    const v = vec4(1, 2, 3, 4);
    const cloned = vec4Clone(v);
    expect(cloned).toEqual(v);
    expect(cloned).not.toBe(v);
  });
});

describe('vec4 arithmetic', () => {
  it('add', () => {
    const a = vec4(1, 2, 3, 4);
    const b = vec4(5, 6, 7, 8);
    expect(vec4Add(a, b)).toEqual({ x: 6, y: 8, z: 10, w: 12 });
  });

  it('addMut', () => {
    const a = vec4(1, 2, 3, 4);
    const b = vec4(5, 6, 7, 8);
    vec4AddMut(a, b);
    expect(a).toEqual({ x: 6, y: 8, z: 10, w: 12 });
  });

  it('sub', () => {
    const a = vec4(5, 6, 7, 8);
    const b = vec4(1, 2, 3, 4);
    expect(vec4Sub(a, b)).toEqual({ x: 4, y: 4, z: 4, w: 4 });
  });

  it('subMut', () => {
    const a = vec4(5, 6, 7, 8);
    const b = vec4(1, 2, 3, 4);
    vec4SubMut(a, b);
    expect(a).toEqual({ x: 4, y: 4, z: 4, w: 4 });
  });

  it('scale', () => {
    const v = vec4(1, 2, 3, 4);
    expect(vec4Scale(v, 2)).toEqual({ x: 2, y: 4, z: 6, w: 8 });
  });

  it('scaleMut', () => {
    const v = vec4(1, 2, 3, 4);
    vec4ScaleMut(v, 2);
    expect(v).toEqual({ x: 2, y: 4, z: 6, w: 8 });
  });

  it('mul component-wise', () => {
    const a = vec4(1, 2, 3, 4);
    const b = vec4(2, 3, 4, 5);
    expect(vec4Mul(a, b)).toEqual({ x: 2, y: 6, z: 12, w: 20 });
  });

  it('negate', () => {
    const v = vec4(1, -2, 3, -4);
    expect(vec4Negate(v)).toEqual({ x: -1, y: 2, z: -3, w: 4 });
  });
});

describe('vec4 geometry', () => {
  it('dot product perpendicular vectors', () => {
    const a = vec4(1, 0, 0, 0);
    const b = vec4(0, 1, 0, 0);
    expect(vec4Dot(a, b)).toBe(0);
  });

  it('dot product parallel vectors', () => {
    const a = vec4(1, 0, 0, 0);
    const b = vec4(2, 0, 0, 0);
    expect(vec4Dot(a, b)).toBe(2);
  });

  it('dot product with all components', () => {
    const a = vec4(1, 2, 3, 4);
    const b = vec4(5, 6, 7, 8);
    expect(vec4Dot(a, b)).toBe(1 * 5 + 2 * 6 + 3 * 7 + 4 * 8);
  });

  it('length of unit vectors', () => {
    expect(vec4Length(vec4(1, 0, 0, 0))).toBeCloseTo(1, 5);
    expect(vec4Length(vec4(0, 1, 0, 0))).toBeCloseTo(1, 5);
    expect(vec4Length(vec4(0, 0, 1, 0))).toBeCloseTo(1, 5);
    expect(vec4Length(vec4(0, 0, 0, 1))).toBeCloseTo(1, 5);
  });

  it('lengthSq of vector', () => {
    const v = vec4(1, 2, 3, 4);
    expect(vec4LengthSq(v)).toBe(1 + 4 + 9 + 16);
  });

  it('length of (3,4,0,0) is 5', () => {
    const v = vec4(3, 4, 0, 0);
    expect(vec4Length(v)).toBeCloseTo(5, 5);
  });

  it('normalize zero vector returns zero', () => {
    const v = vec4Zero();
    expect(vec4Normalize(v)).toEqual({ x: 0, y: 0, z: 0, w: 0 });
  });

  it('normalize unit vector returns itself', () => {
    const v = vec4(1, 0, 0, 0);
    const normalized = vec4Normalize(v);
    expect(normalized.x).toBeCloseTo(1, 5);
    expect(normalized.y).toBeCloseTo(0, 5);
    expect(normalized.z).toBeCloseTo(0, 5);
    expect(normalized.w).toBeCloseTo(0, 5);
  });

  it('normalize vector with length 5', () => {
    const v = vec4(3, 4, 0, 0);
    const normalized = vec4Normalize(v);
    expect(normalized.x).toBeCloseTo(0.6, 5);
    expect(normalized.y).toBeCloseTo(0.8, 5);
    expect(vec4Length(normalized)).toBeCloseTo(1, 5);
  });

  it('normalize then scale back', () => {
    const v = vec4(2, 3, 4, 5);
    const len = vec4Length(v);
    const normalized = vec4Normalize(v);
    const scaled = vec4Scale(normalized, len);
    expect(scaled.x).toBeCloseTo(v.x, 4);
    expect(scaled.y).toBeCloseTo(v.y, 4);
    expect(scaled.z).toBeCloseTo(v.z, 4);
    expect(scaled.w).toBeCloseTo(v.w, 4);
  });
});

describe('vec4 interpolation', () => {
  it('lerp at t=0 returns start', () => {
    const a = vec4(1, 2, 3, 4);
    const b = vec4(5, 6, 7, 8);
    expect(vec4Lerp(a, b, 0)).toEqual(a);
  });

  it('lerp at t=1 returns end', () => {
    const a = vec4(1, 2, 3, 4);
    const b = vec4(5, 6, 7, 8);
    expect(vec4Lerp(a, b, 1)).toEqual(b);
  });

  it('lerp at t=0.5 returns midpoint', () => {
    const a = vec4(0, 0, 0, 0);
    const b = vec4(2, 4, 6, 8);
    const result = vec4Lerp(a, b, 0.5);
    expect(result).toEqual({ x: 1, y: 2, z: 3, w: 4 });
  });

  it('lerp with negative t extrapolates backwards', () => {
    const a = vec4(1, 1, 1, 1);
    const b = vec4(3, 3, 3, 3);
    const result = vec4Lerp(a, b, -0.5);
    expect(result).toEqual({ x: 0, y: 0, z: 0, w: 0 });
  });

  it('lerp with t > 1 extrapolates forwards', () => {
    const a = vec4(0, 0, 0, 0);
    const b = vec4(1, 1, 1, 1);
    const result = vec4Lerp(a, b, 2);
    expect(result).toEqual({ x: 2, y: 2, z: 2, w: 2 });
  });
});

describe('vec4 equality', () => {
  it('vec4Equals for identical vectors', () => {
    const a = vec4(1, 2, 3, 4);
    const b = vec4(1, 2, 3, 4);
    expect(vec4Equals(a, b)).toBe(true);
  });

  it('vec4Equals for different vectors', () => {
    const a = vec4(1, 2, 3, 4);
    const b = vec4(1, 2, 3, 5);
    expect(vec4Equals(a, b)).toBe(false);
  });

  it('vec4Equals for same object', () => {
    const a = vec4(1, 2, 3, 4);
    expect(vec4Equals(a, a)).toBe(true);
  });

  it('vec4Equals zero vectors', () => {
    const a = vec4Zero();
    const b = vec4Zero();
    expect(vec4Equals(a, b)).toBe(true);
  });

  it('vec4Equals ones vectors', () => {
    const a = vec4One();
    const b = vec4One();
    expect(vec4Equals(a, b)).toBe(true);
  });
});

describe('vec4 special cases', () => {
  it('adding to zero vector', () => {
    const v = vec4(1, 2, 3, 4);
    const zero = vec4Zero();
    expect(vec4Add(v, zero)).toEqual(v);
    expect(vec4Add(zero, v)).toEqual(v);
  });

  it('scaling by zero', () => {
    const v = vec4(1, 2, 3, 4);
    expect(vec4Scale(v, 0)).toEqual(vec4Zero());
  });

  it('scaling by one', () => {
    const v = vec4(1, 2, 3, 4);
    expect(vec4Scale(v, 1)).toEqual(v);
  });

  it('scaling by negative', () => {
    const v = vec4(1, 2, 3, 4);
    expect(vec4Scale(v, -1)).toEqual(vec4Negate(v));
  });

  it('double negate returns same vector', () => {
    const v = vec4(1, -2, 3, -4);
    expect(vec4Negate(vec4Negate(v))).toEqual(v);
  });

  it('point with zero w is direction', () => {
    const p = vec4Point(1, 2, 3);
    const d = vec4Dir(1, 2, 3);
    expect(p.w).toBe(1);
    expect(d.w).toBe(0);
    expect(p.x).toBe(d.x);
    expect(p.y).toBe(d.y);
    expect(p.z).toBe(d.z);
  });

  it('length of homogeneous point', () => {
    const p = vec4Point(3, 4, 0); // (3, 4, 0, 1)
    expect(vec4Length(p)).toBeCloseTo(Math.sqrt(9 + 16 + 0 + 1), 5);
  });

  it('length of homogeneous direction', () => {
    const d = vec4Dir(3, 4, 0); // (3, 4, 0, 0)
    expect(vec4Length(d)).toBeCloseTo(5, 5);
  });
});

describe('vec4 immutability', () => {
  it('add does not mutate inputs', () => {
    const a = vec4(1, 2, 3, 4);
    const b = vec4(5, 6, 7, 8);
    const aCopy = vec4Clone(a);
    const bCopy = vec4Clone(b);
    vec4Add(a, b);
    expect(a).toEqual(aCopy);
    expect(b).toEqual(bCopy);
  });

  it('addMut mutates first argument', () => {
    const a = vec4(1, 2, 3, 4);
    const b = vec4(5, 6, 7, 8);
    const bCopy = vec4Clone(b);
    vec4AddMut(a, b);
    expect(a).toEqual({ x: 6, y: 8, z: 10, w: 12 });
    expect(b).toEqual(bCopy); // b not mutated
  });

  it('scale does not mutate input', () => {
    const v = vec4(1, 2, 3, 4);
    const vCopy = vec4Clone(v);
    vec4Scale(v, 2);
    expect(v).toEqual(vCopy);
  });

  it('scaleMut mutates input', () => {
    const v = vec4(1, 2, 3, 4);
    vec4ScaleMut(v, 2);
    expect(v).toEqual({ x: 2, y: 4, z: 6, w: 8 });
  });
});
