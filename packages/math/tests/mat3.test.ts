import { describe, it, expect } from 'vitest';
import {
  mat3,
  mat3Identity,
  mat3Zero,
  mat3Clone,
  mat3Mul,
  mat3MulVec3,
  mat3Transpose,
  mat3Det,
  mat3Inverse,
  mat3Translate,
  mat3Rotate,
  mat3Scale,
  mat3NormalFromMat3,
  mat3Equals,
} from '../src/mat3.js';
import { vec3 } from '../src/vec3.js';

describe('mat3 constructors', () => {
  it('mat3 creates matrix from 9 values', () => {
    const m = mat3(1, 2, 3, 4, 5, 6, 7, 8, 9);
    expect(m).toEqual({ m00: 1, m01: 2, m02: 3, m10: 4, m11: 5, m12: 6, m20: 7, m21: 8, m22: 9 });
  });

  it('mat3Identity returns identity matrix', () => {
    const m = mat3Identity();
    expect(m).toEqual({
      m00: 1,
      m01: 0,
      m02: 0,
      m10: 0,
      m11: 1,
      m12: 0,
      m20: 0,
      m21: 0,
      m22: 1,
    });
  });

  it('mat3Zero returns zero matrix', () => {
    const m = mat3Zero();
    expect(m).toEqual({
      m00: 0,
      m01: 0,
      m02: 0,
      m10: 0,
      m11: 0,
      m12: 0,
      m20: 0,
      m21: 0,
      m22: 0,
    });
  });

  it('mat3Clone creates new object', () => {
    const m = mat3(1, 2, 3, 4, 5, 6, 7, 8, 9);
    const cloned = mat3Clone(m);
    expect(cloned).toEqual(m);
    expect(cloned).not.toBe(m);
  });
});

describe('mat3 arithmetic', () => {
  it('multiply identity by identity returns identity', () => {
    const id = mat3Identity();
    const result = mat3Mul(id, id);
    expect(mat3Equals(result, id)).toBe(true);
  });

  it('multiply matrix by identity returns same matrix', () => {
    const m = mat3(1, 2, 3, 4, 5, 6, 7, 8, 9);
    const id = mat3Identity();
    const result = mat3Mul(m, id);
    expect(mat3Equals(result, m)).toBe(true);
  });

  it('multiply two matrices', () => {
    const a = mat3(1, 2, 3, 0, 1, 4, 5, 6, 0);
    const b = mat3(7, 8, 9, 2, 0, 1, 3, 4, 5);
    const result = mat3Mul(a, b);
    expect(result).toEqual({
      m00: 1 * 7 + 2 * 2 + 3 * 3,
      m01: 1 * 8 + 2 * 0 + 3 * 4,
      m02: 1 * 9 + 2 * 1 + 3 * 5,
      m10: 0 * 7 + 1 * 2 + 4 * 3,
      m11: 0 * 8 + 1 * 0 + 4 * 4,
      m12: 0 * 9 + 1 * 1 + 4 * 5,
      m20: 5 * 7 + 6 * 2 + 0 * 3,
      m21: 5 * 8 + 6 * 0 + 0 * 4,
      m22: 5 * 9 + 6 * 1 + 0 * 5,
    });
  });

  it('multiply matrix by vec3', () => {
    const m = mat3Identity();
    const v = vec3(1, 2, 3);
    const result = mat3MulVec3(m, v);
    expect(result).toEqual({ x: 1, y: 2, z: 3 });
  });

  it('multiply scaling matrix by vec3', () => {
    const m = mat3Scale(2, 3);
    const v = vec3(1, 2, 3);
    const result = mat3MulVec3(m, v);
    // Scale matrix: [2 0 0; 0 3 0; 0 0 1]
    // Result: (2*1, 3*2, 1*3) = (2, 6, 3)
    expect(result).toEqual({ x: 2, y: 6, z: 3 });
  });

  it('multiply translation matrix by vec3', () => {
    const m = mat3Translate(5, 10);
    const v = vec3(1, 2, 3);
    const result = mat3MulVec3(m, v);
    // Translation matrix (2D homogeneous): [1 0 5; 0 1 10; 0 0 1]
    // For 3D: we multiply [1 0 5; 0 1 10; 0 0 1] * [1; 2; 3]
    // Result: (1*1 + 0*2 + 5*3, 0*1 + 1*2 + 10*3, 0*1 + 0*2 + 1*3) = (16, 32, 3)
    expect(result).toEqual({ x: 16, y: 32, z: 3 });
  });
});

describe('mat3 transpose', () => {
  it('transpose identity returns identity', () => {
    const m = mat3Identity();
    const result = mat3Transpose(m);
    expect(mat3Equals(result, m)).toBe(true);
  });

  it('transpose swaps rows and columns', () => {
    const m = mat3(1, 2, 3, 4, 5, 6, 7, 8, 9);
    const result = mat3Transpose(m);
    expect(result).toEqual({
      m00: 1,
      m01: 4,
      m02: 7,
      m10: 2,
      m11: 5,
      m12: 8,
      m20: 3,
      m21: 6,
      m22: 9,
    });
  });

  it('transpose twice returns original', () => {
    const m = mat3(1, 2, 3, 4, 5, 6, 7, 8, 9);
    const result = mat3Transpose(mat3Transpose(m));
    expect(mat3Equals(result, m)).toBe(true);
  });
});

describe('mat3 determinant', () => {
  it('determinant of identity is 1', () => {
    const m = mat3Identity();
    expect(mat3Det(m)).toBe(1);
  });

  it('determinant of zero matrix is 0', () => {
    const m = mat3Zero();
    expect(mat3Det(m)).toBe(0);
  });

  it('determinant of scale matrix', () => {
    const m = mat3Scale(2, 3);
    // 3×3 scale matrix: [2 0 0; 0 3 0; 0 0 1]
    // det = 2 * 3 * 1 = 6
    expect(mat3Det(m)).toBeCloseTo(6, 5);
  });

  it('determinant of simple 2x2-like matrix', () => {
    const m = mat3(1, 2, 0, 3, 4, 0, 0, 0, 1);
    // det = 1 * (4*1 - 0*0) - 2 * (3*1 - 0*0) + 0 = 4 - 6 = -2
    expect(mat3Det(m)).toBeCloseTo(-2, 5);
  });
});

describe('mat3 inverse', () => {
  it('inverse of identity is identity', () => {
    const m = mat3Identity();
    const inv = mat3Inverse(m);
    expect(inv).not.toBeNull();
    expect(mat3Equals(inv!, m)).toBe(true);
  });

  it('inverse of scale matrix', () => {
    const m = mat3Scale(2, 3, 4);
    const inv = mat3Inverse(m);
    expect(inv).not.toBeNull();
    const expected = mat3Scale(1 / 2, 1 / 3, 1 / 4);
    expect(inv!.m00).toBeCloseTo(expected.m00, 5);
    expect(inv!.m11).toBeCloseTo(expected.m11, 5);
    expect(inv!.m22).toBeCloseTo(expected.m22, 5);
  });

  it('matrix times its inverse is identity', () => {
    const m = mat3(1, 2, 3, 0, 1, 4, 5, 6, 0);
    const inv = mat3Inverse(m);
    expect(inv).not.toBeNull();
    const result = mat3Mul(m, inv!);
    const id = mat3Identity();
    expect(result.m00).toBeCloseTo(id.m00, 4);
    expect(result.m11).toBeCloseTo(id.m11, 4);
    expect(result.m22).toBeCloseTo(id.m22, 4);
  });

  it('inverse of singular matrix returns null', () => {
    const m = mat3(1, 2, 3, 2, 4, 6, 3, 6, 9); // singular (rows are linearly dependent)
    const inv = mat3Inverse(m);
    expect(inv).toBeNull();
  });
});

describe('mat3 factories', () => {
  it('translate creates translation matrix', () => {
    const m = mat3Translate(5, 10);
    expect(m.m02).toBe(5);
    expect(m.m12).toBe(10);
  });

  it('rotate creates rotation matrix', () => {
    const m = mat3Rotate(0);
    expect(m.m00).toBeCloseTo(1, 5);
    expect(m.m01).toBeCloseTo(0, 5);
    expect(m.m10).toBeCloseTo(0, 5);
    expect(m.m11).toBeCloseTo(1, 5);
  });

  it('rotate 90 degrees', () => {
    const PI_2 = Math.PI / 2;
    const m = mat3Rotate(PI_2);
    expect(m.m00).toBeCloseTo(0, 5);
    expect(m.m01).toBeCloseTo(-1, 5);
    expect(m.m10).toBeCloseTo(1, 5);
    expect(m.m11).toBeCloseTo(0, 5);
  });

  it('scale creates scale matrix', () => {
    const m = mat3Scale(2, 3);
    expect(m.m00).toBe(2);
    expect(m.m11).toBe(3);
    expect(m.m22).toBe(1);
  });
});

describe('mat3 normal matrix', () => {
  it('normal matrix of identity', () => {
    const m = mat3Identity();
    const normal = mat3NormalFromMat3(m);
    expect(normal).not.toBeNull();
    expect(mat3Equals(normal!, m)).toBe(true);
  });

  it('normal matrix of scale', () => {
    const m = mat3Scale(2, 3);
    const normal = mat3NormalFromMat3(m);
    expect(normal).not.toBeNull();
    // For scale matrix [2 0 0; 0 3 0; 0 0 1]:
    // Inverse is [1/2 0 0; 0 1/3 0; 0 0 1]
    // Transpose is same (diagonal)
    expect(normal!.m00).toBeCloseTo(1 / 2, 5);
    expect(normal!.m11).toBeCloseTo(1 / 3, 5);
    expect(normal!.m22).toBeCloseTo(1, 5);
  });

  it('normal matrix of singular matrix returns null or identity', () => {
    const m = mat3(1, 2, 3, 2, 4, 6, 3, 6, 9);
    const normal = mat3NormalFromMat3(m);
    // Based on implementation, it should return the result of transpose(inverse(m) ?? identity())
    // Since inverse fails, it should use identity, then transpose it (still identity)
    expect(normal).not.toBeNull();
  });
});

describe('mat3 equality', () => {
  it('identity equals itself', () => {
    const m = mat3Identity();
    expect(mat3Equals(m, m)).toBe(true);
  });

  it('two identical matrices are equal', () => {
    const m1 = mat3(1, 2, 3, 4, 5, 6, 7, 8, 9);
    const m2 = mat3(1, 2, 3, 4, 5, 6, 7, 8, 9);
    expect(mat3Equals(m1, m2)).toBe(true);
  });

  it('different matrices are not equal', () => {
    const m1 = mat3Identity();
    const m2 = mat3Zero();
    expect(mat3Equals(m1, m2)).toBe(false);
  });
});
