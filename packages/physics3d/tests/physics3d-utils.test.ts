/**
 * Unit tests for Physics3D utility functions.
 * All functions are pure and stateless; tests verify exact behavior and defaults.
 */
import { describe, it, expect } from 'vitest';

import {
  vec3,
  quat,
  toEntityIndex,
  kindFromU8,
  kindToU8,
  parseBodyState,
  cloneState,
  resolveColliderMaterial,
  computeColliderAABB,
  aabbOverlap,
} from '../src/plugin/physics3d-utils';

import type { Physics3DVec3, Physics3DBodyState, Physics3DColliderOptions } from '../src/types';

// ─── vec3() ────────────────────────────────────────────────────────────────

describe('vec3', () => {
  it('returns zero vector when called with no arguments', () => {
    const v = vec3();
    expect(v).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('returns zero vector when called with undefined', () => {
    const v = vec3(undefined);
    expect(v).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('applies single x override', () => {
    const v = vec3({ x: 5 });
    expect(v).toEqual({ x: 5, y: 0, z: 0 });
  });

  it('applies single y override', () => {
    const v = vec3({ y: -3 });
    expect(v).toEqual({ x: 0, y: -3, z: 0 });
  });

  it('applies single z override', () => {
    const v = vec3({ z: 2.5 });
    expect(v).toEqual({ x: 0, y: 0, z: 2.5 });
  });

  it('applies all overrides', () => {
    const v = vec3({ x: 1, y: 2, z: 3 });
    expect(v).toEqual({ x: 1, y: 2, z: 3 });
  });

  it('applies partial overrides correctly', () => {
    const v = vec3({ x: 10, z: -5 });
    expect(v).toEqual({ x: 10, y: 0, z: -5 });
  });

  it('handles zero overrides', () => {
    const v = vec3({ x: 0, y: 0, z: 0 });
    expect(v).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('handles negative values', () => {
    const v = vec3({ x: -1, y: -2.5, z: -100 });
    expect(v).toEqual({ x: -1, y: -2.5, z: -100 });
  });
});

// ─── quat() ────────────────────────────────────────────────────────────────

describe('quat', () => {
  it('returns identity quaternion when called with no arguments', () => {
    const q = quat();
    expect(q).toEqual({ x: 0, y: 0, z: 0, w: 1 });
  });

  it('returns identity quaternion when called with undefined', () => {
    const q = quat(undefined);
    expect(q).toEqual({ x: 0, y: 0, z: 0, w: 1 });
  });

  it('applies single x override', () => {
    const q = quat({ x: 0.5 });
    expect(q).toEqual({ x: 0.5, y: 0, z: 0, w: 1 });
  });

  it('applies single y override', () => {
    const q = quat({ y: -0.3 });
    expect(q).toEqual({ x: 0, y: -0.3, z: 0, w: 1 });
  });

  it('applies single z override', () => {
    const q = quat({ z: 0.2 });
    expect(q).toEqual({ x: 0, y: 0, z: 0.2, w: 1 });
  });

  it('applies single w override', () => {
    const q = quat({ w: 0 });
    expect(q).toEqual({ x: 0, y: 0, z: 0, w: 0 });
  });

  it('applies all overrides', () => {
    const q = quat({ x: 0.1, y: 0.2, z: 0.3, w: 0.9 });
    expect(q).toEqual({ x: 0.1, y: 0.2, z: 0.3, w: 0.9 });
  });

  it('applies partial overrides correctly', () => {
    const q = quat({ x: 0.5, w: 0.866 });
    expect(q).toEqual({ x: 0.5, y: 0, z: 0, w: 0.866 });
  });

  it('handles zero overrides', () => {
    const q = quat({ x: 0, y: 0, z: 0, w: 0 });
    expect(q).toEqual({ x: 0, y: 0, z: 0, w: 0 });
  });

  it('handles negative w (opposite rotation)', () => {
    const q = quat({ w: -1 });
    expect(q).toEqual({ x: 0, y: 0, z: 0, w: -1 });
  });
});

// ─── toEntityIndex() ───────────────────────────────────────────────────────

describe('toEntityIndex', () => {
  it('converts number entity id directly', () => {
    expect(toEntityIndex(42)).toBe(42);
  });

  it('converts zero number correctly', () => {
    expect(toEntityIndex(0)).toBe(0);
  });

  it('converts large number within u32 range', () => {
    expect(toEntityIndex(0xffffffff)).toBe(0xffffffff);
  });

  it('converts bigint by masking to u32', () => {
    expect(toEntityIndex(42n)).toBe(42);
  });

  it('masks bigint larger than u32', () => {
    const bigValue = 0x100000042n;
    expect(toEntityIndex(bigValue)).toBe(0x42);
  });

  it('converts string entity id by parsing as base-10', () => {
    expect(toEntityIndex('123')).toBe(123);
  });

  it('converts string zero', () => {
    expect(toEntityIndex('0')).toBe(0);
  });

  it('converts large string number', () => {
    expect(toEntityIndex('999999')).toBe(999999);
  });
});

// ─── kindFromU8() ──────────────────────────────────────────────────────────

describe('kindFromU8', () => {
  it('converts 0 to "fixed"', () => {
    expect(kindFromU8(0)).toBe('fixed');
  });

  it('converts 1 to "dynamic"', () => {
    expect(kindFromU8(1)).toBe('dynamic');
  });

  it('converts 2 to "kinematic"', () => {
    expect(kindFromU8(2)).toBe('kinematic');
  });

  it('defaults unknown value to "dynamic"', () => {
    expect(kindFromU8(99)).toBe('dynamic');
  });

  it('defaults negative value to "dynamic"', () => {
    expect(kindFromU8(-1)).toBe('dynamic');
  });

  it('defaults high value to "dynamic"', () => {
    expect(kindFromU8(255)).toBe('dynamic');
  });
});

// ─── kindToU8() ───────────────────────────────────────────────────────────

describe('kindToU8', () => {
  it('converts "fixed" to 0', () => {
    expect(kindToU8('fixed')).toBe(0);
  });

  it('converts "dynamic" to 1', () => {
    expect(kindToU8('dynamic')).toBe(1);
  });

  it('converts "kinematic" to 2', () => {
    expect(kindToU8('kinematic')).toBe(2);
  });
});

// ─── parseBodyState() ──────────────────────────────────────────────────────

describe('parseBodyState', () => {
  it('parses a complete 13-element Float32Array', () => {
    const arr = new Float32Array([1, 2, 3, 0.1, 0.2, 0.3, 0.9, 4, 5, 6, 0.01, 0.02, 0.03]);
    const state = parseBodyState(arr);

    expect(state.position).toEqual({ x: 1, y: 2, z: 3 });
    expect(state.rotation.x).toBeCloseTo(0.1, 5);
    expect(state.rotation.y).toBeCloseTo(0.2, 5);
    expect(state.rotation.z).toBeCloseTo(0.3, 5);
    expect(state.rotation.w).toBeCloseTo(0.9, 5);
    expect(state.linearVelocity).toEqual({ x: 4, y: 5, z: 6 });
    expect(state.angularVelocity.x).toBeCloseTo(0.01, 5);
    expect(state.angularVelocity.y).toBeCloseTo(0.02, 5);
    expect(state.angularVelocity.z).toBeCloseTo(0.03, 5);
  });

  it('uses defaults for missing array elements only when undefined/null', () => {
    // Float32Array initializes with 0, not undefined, so the default for w doesn't apply
    const arr = new Float32Array(13);
    const state = parseBodyState(arr);

    expect(state.position).toEqual({ x: 0, y: 0, z: 0 });
    expect(state.rotation.x).toBeCloseTo(0, 5);
    expect(state.rotation.y).toBeCloseTo(0, 5);
    expect(state.rotation.z).toBeCloseTo(0, 5);
    expect(state.rotation.w).toBeCloseTo(0, 5); // w is 0 in the Float32Array
    expect(state.linearVelocity).toEqual({ x: 0, y: 0, z: 0 });
    expect(state.angularVelocity).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('parses identity rotation correctly', () => {
    const arr = new Float32Array(13);
    arr[6] = 1; // w
    const state = parseBodyState(arr);
    expect(state.rotation).toEqual({ x: 0, y: 0, z: 0, w: 1 });
  });

  it('parses non-zero velocity correctly', () => {
    const arr = new Float32Array(13);
    arr[7] = 10;
    arr[8] = -5;
    arr[9] = 2.5;
    const state = parseBodyState(arr);
    expect(state.linearVelocity).toEqual({ x: 10, y: -5, z: 2.5 });
  });

  it('parses negative values correctly', () => {
    const arr = new Float32Array([
      -1, -2, -3, -0.1, -0.2, -0.3, 0.9, -4, -5, -6, -0.01, -0.02, -0.03,
    ]);
    const state = parseBodyState(arr);

    expect(state.position).toEqual({ x: -1, y: -2, z: -3 });
    expect(state.linearVelocity).toEqual({ x: -4, y: -5, z: -6 });
    expect(state.angularVelocity.x).toBeCloseTo(-0.01, 5);
    expect(state.angularVelocity.y).toBeCloseTo(-0.02, 5);
    expect(state.angularVelocity.z).toBeCloseTo(-0.03, 5);
  });
});

// ─── cloneState() ──────────────────────────────────────────────────────────

describe('cloneState', () => {
  it('creates a deep copy of the state', () => {
    const original: Physics3DBodyState = {
      position: { x: 1, y: 2, z: 3 },
      rotation: { x: 0.1, y: 0.2, z: 0.3, w: 0.9 },
      linearVelocity: { x: 4, y: 5, z: 6 },
      angularVelocity: { x: 0.01, y: 0.02, z: 0.03 },
    };

    const clone = cloneState(original);

    expect(clone).toEqual(original);
  });

  it('clone is not aliased to original', () => {
    const original: Physics3DBodyState = {
      position: { x: 1, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      linearVelocity: { x: 0, y: 0, z: 0 },
      angularVelocity: { x: 0, y: 0, z: 0 },
    };

    const clone = cloneState(original);

    // Modify clone
    clone.position.x = 99;
    clone.rotation.w = 0;
    clone.linearVelocity.y = 50;
    clone.angularVelocity.z = 100;

    // Original should be unchanged
    expect(original.position.x).toBe(1);
    expect(original.rotation.w).toBe(1);
    expect(original.linearVelocity.y).toBe(0);
    expect(original.angularVelocity.z).toBe(0);
  });

  it('clones zero state', () => {
    const original: Physics3DBodyState = {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      linearVelocity: { x: 0, y: 0, z: 0 },
      angularVelocity: { x: 0, y: 0, z: 0 },
    };

    const clone = cloneState(original);
    expect(clone).toEqual(original);
    expect(clone).not.toBe(original);
  });
});

// ─── resolveColliderMaterial() ────────────────────────────────────────────

describe('resolveColliderMaterial', () => {
  it('uses default preset when no materialPreset is specified', () => {
    const options: Physics3DColliderOptions = {
      shape: { type: 'box', halfX: 1, halfY: 1, halfZ: 1 },
    };
    const resolved = resolveColliderMaterial(options);

    // default preset: { friction: 0.5, restitution: 0.0, density: 1.0 }
    expect(resolved).toEqual({ friction: 0.5, restitution: 0.0, density: 1.0 });
  });

  it('uses ice preset when specified', () => {
    const options: Physics3DColliderOptions = {
      shape: { type: 'box', halfX: 1, halfY: 1, halfZ: 1 },
      materialPreset: 'ice',
    };
    const resolved = resolveColliderMaterial(options);

    // ice preset: { friction: 0.02, restitution: 0.0, density: 0.9 }
    expect(resolved).toEqual({ friction: 0.02, restitution: 0.0, density: 0.9 });
  });

  it('uses rubber preset when specified', () => {
    const options: Physics3DColliderOptions = {
      shape: { type: 'box', halfX: 1, halfY: 1, halfZ: 1 },
      materialPreset: 'rubber',
    };
    const resolved = resolveColliderMaterial(options);

    // rubber preset: { friction: 1.2, restitution: 0.6, density: 1.2 }
    expect(resolved).toEqual({ friction: 1.2, restitution: 0.6, density: 1.2 });
  });

  it('uses metal preset when specified', () => {
    const options: Physics3DColliderOptions = {
      shape: { type: 'box', halfX: 1, halfY: 1, halfZ: 1 },
      materialPreset: 'metal',
    };
    const resolved = resolveColliderMaterial(options);

    // metal preset: { friction: 0.3, restitution: 0.05, density: 7.8 }
    expect(resolved).toEqual({ friction: 0.3, restitution: 0.05, density: 7.8 });
  });

  it('explicit friction overrides preset', () => {
    const options: Physics3DColliderOptions = {
      shape: { type: 'box', halfX: 1, halfY: 1, halfZ: 1 },
      materialPreset: 'ice',
      friction: 0.8,
    };
    const resolved = resolveColliderMaterial(options);

    expect(resolved.friction).toBe(0.8);
    expect(resolved.restitution).toBe(0.0); // from ice preset
    expect(resolved.density).toBe(0.9); // from ice preset
  });

  it('explicit restitution overrides preset', () => {
    const options: Physics3DColliderOptions = {
      shape: { type: 'box', halfX: 1, halfY: 1, halfZ: 1 },
      materialPreset: 'rubber',
      restitution: 0.1,
    };
    const resolved = resolveColliderMaterial(options);

    expect(resolved.friction).toBe(1.2); // from rubber preset
    expect(resolved.restitution).toBe(0.1);
    expect(resolved.density).toBe(1.2); // from rubber preset
  });

  it('explicit density overrides preset', () => {
    const options: Physics3DColliderOptions = {
      shape: { type: 'box', halfX: 1, halfY: 1, halfZ: 1 },
      materialPreset: 'default',
      density: 5.0,
    };
    const resolved = resolveColliderMaterial(options);

    expect(resolved.friction).toBe(0.5); // from default preset
    expect(resolved.restitution).toBe(0.0); // from default preset
    expect(resolved.density).toBe(5.0);
  });

  it('all explicit values override preset', () => {
    const options: Physics3DColliderOptions = {
      shape: { type: 'box', halfX: 1, halfY: 1, halfZ: 1 },
      materialPreset: 'metal',
      friction: 0.7,
      restitution: 0.4,
      density: 2.2,
    };
    const resolved = resolveColliderMaterial(options);

    expect(resolved).toEqual({ friction: 0.7, restitution: 0.4, density: 2.2 });
  });
});

// ─── computeColliderAABB() ────────────────────────────────────────────────

describe('computeColliderAABB', () => {
  it('computes AABB for a box collider at origin', () => {
    const pos: Physics3DVec3 = { x: 0, y: 0, z: 0 };
    const col: Physics3DColliderOptions = {
      shape: { type: 'box', halfX: 1, halfY: 2, halfZ: 3 },
    };
    const aabb = computeColliderAABB(pos, col);

    expect(aabb).toEqual({
      minX: -1,
      maxX: 1,
      minY: -2,
      maxY: 2,
      minZ: -3,
      maxZ: 3,
    });
  });

  it('computes AABB for a box collider with offset position', () => {
    const pos: Physics3DVec3 = { x: 5, y: 10, z: -3 };
    const col: Physics3DColliderOptions = {
      shape: { type: 'box', halfX: 1, halfY: 1, halfZ: 1 },
    };
    const aabb = computeColliderAABB(pos, col);

    expect(aabb).toEqual({
      minX: 4,
      maxX: 6,
      minY: 9,
      maxY: 11,
      minZ: -4,
      maxZ: -2,
    });
  });

  it('computes AABB for a box collider with collider offset', () => {
    const pos: Physics3DVec3 = { x: 0, y: 0, z: 0 };
    const col: Physics3DColliderOptions = {
      shape: { type: 'box', halfX: 1, halfY: 1, halfZ: 1 },
      offsetX: 2,
      offsetY: 3,
      offsetZ: -1,
    };
    const aabb = computeColliderAABB(pos, col);

    expect(aabb).toEqual({
      minX: 1,
      maxX: 3,
      minY: 2,
      maxY: 4,
      minZ: -2,
      maxZ: 0,
    });
  });

  it('computes AABB for a sphere collider at origin', () => {
    const pos: Physics3DVec3 = { x: 0, y: 0, z: 0 };
    const col: Physics3DColliderOptions = {
      shape: { type: 'sphere', radius: 2 },
    };
    const aabb = computeColliderAABB(pos, col);

    expect(aabb).toEqual({
      minX: -2,
      maxX: 2,
      minY: -2,
      maxY: 2,
      minZ: -2,
      maxZ: 2,
    });
  });

  it('computes AABB for a sphere collider with position offset', () => {
    const pos: Physics3DVec3 = { x: 10, y: 5, z: -8 };
    const col: Physics3DColliderOptions = {
      shape: { type: 'sphere', radius: 3 },
    };
    const aabb = computeColliderAABB(pos, col);

    expect(aabb).toEqual({
      minX: 7,
      maxX: 13,
      minY: 2,
      maxY: 8,
      minZ: -11,
      maxZ: -5,
    });
  });

  it('computes AABB for a capsule collider (radius + halfHeight in Y)', () => {
    const pos: Physics3DVec3 = { x: 0, y: 0, z: 0 };
    const col: Physics3DColliderOptions = {
      shape: { type: 'capsule', radius: 1, halfHeight: 3 },
    };
    const aabb = computeColliderAABB(pos, col);

    expect(aabb).toEqual({
      minX: -1,
      maxX: 1,
      minY: -4, // radius + halfHeight
      maxY: 4,
      minZ: -1,
      maxZ: 1,
    });
  });

  it('computes AABB for a capsule with position offset', () => {
    const pos: Physics3DVec3 = { x: 5, y: 5, z: 5 };
    const col: Physics3DColliderOptions = {
      shape: { type: 'capsule', radius: 2, halfHeight: 1 },
    };
    const aabb = computeColliderAABB(pos, col);

    expect(aabb).toEqual({
      minX: 3,
      maxX: 7,
      minY: 2, // 5 - (2 + 1)
      maxY: 8, // 5 + (2 + 1)
      minZ: 3,
      maxZ: 7,
    });
  });

  it('computes tight AABB from mesh vertices (replaces old unit-AABB placeholder)', () => {
    const pos: Physics3DVec3 = { x: 0, y: 0, z: 0 };
    const col: Physics3DColliderOptions = {
      shape: {
        type: 'mesh',
        // A single degenerate vertex — AABB collapses to zero size at origin
        vertices: new Float32Array([0, 0, 0]),
        indices: new Uint32Array([0]),
      },
    };
    const aabb = computeColliderAABB(pos, col);

    // Single vertex at (0,0,0): zero-size AABB at origin is correct
    expect(aabb).toEqual({
      minX: 0,
      maxX: 0,
      minY: 0,
      maxY: 0,
      minZ: 0,
      maxZ: 0,
    });
  });

  it('computes tight AABB from convex vertices (replaces old unit-AABB placeholder)', () => {
    const pos: Physics3DVec3 = { x: 10, y: 20, z: 30 };
    const col: Physics3DColliderOptions = {
      // Single degenerate vertex in local space — AABB collapses to zero at body position
      shape: { type: 'convex', vertices: new Float32Array([0, 0, 0]) },
    };
    const aabb = computeColliderAABB(pos, col);

    // Vertex at local (0,0,0), body at (10,20,30): AABB is zero-size at body position
    expect(aabb).toEqual({
      minX: 10,
      maxX: 10,
      minY: 20,
      maxY: 20,
      minZ: 30,
      maxZ: 30,
    });
  });
});

// ─── aabbOverlap() ────────────────────────────────────────────────────────

describe('aabbOverlap', () => {
  it('returns true for identical AABBs', () => {
    const aabb = { minX: 0, maxX: 1, minY: 0, maxY: 1, minZ: 0, maxZ: 1 };
    expect(aabbOverlap(aabb, aabb)).toBe(true);
  });

  it('returns true for overlapping AABBs on all axes', () => {
    const a = { minX: 0, maxX: 2, minY: 0, maxY: 2, minZ: 0, maxZ: 2 };
    const b = { minX: 1, maxX: 3, minY: 1, maxY: 3, minZ: 1, maxZ: 3 };
    expect(aabbOverlap(a, b)).toBe(true);
  });

  it('returns true for touching AABBs on all axes (inclusive)', () => {
    const a = { minX: 0, maxX: 1, minY: 0, maxY: 1, minZ: 0, maxZ: 1 };
    const b = { minX: 1, maxX: 2, minY: 0, maxY: 1, minZ: 0, maxZ: 1 };
    expect(aabbOverlap(a, b)).toBe(true);
  });

  it('returns true for one AABB inside another', () => {
    const outer = { minX: 0, maxX: 10, minY: 0, maxY: 10, minZ: 0, maxZ: 10 };
    const inner = { minX: 2, maxX: 5, minY: 3, maxY: 6, minZ: 1, maxZ: 8 };
    expect(aabbOverlap(outer, inner)).toBe(true);
  });

  it('returns false for non-overlapping AABBs (X axis separation)', () => {
    const a = { minX: 0, maxX: 1, minY: 0, maxY: 2, minZ: 0, maxZ: 2 };
    const b = { minX: 2, maxX: 3, minY: 0, maxY: 2, minZ: 0, maxZ: 2 };
    expect(aabbOverlap(a, b)).toBe(false);
  });

  it('returns false for non-overlapping AABBs (Y axis separation)', () => {
    const a = { minX: 0, maxX: 2, minY: 0, maxY: 1, minZ: 0, maxZ: 2 };
    const b = { minX: 0, maxX: 2, minY: 2, maxY: 3, minZ: 0, maxZ: 2 };
    expect(aabbOverlap(a, b)).toBe(false);
  });

  it('returns false for non-overlapping AABBs (Z axis separation)', () => {
    const a = { minX: 0, maxX: 2, minY: 0, maxY: 2, minZ: 0, maxZ: 1 };
    const b = { minX: 0, maxX: 2, minY: 0, maxY: 2, minZ: 2, maxZ: 3 };
    expect(aabbOverlap(a, b)).toBe(false);
  });

  it('returns false when separated on multiple axes', () => {
    const a = { minX: 0, maxX: 1, minY: 0, maxY: 1, minZ: 0, maxZ: 1 };
    const b = { minX: 5, maxX: 6, minY: 5, maxY: 6, minZ: 5, maxZ: 6 };
    expect(aabbOverlap(a, b)).toBe(false);
  });

  it('returns false when touching on only one axis but separated on another', () => {
    const a = { minX: 0, maxX: 1, minY: 0, maxY: 1, minZ: 0, maxZ: 1 };
    const b = { minX: 1, maxX: 2, minY: 2, maxY: 3, minZ: 0, maxZ: 1 };
    expect(aabbOverlap(a, b)).toBe(false);
  });

  it('returns true for partially overlapping AABBs', () => {
    const a = { minX: -1, maxX: 1, minY: -1, maxY: 1, minZ: -1, maxZ: 1 };
    const b = { minX: 0.5, maxX: 2, minY: 0.5, maxY: 2, minZ: 0.5, maxZ: 2 };
    expect(aabbOverlap(a, b)).toBe(true);
  });

  it('handles negative coordinates', () => {
    const a = { minX: -5, maxX: -2, minY: -5, maxY: -2, minZ: -5, maxZ: -2 };
    const b = { minX: -4, maxX: -1, minY: -4, maxY: -1, minZ: -4, maxZ: -1 };
    expect(aabbOverlap(a, b)).toBe(true);
  });

  it('handles large coordinates', () => {
    const a = { minX: 1000, maxX: 1010, minY: 1000, maxY: 1010, minZ: 1000, maxZ: 1010 };
    const b = { minX: 1005, maxX: 1015, minY: 1005, maxY: 1015, minZ: 1005, maxZ: 1015 };
    expect(aabbOverlap(a, b)).toBe(true);
  });
});
