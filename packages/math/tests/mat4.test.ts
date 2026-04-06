import { describe, it, expect } from 'vitest';
import {
  mat4,
  mat4Identity,
  mat4Zero,
  mat4Clone,
  mat4Mul,
  mat4MulVec4,
  mat4MulPoint,
  mat4MulDir,
  mat4Transpose,
  mat4ToMat3,
  mat4Translate,
  mat4Scale,
  mat4RotateX,
  mat4RotateY,
  mat4RotateZ,
  mat4FromQuat,
  mat4TRS,
  mat4Perspective,
  mat4Ortho,
  mat4LookAt,
  mat4Equals,
} from '../src/mat4.js';
import { vec3, vec3Zero } from '../src/vec3.js';
import { vec4 } from '../src/vec4.js';
import { quatIdentity, quatFromAxisAngle } from '../src/quat.js';

describe('mat4 constructors', () => {
  it('mat4 creates matrix from 16 values', () => {
    const m = mat4(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16);
    expect(m.m00).toBe(1);
    expect(m.m33).toBe(16);
  });

  it('mat4Identity returns identity matrix', () => {
    const m = mat4Identity();
    expect(m.m00).toBe(1);
    expect(m.m11).toBe(1);
    expect(m.m22).toBe(1);
    expect(m.m33).toBe(1);
    expect(m.m01).toBe(0);
    expect(m.m10).toBe(0);
  });

  it('mat4Zero returns zero matrix', () => {
    const m = mat4Zero();
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        const key = `m${i}${j}` as keyof typeof m;
        expect(m[key]).toBe(0);
      }
    }
  });

  it('mat4Clone creates new object', () => {
    const m = mat4Identity();
    const cloned = mat4Clone(m);
    expect(cloned).toEqual(m);
    expect(cloned).not.toBe(m);
  });
});

describe('mat4 arithmetic', () => {
  it('multiply identity by identity returns identity', () => {
    const id = mat4Identity();
    const result = mat4Mul(id, id);
    expect(mat4Equals(result, id)).toBe(true);
  });

  it('multiply matrix by identity returns same matrix', () => {
    const m = mat4Translate(5, 10, 15);
    const id = mat4Identity();
    const result = mat4Mul(m, id);
    expect(mat4Equals(result, m)).toBe(true);
  });

  it('multiply two translation matrices', () => {
    const t1 = mat4Translate(1, 2, 3);
    const t2 = mat4Translate(4, 5, 6);
    const result = mat4Mul(t1, t2);
    // Translation composition should give translation by (1+4, 2+5, 3+6)
    expect(result.m03).toBeCloseTo(1 + 4, 5);
    expect(result.m13).toBeCloseTo(2 + 5, 5);
    expect(result.m23).toBeCloseTo(3 + 6, 5);
  });

  it('multiply mat4 by vec4', () => {
    const m = mat4Identity();
    const v = vec4(1, 2, 3, 4);
    const result = mat4MulVec4(m, v);
    expect(result).toEqual({ x: 1, y: 2, z: 3, w: 4 });
  });

  it('multiply scaling matrix by vec4', () => {
    const m = mat4Scale(2, 3, 4);
    const v = vec4(1, 1, 1, 1);
    const result = mat4MulVec4(m, v);
    expect(result).toEqual({ x: 2, y: 3, z: 4, w: 1 });
  });

  it('mul point applies translation', () => {
    const m = mat4Translate(5, 10, 15);
    const p = vec3(1, 2, 3);
    const result = mat4MulPoint(m, p);
    expect(result).toEqual({ x: 1 + 5, y: 2 + 10, z: 3 + 15 });
  });

  it('mul point with scaling', () => {
    const m = mat4Scale(2, 2, 2);
    const p = vec3(1, 2, 3);
    const result = mat4MulPoint(m, p);
    expect(result).toEqual({ x: 2, y: 4, z: 6 });
  });

  it('mul direction ignores translation', () => {
    const m = mat4Translate(5, 10, 15);
    const d = vec3(1, 0, 0);
    const result = mat4MulDir(m, d);
    expect(result).toEqual({ x: 1, y: 0, z: 0 });
  });

  it('mul direction applies scaling', () => {
    const m = mat4Scale(2, 2, 2);
    const d = vec3(1, 2, 3);
    const result = mat4MulDir(m, d);
    expect(result).toEqual({ x: 2, y: 4, z: 6 });
  });
});

describe('mat4 transpose', () => {
  it('transpose identity returns identity', () => {
    const m = mat4Identity();
    const result = mat4Transpose(m);
    expect(mat4Equals(result, m)).toBe(true);
  });

  it('transpose twice returns original', () => {
    const m = mat4Translate(1, 2, 3);
    const result = mat4Transpose(mat4Transpose(m));
    expect(mat4Equals(result, m)).toBe(true);
  });
});

describe('mat4 to mat3', () => {
  it('extract upper-left 3x3 from identity', () => {
    const m = mat4Identity();
    const m3 = mat4ToMat3(m);
    expect(m3.m00).toBe(1);
    expect(m3.m11).toBe(1);
    expect(m3.m22).toBe(1);
    expect(m3.m01).toBe(0);
  });

  it('extract 3x3 from translation matrix', () => {
    const m = mat4Translate(5, 10, 15);
    const m3 = mat4ToMat3(m);
    // Translation is in m03, m13, m23, not in upper-left 3x3
    expect(m3.m00).toBe(1);
    expect(m3.m11).toBe(1);
    expect(m3.m22).toBe(1);
  });

  it('extract 3x3 from scale matrix', () => {
    const m = mat4Scale(2, 3, 4);
    const m3 = mat4ToMat3(m);
    expect(m3.m00).toBe(2);
    expect(m3.m11).toBe(3);
    expect(m3.m22).toBe(4);
  });
});

describe('mat4 transform factories', () => {
  it('translate creates translation matrix', () => {
    const m = mat4Translate(5, 10, 15);
    expect(m.m03).toBe(5);
    expect(m.m13).toBe(10);
    expect(m.m23).toBe(15);
  });

  it('scale creates scale matrix', () => {
    const m = mat4Scale(2, 3, 4);
    expect(m.m00).toBe(2);
    expect(m.m11).toBe(3);
    expect(m.m22).toBe(4);
  });

  it('rotateX creates rotation around X axis', () => {
    const m = mat4RotateX(0);
    expect(m.m11).toBeCloseTo(1, 5);
    expect(m.m22).toBeCloseTo(1, 5);
  });

  it('rotateY creates rotation around Y axis', () => {
    const m = mat4RotateY(0);
    expect(m.m00).toBeCloseTo(1, 5);
    expect(m.m22).toBeCloseTo(1, 5);
  });

  it('rotateZ creates rotation around Z axis', () => {
    const m = mat4RotateZ(0);
    expect(m.m00).toBeCloseTo(1, 5);
    expect(m.m11).toBeCloseTo(1, 5);
  });

  it('rotateX 90 degrees rotates Y to Z', () => {
    const PI_2 = Math.PI / 2;
    const m = mat4RotateX(PI_2);
    const v = vec4(0, 1, 0, 0);
    const result = mat4MulVec4(m, v);
    expect(result.x).toBeCloseTo(0, 5);
    expect(result.y).toBeCloseTo(0, 5);
    expect(result.z).toBeCloseTo(1, 4);
  });

  it('rotateY 90 degrees rotates Z to X', () => {
    const PI_2 = Math.PI / 2;
    const m = mat4RotateY(PI_2);
    const v = vec4(0, 0, 1, 0);
    const result = mat4MulVec4(m, v);
    expect(result.x).toBeCloseTo(1, 4);
    expect(result.y).toBeCloseTo(0, 5);
    expect(result.z).toBeCloseTo(0, 5);
  });

  it('rotateZ 90 degrees rotates X to Y', () => {
    const PI_2 = Math.PI / 2;
    const m = mat4RotateZ(PI_2);
    const v = vec4(1, 0, 0, 0);
    const result = mat4MulVec4(m, v);
    expect(result.x).toBeCloseTo(0, 5);
    expect(result.y).toBeCloseTo(1, 4);
    expect(result.z).toBeCloseTo(0, 5);
  });
});

describe('mat4 from quaternion', () => {
  it('fromQuat with identity quaternion gives identity rotation', () => {
    const q = quatIdentity();
    const m = mat4FromQuat(q);
    expect(m.m00).toBeCloseTo(1, 5);
    expect(m.m11).toBeCloseTo(1, 5);
    expect(m.m22).toBeCloseTo(1, 5);
    expect(m.m01).toBeCloseTo(0, 5);
  });

  it('fromQuat with 90-degree rotation around Z axis', () => {
    const PI_2 = Math.PI / 2;
    const q = quatFromAxisAngle(vec3(0, 0, 1), PI_2);
    const m = mat4FromQuat(q);
    const v = vec4(1, 0, 0, 0);
    const result = mat4MulVec4(m, v);
    expect(result.x).toBeCloseTo(0, 4);
    expect(result.y).toBeCloseTo(1, 4);
  });
});

describe('mat4 TRS (Transform-Rotate-Scale)', () => {
  it('TRS with identity values', () => {
    const m = mat4TRS(vec3Zero(), quatIdentity(), vec3(1, 1, 1));
    expect(mat4Equals(m, mat4Identity())).toBe(true);
  });

  it('TRS applies translation', () => {
    const m = mat4TRS(vec3(5, 10, 15), quatIdentity(), vec3(1, 1, 1));
    expect(m.m03).toBeCloseTo(5, 5);
    expect(m.m13).toBeCloseTo(10, 5);
    expect(m.m23).toBeCloseTo(15, 5);
  });

  it('TRS applies scale', () => {
    const m = mat4TRS(vec3Zero(), quatIdentity(), vec3(2, 3, 4));
    expect(m.m00).toBeCloseTo(2, 5);
    expect(m.m11).toBeCloseTo(3, 5);
    expect(m.m22).toBeCloseTo(4, 5);
  });

  it('TRS combines translation and scale', () => {
    const m = mat4TRS(vec3(1, 2, 3), quatIdentity(), vec3(2, 2, 2));
    // Scale applied first, then translation
    expect(m.m00).toBeCloseTo(2, 5);
    expect(m.m03).toBeCloseTo(1, 5);
    expect(m.m13).toBeCloseTo(2, 5);
    expect(m.m23).toBeCloseTo(3, 5);
  });
});

describe('mat4 projection matrices', () => {
  it('perspective matrix has correct structure', () => {
    const fov = Math.PI / 4;
    const aspect = 16 / 9;
    const near = 0.1;
    const far = 100;
    const m = mat4Perspective(fov, aspect, near, far);
    expect(m.m00).toBeCloseTo(1 / Math.tan(fov / 2) / aspect, 5);
    expect(m.m11).toBeCloseTo(1 / Math.tan(fov / 2), 5);
    expect(m.m32).toBe(-1);
  });

  it('ortho matrix has correct structure', () => {
    const m = mat4Ortho(-1, 1, -1, 1, 0.1, 100);
    expect(m.m00).toBeCloseTo(2 / (1 - -1), 5);
    expect(m.m11).toBeCloseTo(2 / (1 - -1), 5);
    expect(m.m33).toBe(1);
  });

  it('lookAt with forward direction', () => {
    const eye = vec3(0, 0, 5);
    const center = vec3(0, 0, 0);
    const up = vec3(0, 1, 0);
    const m = mat4LookAt(eye, center, up);
    expect(m).not.toBeNull();
    // The matrix should be valid
    expect(m.m33).toBeCloseTo(1, 5);
  });

  it('lookAt same eye and center returns identity', () => {
    const eye = vec3(1, 1, 1);
    const center = vec3(1, 1, 1);
    const up = vec3(0, 1, 0);
    const m = mat4LookAt(eye, center, up);
    expect(mat4Equals(m, mat4Identity())).toBe(true);
  });

  it('lookAt with parallel eye-forward and up vectors', () => {
    const eye = vec3(0, 0, 5);
    const center = vec3(0, 1, 5);
    const up = vec3(0, 1, 0);
    const m = mat4LookAt(eye, center, up);
    // When forward and up are parallel, should return identity
    expect(mat4Equals(m, mat4Identity())).toBe(true);
  });
});

describe('mat4 equality', () => {
  it('identity equals itself', () => {
    const m = mat4Identity();
    expect(mat4Equals(m, m)).toBe(true);
  });

  it('two identical matrices are equal', () => {
    const m1 = mat4Translate(1, 2, 3);
    const m2 = mat4Translate(1, 2, 3);
    expect(mat4Equals(m1, m2)).toBe(true);
  });

  it('different matrices are not equal', () => {
    const m1 = mat4Identity();
    const m2 = mat4Zero();
    expect(mat4Equals(m1, m2)).toBe(false);
  });
});
