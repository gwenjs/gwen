/**
 * Unit tests for the compound-collider encoding helper.
 *
 * Tests are deliberately pure (no mocks, no WASM) — they exercise
 * encodeCompoundShapes() in isolation to validate the Float32Array layout.
 */
import { describe, it, expect } from 'vitest';
import {
  encodeCompoundShapes,
  COMPOUND_SHAPE_BOX,
  COMPOUND_SHAPE_SPHERE,
  COMPOUND_SHAPE_CAPSULE,
  FLOATS_PER_COMPOUND_SHAPE,
} from '../src/helpers/compound';
import type { CompoundShapeSpec } from '../src/types';

describe('encodeCompoundShapes', () => {
  it('returns an empty Float32Array for an empty shapes list', () => {
    const buf = encodeCompoundShapes([], []);
    expect(buf).toBeInstanceOf(Float32Array);
    expect(buf.length).toBe(0);
  });

  it('encodes a single box shape correctly', () => {
    const shape: CompoundShapeSpec = {
      type: 'box',
      halfX: 1.0,
      halfY: 0.3,
      halfZ: 2.0,
      offsetY: 0.3,
    };
    const buf = encodeCompoundShapes([shape], [42]);
    expect(buf.length).toBe(FLOATS_PER_COMPOUND_SHAPE);
    expect(buf[0]).toBe(COMPOUND_SHAPE_BOX);
    expect(buf[1]).toBeCloseTo(1.0); // halfX
    expect(buf[2]).toBeCloseTo(0.3); // halfY
    expect(buf[3]).toBeCloseTo(2.0); // halfZ
    expect(buf[4]).toBe(0); // reserved p3
    expect(buf[5]).toBe(0); // offsetX default
    expect(buf[6]).toBeCloseTo(0.3); // offsetY
    expect(buf[7]).toBe(0); // offsetZ default
    expect(buf[8]).toBe(0); // isSensor = false
    expect(buf[9]).toBeCloseTo(0.5); // friction default
    expect(buf[10]).toBeCloseTo(0.0); // restitution default
    expect(buf[11]).toBe(42); // colliderId
  });

  it('encodes a sphere shape correctly', () => {
    const shape: CompoundShapeSpec = {
      type: 'sphere',
      radius: 0.35,
      offsetX: -0.9,
      isSensor: true,
    };
    const buf = encodeCompoundShapes([shape], [7]);
    expect(buf[0]).toBe(COMPOUND_SHAPE_SPHERE);
    expect(buf[1]).toBeCloseTo(0.35); // radius
    expect(buf[2]).toBe(0); // p1 unused
    expect(buf[3]).toBe(0); // p2 unused
    expect(buf[5]).toBeCloseTo(-0.9); // offsetX
    expect(buf[8]).toBe(1); // isSensor = true
    expect(buf[11]).toBe(7); // colliderId
  });

  it('encodes a capsule shape correctly', () => {
    const shape: CompoundShapeSpec = {
      type: 'capsule',
      radius: 0.25,
      halfHeight: 0.5,
      friction: 1.2,
    };
    const buf = encodeCompoundShapes([shape], [3]);
    expect(buf[0]).toBe(COMPOUND_SHAPE_CAPSULE);
    expect(buf[1]).toBeCloseTo(0.25); // radius
    expect(buf[2]).toBeCloseTo(0.5); // halfHeight
    expect(buf[9]).toBeCloseTo(1.2); // custom friction
    expect(buf[11]).toBe(3);
  });

  it('encodes multiple shapes with correct stride', () => {
    const shapes: CompoundShapeSpec[] = [
      { type: 'box', halfX: 1.0, halfY: 0.3, halfZ: 2.0 },
      { type: 'sphere', radius: 0.35 },
      { type: 'capsule', radius: 0.1, halfHeight: 0.4 },
    ];
    const buf = encodeCompoundShapes(shapes, [10, 11, 12]);
    expect(buf.length).toBe(3 * FLOATS_PER_COMPOUND_SHAPE);
    // First shape
    expect(buf[0]).toBe(COMPOUND_SHAPE_BOX);
    expect(buf[11]).toBe(10);
    // Second shape
    expect(buf[FLOATS_PER_COMPOUND_SHAPE]).toBe(COMPOUND_SHAPE_SPHERE);
    expect(buf[FLOATS_PER_COMPOUND_SHAPE + 11]).toBe(11);
    // Third shape
    expect(buf[2 * FLOATS_PER_COMPOUND_SHAPE]).toBe(COMPOUND_SHAPE_CAPSULE);
    expect(buf[2 * FLOATS_PER_COMPOUND_SHAPE + 11]).toBe(12);
  });

  it('applies custom friction and restitution per shape', () => {
    const shape: CompoundShapeSpec = {
      type: 'box',
      halfX: 0.5,
      halfY: 0.5,
      halfZ: 0.5,
      friction: 1.2,
      restitution: 0.8,
    };
    const buf = encodeCompoundShapes([shape], [99]);
    expect(buf[9]).toBeCloseTo(1.2);
    expect(buf[10]).toBeCloseTo(0.8);
  });

  it('throws when shapes.length !== colliderIds.length', () => {
    const shapes: CompoundShapeSpec[] = [{ type: 'box', halfX: 1, halfY: 1, halfZ: 1 }];
    expect(() => encodeCompoundShapes(shapes, [])).toThrow(/shapes\.length.*colliderIds\.length/);
  });

  it('encodes all-zero offsets when offsets are omitted', () => {
    const buf = encodeCompoundShapes([{ type: 'sphere', radius: 1.0 }], [0]);
    expect(buf[5]).toBe(0); // offsetX
    expect(buf[6]).toBe(0); // offsetY
    expect(buf[7]).toBe(0); // offsetZ
  });
});
