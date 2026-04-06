import { describe, it, expect } from 'vitest';
import {
  makeSpring1D,
  makeSpring2D,
  makeSpring3D,
  stepSpring1D,
  spring1D,
  stepSpring2D,
  spring2D,
  stepSpring3D,
  spring3D,
  criticalOpts,
  bouncyOpts,
  sluggishOpts,
} from '../src/spring.js';

const dt = 1 / 60;

describe('makeSpring1D', () => {
  it('creates state with given value', () => {
    const s = makeSpring1D(5);
    expect(s.value).toBe(5);
    expect(s.velocity).toBe(0);
  });
  it('accepts initial velocity', () => {
    const s = makeSpring1D(0, 10);
    expect(s.velocity).toBe(10);
  });
});

describe('stepSpring1D', () => {
  it('mutates state in-place', () => {
    const s = makeSpring1D(0);
    const ref = s;
    stepSpring1D(s, 100, criticalOpts(200), dt);
    expect(s).toBe(ref); // same object
    expect(s.value).toBeGreaterThan(0);
  });
  it('converges to target over many steps', () => {
    const s = makeSpring1D(0);
    const opts = criticalOpts(300);
    for (let i = 0; i < 500; i++) stepSpring1D(s, 100, opts, dt);
    expect(s.value).toBeCloseTo(100, 1);
    expect(s.velocity).toBeCloseTo(0, 1);
  });
  it('can overshoot with underdamped spring', () => {
    const s = makeSpring1D(0);
    const opts = bouncyOpts(300, 0.2);
    let maxValue = 0;
    for (let i = 0; i < 200; i++) {
      stepSpring1D(s, 100, opts, dt);
      if (s.value > maxValue) maxValue = s.value;
    }
    expect(maxValue).toBeGreaterThan(100); // overshoot
  });
});

describe('spring1D (functional)', () => {
  it('does not mutate input state', () => {
    const s = makeSpring1D(0);
    spring1D(s, 100, criticalOpts(200), dt);
    expect(s.value).toBe(0);
    expect(s.velocity).toBe(0);
  });
  it('returns new state object', () => {
    const s = makeSpring1D(0);
    const s2 = spring1D(s, 100, criticalOpts(200), dt);
    expect(s2).not.toBe(s);
    expect(s2.value).toBeGreaterThan(0);
  });
});

describe('stepSpring2D', () => {
  it('moves each axis towards target', () => {
    const s = makeSpring2D(0, 0);
    stepSpring2D(s, { x: 10, y: -5 }, criticalOpts(200), dt);
    expect(s.x).toBeGreaterThan(0);
    expect(s.y).toBeLessThan(0);
  });
  it('converges over many steps', () => {
    const s = makeSpring2D(0, 0);
    const opts = criticalOpts(300);
    for (let i = 0; i < 500; i++) stepSpring2D(s, { x: 10, y: 20 }, opts, dt);
    expect(s.x).toBeCloseTo(10, 1);
    expect(s.y).toBeCloseTo(20, 1);
  });
});

describe('spring2D (functional)', () => {
  it('does not mutate state', () => {
    const s = makeSpring2D(0, 0);
    spring2D(s, { x: 10, y: 10 }, criticalOpts(200), dt);
    expect(s.x).toBe(0);
    expect(s.y).toBe(0);
  });
});

describe('stepSpring3D', () => {
  it('moves each axis towards target', () => {
    const s = makeSpring3D(0, 0, 0);
    stepSpring3D(s, { x: 1, y: 2, z: 3 }, criticalOpts(200), dt);
    expect(s.x).toBeGreaterThan(0);
    expect(s.y).toBeGreaterThan(0);
    expect(s.z).toBeGreaterThan(0);
  });
  it('converges over many steps', () => {
    const s = makeSpring3D(0, 0, 0);
    const opts = criticalOpts(300);
    const target = { x: 5, y: -3, z: 10 };
    for (let i = 0; i < 500; i++) stepSpring3D(s, target, opts, dt);
    expect(s.x).toBeCloseTo(target.x, 1);
    expect(s.y).toBeCloseTo(target.y, 1);
    expect(s.z).toBeCloseTo(target.z, 1);
  });
});

describe('spring3D (functional)', () => {
  it('does not mutate state', () => {
    const s = makeSpring3D(1, 2, 3);
    spring3D(s, { x: 0, y: 0, z: 0 }, criticalOpts(200), dt);
    expect(s.x).toBe(1);
    expect(s.y).toBe(2);
    expect(s.z).toBe(3);
  });
});

describe('spring presets', () => {
  it('criticalOpts — damping = 2*sqrt(stiffness)', () => {
    const opts = criticalOpts(100);
    expect(opts.damping).toBeCloseTo(2 * Math.sqrt(100));
  });
  it('bouncyOpts — damping < critical', () => {
    const opts = bouncyOpts(100);
    expect(opts.damping).toBeLessThan(2 * Math.sqrt(100));
  });
  it('sluggishOpts — damping > critical', () => {
    const opts = sluggishOpts(100);
    expect(opts.damping).toBeGreaterThan(2 * Math.sqrt(100));
  });
});
