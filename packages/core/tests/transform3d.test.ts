/**
 * PR-04: 3D transform contract tests.
 *
 * Verifies the 48-byte layout, TRANSFORM_OFFSETS constants, and read/write
 * buffer accessors are deterministic — stable baseline for render adapters.
 */

import { describe, it, expect } from 'vitest';
import {
  TRANSFORM_OFFSETS,
  readTransform3DPosition,
  readTransform3DRotation,
  readTransform3DScale,
  writeTransform3DPosition,
  writeTransform3DRotation,
  writeTransform3DScale,
} from '../src/components/transform3d';
import { TRANSFORM3D_STRIDE } from '../src/wasm/shared-memory';

// ── Layout constants ──────────────────────────────────────────────────────────

describe('TRANSFORM_OFFSETS — layout contract', () => {
  it('position fields start at byte 0', () => {
    expect(TRANSFORM_OFFSETS.X).toBe(0);
    expect(TRANSFORM_OFFSETS.Y).toBe(4);
    expect(TRANSFORM_OFFSETS.Z).toBe(8);
  });

  it('quaternion fields start at byte 12', () => {
    expect(TRANSFORM_OFFSETS.QX).toBe(12);
    expect(TRANSFORM_OFFSETS.QY).toBe(16);
    expect(TRANSFORM_OFFSETS.QZ).toBe(20);
    expect(TRANSFORM_OFFSETS.QW).toBe(24);
  });

  it('scale fields start at byte 28', () => {
    expect(TRANSFORM_OFFSETS.SCALE_X).toBe(28);
    expect(TRANSFORM_OFFSETS.SCALE_Y).toBe(32);
    expect(TRANSFORM_OFFSETS.SCALE_Z).toBe(36);
  });

  it('flags field is at byte 40', () => {
    expect(TRANSFORM_OFFSETS.FLAGS).toBe(40);
  });

  it('total stride is 48 bytes', () => {
    expect(TRANSFORM3D_STRIDE).toBe(48);
  });

  it('fields do not overlap (each f32 is 4 bytes apart)', () => {
    const offsets = [
      TRANSFORM_OFFSETS.X,
      TRANSFORM_OFFSETS.Y,
      TRANSFORM_OFFSETS.Z,
      TRANSFORM_OFFSETS.QX,
      TRANSFORM_OFFSETS.QY,
      TRANSFORM_OFFSETS.QZ,
      TRANSFORM_OFFSETS.QW,
      TRANSFORM_OFFSETS.SCALE_X,
      TRANSFORM_OFFSETS.SCALE_Y,
      TRANSFORM_OFFSETS.SCALE_Z,
      TRANSFORM_OFFSETS.FLAGS,
    ];
    const sorted = [...offsets].sort((a, b) => a - b);
    expect(sorted).toEqual(offsets); // already sorted
    // Consecutive f32 fields are 4 bytes apart (FLAGS is the last f32 field)
    for (let i = 1; i < offsets.length; i++) {
      expect((offsets[i] ?? 0) - (offsets[i - 1] ?? 0)).toBe(4);
    }
  });
});

// ── Buffer accessor helpers ───────────────────────────────────────────────────

function makeBuffer(slots = 2): { buffer: ArrayBuffer; view: DataView } {
  const buffer = new ArrayBuffer(TRANSFORM3D_STRIDE * slots);
  return { buffer, view: new DataView(buffer) };
}

describe('readTransform3DPosition / writeTransform3DPosition', () => {
  it('round-trips position for slot 0', () => {
    const { view } = makeBuffer();
    writeTransform3DPosition(view, 0, TRANSFORM3D_STRIDE, 1.5, -2.25, 100.0);
    const pos = readTransform3DPosition(view, 0, TRANSFORM3D_STRIDE);
    expect(pos.x).toBeCloseTo(1.5);
    expect(pos.y).toBeCloseTo(-2.25);
    expect(pos.z).toBeCloseTo(100.0);
  });

  it('round-trips position for slot 1 without corrupting slot 0', () => {
    const { view } = makeBuffer();
    writeTransform3DPosition(view, 0, TRANSFORM3D_STRIDE, 1.0, 2.0, 3.0);
    writeTransform3DPosition(view, 1, TRANSFORM3D_STRIDE, 4.0, 5.0, 6.0);

    const pos0 = readTransform3DPosition(view, 0, TRANSFORM3D_STRIDE);
    const pos1 = readTransform3DPosition(view, 1, TRANSFORM3D_STRIDE);

    expect(pos0).toMatchObject({ x: 1.0, y: 2.0, z: 3.0 });
    expect(pos1).toMatchObject({ x: 4.0, y: 5.0, z: 6.0 });
  });

  it('writes to the correct byte offsets (X=0, Y=4, Z=8)', () => {
    const { view } = makeBuffer();
    writeTransform3DPosition(view, 0, TRANSFORM3D_STRIDE, 1.0, 2.0, 3.0);
    expect(view.getFloat32(TRANSFORM_OFFSETS.X, true)).toBeCloseTo(1.0);
    expect(view.getFloat32(TRANSFORM_OFFSETS.Y, true)).toBeCloseTo(2.0);
    expect(view.getFloat32(TRANSFORM_OFFSETS.Z, true)).toBeCloseTo(3.0);
  });
});

describe('readTransform3DRotation / writeTransform3DRotation', () => {
  it('round-trips identity quaternion', () => {
    const { view } = makeBuffer();
    writeTransform3DRotation(view, 0, TRANSFORM3D_STRIDE, 0, 0, 0, 1);
    const rot = readTransform3DRotation(view, 0, TRANSFORM3D_STRIDE);
    expect(rot).toMatchObject({ x: 0, y: 0, z: 0, w: 1 });
  });

  it('round-trips arbitrary quaternion', () => {
    const { view } = makeBuffer();
    writeTransform3DRotation(view, 0, TRANSFORM3D_STRIDE, 0.1, 0.2, 0.3, 0.9274);
    const rot = readTransform3DRotation(view, 0, TRANSFORM3D_STRIDE);
    expect(rot.x).toBeCloseTo(0.1);
    expect(rot.y).toBeCloseTo(0.2);
    expect(rot.z).toBeCloseTo(0.3);
    expect(rot.w).toBeCloseTo(0.9274);
  });

  it('writes to correct offsets (QX=12, QY=16, QZ=20, QW=24)', () => {
    const { view } = makeBuffer();
    writeTransform3DRotation(view, 0, TRANSFORM3D_STRIDE, 0.1, 0.2, 0.3, 0.9274);
    expect(view.getFloat32(TRANSFORM_OFFSETS.QX, true)).toBeCloseTo(0.1);
    expect(view.getFloat32(TRANSFORM_OFFSETS.QY, true)).toBeCloseTo(0.2);
    expect(view.getFloat32(TRANSFORM_OFFSETS.QZ, true)).toBeCloseTo(0.3);
    expect(view.getFloat32(TRANSFORM_OFFSETS.QW, true)).toBeCloseTo(0.9274);
  });
});

describe('readTransform3DScale / writeTransform3DScale', () => {
  it('round-trips unit scale', () => {
    const { view } = makeBuffer();
    writeTransform3DScale(view, 0, TRANSFORM3D_STRIDE, 1, 1, 1);
    const scale = readTransform3DScale(view, 0, TRANSFORM3D_STRIDE);
    expect(scale).toMatchObject({ x: 1, y: 1, z: 1 });
  });

  it('round-trips non-uniform scale', () => {
    const { view } = makeBuffer();
    writeTransform3DScale(view, 0, TRANSFORM3D_STRIDE, 2.0, 0.5, 3.14);
    const scale = readTransform3DScale(view, 0, TRANSFORM3D_STRIDE);
    expect(scale.x).toBeCloseTo(2.0);
    expect(scale.y).toBeCloseTo(0.5);
    expect(scale.z).toBeCloseTo(3.14);
  });

  it('writes to correct offsets (SCALE_X=28, SCALE_Y=32, SCALE_Z=36)', () => {
    const { view } = makeBuffer();
    writeTransform3DScale(view, 0, TRANSFORM3D_STRIDE, 2.0, 0.5, 3.14);
    expect(view.getFloat32(TRANSFORM_OFFSETS.SCALE_X, true)).toBeCloseTo(2.0);
    expect(view.getFloat32(TRANSFORM_OFFSETS.SCALE_Y, true)).toBeCloseTo(0.5);
    expect(view.getFloat32(TRANSFORM_OFFSETS.SCALE_Z, true)).toBeCloseTo(3.14);
  });
});

describe('field isolation — writing one field does not corrupt adjacent fields', () => {
  it('position write does not affect rotation or scale bytes', () => {
    const { view } = makeBuffer();
    // Set rotation and scale first
    writeTransform3DRotation(view, 0, TRANSFORM3D_STRIDE, 0.1, 0.2, 0.3, 0.9274);
    writeTransform3DScale(view, 0, TRANSFORM3D_STRIDE, 2.0, 3.0, 4.0);
    // Overwrite position
    writeTransform3DPosition(view, 0, TRANSFORM3D_STRIDE, 9.9, 8.8, 7.7);

    expect(readTransform3DRotation(view, 0, TRANSFORM3D_STRIDE)).toMatchObject({
      x: expect.closeTo(0.1),
      y: expect.closeTo(0.2),
      z: expect.closeTo(0.3),
      w: expect.closeTo(0.9274),
    });
    expect(readTransform3DScale(view, 0, TRANSFORM3D_STRIDE)).toMatchObject({
      x: expect.closeTo(2.0),
      y: expect.closeTo(3.0),
      z: expect.closeTo(4.0),
    });
  });

  it('rotation write does not affect position or scale bytes', () => {
    const { view } = makeBuffer();
    writeTransform3DPosition(view, 0, TRANSFORM3D_STRIDE, 1.0, 2.0, 3.0);
    writeTransform3DScale(view, 0, TRANSFORM3D_STRIDE, 2.0, 3.0, 4.0);
    writeTransform3DRotation(view, 0, TRANSFORM3D_STRIDE, 0.5, 0.5, 0.5, 0.5);

    expect(readTransform3DPosition(view, 0, TRANSFORM3D_STRIDE)).toMatchObject({
      x: expect.closeTo(1.0),
      y: expect.closeTo(2.0),
      z: expect.closeTo(3.0),
    });
    expect(readTransform3DScale(view, 0, TRANSFORM3D_STRIDE)).toMatchObject({
      x: expect.closeTo(2.0),
      y: expect.closeTo(3.0),
      z: expect.closeTo(4.0),
    });
  });
});
