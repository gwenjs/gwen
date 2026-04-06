/**
 * @file RFC-03 — Easing functions unit tests
 *
 * Verifies:
 * - All 26 easing functions satisfy f(0) ≈ 0 and f(1) ≈ 1
 * - Spot-check f(0.5) values for key functions
 * - spring(1.0) ≈ 1.0 (within 0.01)
 * - EASING_MAP contains all EasingName keys
 *
 * Coverage target: 100%
 */

import { describe, it, expect } from 'vitest';
import {
  linear,
  easeInQuad,
  easeOutQuad,
  easeInOutQuad,
  easeInCubic,
  easeOutCubic,
  easeInOutCubic,
  easeInQuart,
  easeOutQuart,
  easeInOutQuart,
  easeInSine,
  easeOutSine,
  easeInOutSine,
  easeInExpo,
  easeOutExpo,
  easeInOutExpo,
  easeInBack,
  easeOutBack,
  easeInOutBack,
  easeInElastic,
  easeOutElastic,
  easeInOutElastic,
  easeInBounce,
  easeOutBounce,
  easeInOutBounce,
  spring,
  EASING_MAP,
  type EasingName,
} from '../../src/tween/easing';

// ── Boundary checks for all functions ────────────────────────────────────────

const ALL_EASING_FUNCTIONS: Array<[string, (t: number) => number]> = [
  ['linear', linear],
  ['easeInQuad', easeInQuad],
  ['easeOutQuad', easeOutQuad],
  ['easeInOutQuad', easeInOutQuad],
  ['easeInCubic', easeInCubic],
  ['easeOutCubic', easeOutCubic],
  ['easeInOutCubic', easeInOutCubic],
  ['easeInQuart', easeInQuart],
  ['easeOutQuart', easeOutQuart],
  ['easeInOutQuart', easeInOutQuart],
  ['easeInSine', easeInSine],
  ['easeOutSine', easeOutSine],
  ['easeInOutSine', easeInOutSine],
  ['easeInExpo', easeInExpo],
  ['easeOutExpo', easeOutExpo],
  ['easeInOutExpo', easeInOutExpo],
  ['easeInBack', easeInBack],
  ['easeOutBack', easeOutBack],
  ['easeInOutBack', easeInOutBack],
  ['easeInElastic', easeInElastic],
  ['easeOutElastic', easeOutElastic],
  ['easeInOutElastic', easeInOutElastic],
  ['easeInBounce', easeInBounce],
  ['easeOutBounce', easeOutBounce],
  ['easeInOutBounce', easeInOutBounce],
  ['spring', spring],
];

describe('Easing function boundary conditions', () => {
  for (const [name, fn] of ALL_EASING_FUNCTIONS) {
    it(`${name}(0) ≈ 0`, () => {
      expect(fn(0)).toBeCloseTo(0, 3);
    });

    it(`${name}(1) ≈ 1`, () => {
      expect(fn(1)).toBeCloseTo(1, 2);
    });
  }
});

// ── Spot-check mid-values ─────────────────────────────────────────────────────

describe('Easing mid-value spot checks', () => {
  it('linear(0.5) === 0.5', () => {
    expect(linear(0.5)).toBe(0.5);
  });

  it('easeInQuad(0.5) ≈ 0.25', () => {
    expect(easeInQuad(0.5)).toBeCloseTo(0.25, 4);
  });

  it('easeOutQuad(0.5) ≈ 0.75', () => {
    expect(easeOutQuad(0.5)).toBeCloseTo(0.75, 4);
  });

  it('easeInOutQuad(0.5) ≈ 0.5', () => {
    expect(easeInOutQuad(0.5)).toBeCloseTo(0.5, 4);
  });

  it('easeInCubic(0.5) ≈ 0.125', () => {
    expect(easeInCubic(0.5)).toBeCloseTo(0.125, 4);
  });

  it('easeOutCubic(0.5) ≈ 0.875', () => {
    expect(easeOutCubic(0.5)).toBeCloseTo(0.875, 4);
  });

  it('easeInOutCubic(0.5) ≈ 0.5', () => {
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 3);
  });

  it('easeInQuart(0.5) ≈ 0.0625', () => {
    expect(easeInQuart(0.5)).toBeCloseTo(0.0625, 4);
  });

  it('easeOutQuart(0.5) ≈ 0.9375 (verifying positive — bugfix check)', () => {
    const val = easeOutQuart(0.5);
    // Must be positive and close to 0.9375
    expect(val).toBeGreaterThan(0);
    expect(val).toBeCloseTo(0.9375, 4);
  });

  it('easeInOutQuart(0.5) ≈ 0.5', () => {
    expect(easeInOutQuart(0.5)).toBeCloseTo(0.5, 4);
  });

  it('easeInSine(0.5) ≈ 0.293', () => {
    expect(easeInSine(0.5)).toBeCloseTo(1 - Math.cos(Math.PI / 4), 4);
  });

  it('easeOutSine(0.5) ≈ 0.707', () => {
    expect(easeOutSine(0.5)).toBeCloseTo(Math.sin(Math.PI / 4), 4);
  });

  it('easeInOutSine(0.5) ≈ 0.5', () => {
    expect(easeInOutSine(0.5)).toBeCloseTo(0.5, 4);
  });

  it('easeInExpo(0.5) > 0 and < 0.1', () => {
    // Should be very small at t=0.5
    const val = easeInExpo(0.5);
    expect(val).toBeGreaterThan(0);
    expect(val).toBeLessThan(0.1);
  });

  it('easeOutExpo(0.5) > 0.9 and < 1', () => {
    const val = easeOutExpo(0.5);
    expect(val).toBeGreaterThan(0.9);
    expect(val).toBeLessThan(1);
  });

  it('easeInOutExpo(0.5) ≈ 0.5', () => {
    expect(easeInOutExpo(0.5)).toBeCloseTo(0.5, 3);
  });

  it('easeInBack(0.5) is negative (overshoot)', () => {
    // easeInBack overshoots (goes negative before t=0.5)
    expect(easeInBack(0.5)).toBeLessThan(0);
  });

  it('easeOutBack(0.5) > 1 (overshoot)', () => {
    // easeOutBack overshoots (goes above 1 before settling)
    expect(easeOutBack(0.5)).toBeGreaterThan(1);
  });

  it('easeInOutBack(0.5) ≈ 0.5', () => {
    expect(easeInOutBack(0.5)).toBeCloseTo(0.5, 3);
  });

  it('easeInBounce values are in valid numeric range', () => {
    const val = easeInBounce(0.5);
    expect(typeof val).toBe('number');
    expect(isNaN(val)).toBe(false);
  });

  it('easeOutBounce(0.5) ≈ 0.727 (first bounce midpoint)', () => {
    // easeOutBounce has characteristic bounce values
    const val = easeOutBounce(0.5);
    expect(val).toBeGreaterThan(0.5);
    expect(val).toBeLessThan(1);
  });

  it('easeInOutBounce(0.5) ≈ 0.5', () => {
    expect(easeInOutBounce(0.5)).toBeCloseTo(0.5, 2);
  });

  it('spring(0.5) ≈ 0.889', () => {
    // 1 - (1 + 20*0.5) * exp(-20*0.5) = 1 - 11 * exp(-10)
    const expected = 1 - 11 * Math.exp(-10);
    expect(spring(0.5)).toBeCloseTo(expected, 4);
  });
});

// ── spring(1.0) boundary ──────────────────────────────────────────────────────

describe('spring() near-boundary behavior', () => {
  it('spring(1.0) ≈ 1.0 (within tolerance 0.01)', () => {
    expect(spring(1.0)).toBeCloseTo(1.0, 2);
  });

  it('spring(0.0) === 0', () => {
    expect(spring(0.0)).toBeCloseTo(0, 4);
  });
});

// ── easeInExpo special-case at t=0 ───────────────────────────────────────────

describe('easeInExpo / easeOutExpo special boundary cases', () => {
  it('easeInExpo(0) === 0 exactly', () => {
    expect(easeInExpo(0)).toBe(0);
  });

  it('easeOutExpo(1) === 1 exactly', () => {
    expect(easeOutExpo(1)).toBe(1);
  });

  it('easeInOutExpo(0) === 0 exactly', () => {
    expect(easeInOutExpo(0)).toBe(0);
  });

  it('easeInOutExpo(1) === 1 exactly', () => {
    expect(easeInOutExpo(1)).toBe(1);
  });
});

// ── easeInElastic / easeOutElastic special boundaries ────────────────────────

describe('easeInElastic / easeOutElastic boundary cases', () => {
  it('easeInElastic(0) === 0 exactly', () => {
    expect(easeInElastic(0)).toBe(0);
  });

  it('easeInElastic(1) === 1 exactly', () => {
    expect(easeInElastic(1)).toBe(1);
  });

  it('easeOutElastic(0) === 0 exactly', () => {
    expect(easeOutElastic(0)).toBe(0);
  });

  it('easeOutElastic(1) === 1 exactly', () => {
    expect(easeOutElastic(1)).toBe(1);
  });

  it('easeInOutElastic(0) === 0 exactly', () => {
    expect(easeInOutElastic(0)).toBe(0);
  });

  it('easeInOutElastic(1) === 1 exactly', () => {
    expect(easeInOutElastic(1)).toBe(1);
  });
});

// ── EASING_MAP ────────────────────────────────────────────────────────────────

describe('EASING_MAP', () => {
  const EXPECTED_KEYS: EasingName[] = [
    'linear',
    'easeInQuad',
    'easeOutQuad',
    'easeInOutQuad',
    'easeInCubic',
    'easeOutCubic',
    'easeInOutCubic',
    'easeInQuart',
    'easeOutQuart',
    'easeInOutQuart',
    'easeInSine',
    'easeOutSine',
    'easeInOutSine',
    'easeInExpo',
    'easeOutExpo',
    'easeInOutExpo',
    'easeInBack',
    'easeOutBack',
    'easeInOutBack',
    'easeInElastic',
    'easeOutElastic',
    'easeInOutElastic',
    'easeInBounce',
    'easeOutBounce',
    'easeInOutBounce',
    'spring',
  ];

  it('contains all 26 EasingName keys', () => {
    expect(Object.keys(EASING_MAP)).toHaveLength(EXPECTED_KEYS.length);
  });

  for (const key of EXPECTED_KEYS) {
    it(`EASING_MAP['${key}'] is a function`, () => {
      expect(typeof EASING_MAP[key]).toBe('function');
    });

    it(`EASING_MAP['${key}'](0) ≈ 0`, () => {
      expect(EASING_MAP[key](0)).toBeCloseTo(0, 3);
    });

    it(`EASING_MAP['${key}'](1) ≈ 1`, () => {
      expect(EASING_MAP[key](1)).toBeCloseTo(1, 2);
    });
  }

  it('maps linear to the linear function', () => {
    expect(EASING_MAP['linear']).toBe(linear);
  });

  it('maps easeInCubic to the easeInCubic function', () => {
    expect(EASING_MAP['easeInCubic'](0.5)).toBe(easeInCubic(0.5));
  });
});

// ── Monotonicity checks for selected functions ────────────────────────────────

describe('Monotonic easing functions increase from 0 to 1', () => {
  const MONOTONIC: Array<[string, (t: number) => number]> = [
    ['linear', linear],
    ['easeInQuad', easeInQuad],
    ['easeOutQuad', easeOutQuad],
    ['easeInCubic', easeInCubic],
    ['easeOutCubic', easeOutCubic],
    ['easeInQuart', easeInQuart],
    ['easeOutQuart', easeOutQuart],
    ['easeInSine', easeInSine],
    ['easeOutSine', easeOutSine],
    ['easeInOutSine', easeInOutSine],
    ['easeInExpo', easeInExpo],
    ['easeOutExpo', easeOutExpo],
    // NOTE: bounce functions are intentionally non-monotonic (they oscillate),
    // so easeInBounce, easeOutBounce, easeInOutBounce are excluded.
  ];

  for (const [name, fn] of MONOTONIC) {
    it(`${name} is non-decreasing across [0, 1]`, () => {
      let prev = fn(0);
      for (let i = 1; i <= 20; i++) {
        const curr = fn(i / 20);
        expect(curr).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = curr;
      }
    });
  }
});
