import { describe, it, expect } from 'vitest';
import { damp, dampAngle, dampVec2, dampVec2Mut, dampVec3, dampVec3Mut } from '../src/damp.js';

const dt = 1 / 60; // one 60fps frame

describe('damp', () => {
  it('moves towards target', () => {
    const result = damp(0, 100, 10, dt);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(100);
  });
  it('converges to target with large lambda*dt', () => {
    const result = damp(0, 100, 1000, 1); // effectively full decay
    expect(result).toBeCloseTo(100, 2);
  });
  it('returns current when lambda=0', () => {
    expect(damp(42, 100, 0, dt)).toBeCloseTo(42);
  });
  it('is frame-rate independent in the limit', () => {
    // Run two steps of dt vs one step of 2*dt — should be close
    const step2x = damp(0, 100, 5, dt * 2);
    let step1x = damp(0, 100, 5, dt);
    step1x = damp(step1x, 100, 5, dt);
    expect(step2x).toBeCloseTo(step1x, 4);
  });
});

describe('dampAngle', () => {
  it('moves towards target angle', () => {
    const result = dampAngle(0, Math.PI / 2, 10, dt);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(Math.PI / 2);
  });
  it('takes shortest arc over π boundary', () => {
    // from π-0.1 to -(π-0.1): shortest arc should go backwards (+0.2 wrap)
    const from = Math.PI - 0.1;
    const to = -(Math.PI - 0.1);
    const result = dampAngle(from, to, 5, dt);
    // Should have moved slightly in the + direction (wraparound)
    expect(result).toBeGreaterThan(from);
  });
});

describe('dampVec2', () => {
  it('moves each component towards target', () => {
    const result = dampVec2({ x: 0, y: 0 }, { x: 100, y: -50 }, 10, dt);
    expect(result.x).toBeGreaterThan(0);
    expect(result.y).toBeLessThan(0);
  });
  it('does not mutate input', () => {
    const current = { x: 0, y: 0 };
    dampVec2(current, { x: 10, y: 10 }, 10, dt);
    expect(current.x).toBe(0);
  });
  it('returns a new object', () => {
    const current = { x: 0, y: 0 };
    const result = dampVec2(current, { x: 10, y: 10 }, 10, dt);
    expect(result).not.toBe(current);
  });
});

describe('dampVec2Mut', () => {
  it('mutates the input object', () => {
    const current = { x: 0, y: 0 };
    const result = dampVec2Mut(current, { x: 100, y: 100 }, 10, dt);
    expect(result).toBe(current);
    expect(current.x).toBeGreaterThan(0);
  });
});

describe('dampVec3', () => {
  it('moves each component towards target', () => {
    const result = dampVec3({ x: 0, y: 0, z: 0 }, { x: 1, y: 2, z: 3 }, 10, dt);
    expect(result.x).toBeGreaterThan(0);
    expect(result.y).toBeGreaterThan(0);
    expect(result.z).toBeGreaterThan(0);
  });
  it('does not mutate input', () => {
    const current = { x: 1, y: 2, z: 3 };
    dampVec3(current, { x: 10, y: 10, z: 10 }, 10, dt);
    expect(current.x).toBe(1);
    expect(current.y).toBe(2);
    expect(current.z).toBe(3);
  });
});

describe('dampVec3Mut', () => {
  it('mutates the input object', () => {
    const current = { x: 0, y: 0, z: 0 };
    const result = dampVec3Mut(current, { x: 1, y: 1, z: 1 }, 10, dt);
    expect(result).toBe(current);
    expect(current.x).toBeGreaterThan(0);
  });
});
