import { describe, it, expect } from 'vitest';
import {
  lerp,
  lerpClamped,
  inverseLerp,
  remap,
  remapClamped,
  clamp,
  clamp01,
  smoothstep,
  smootherstep,
  degToRad,
  radToDeg,
  TAU,
  DEG2RAD,
  RAD2DEG,
  repeat,
  pingPong,
  wrapAngle,
  approxEqual,
  sign,
  moveTowards,
  moveTowardsAngle,
} from '../src/scalar.js';

describe('lerp', () => {
  it('returns a at t=0', () => expect(lerp(2, 8, 0)).toBe(2));
  it('returns b at t=1', () => expect(lerp(2, 8, 1)).toBe(8));
  it('returns midpoint at t=0.5', () => expect(lerp(0, 10, 0.5)).toBe(5));
  it('extrapolates beyond [0,1]', () => expect(lerp(0, 10, 1.5)).toBe(15));
});

describe('lerpClamped', () => {
  it('clamps t > 1 to b', () => expect(lerpClamped(0, 10, 2)).toBe(10));
  it('clamps t < 0 to a', () => expect(lerpClamped(0, 10, -1)).toBe(0));
});

describe('inverseLerp', () => {
  it('returns 0 when v === a', () => expect(inverseLerp(2, 8, 2)).toBe(0));
  it('returns 1 when v === b', () => expect(inverseLerp(2, 8, 8)).toBe(1));
  it('returns 0.5 at midpoint', () => expect(inverseLerp(0, 10, 5)).toBe(0.5));
  it('handles a === b without NaN', () => expect(inverseLerp(5, 5, 5)).toBe(0));
});

describe('remap', () => {
  it('maps value from one range to another', () => {
    expect(remap(5, 0, 10, 0, 100)).toBeCloseTo(50);
    expect(remap(0, 0, 10, -1, 1)).toBeCloseTo(-1);
  });
});

describe('remapClamped', () => {
  it('clamps to output range', () => {
    expect(remapClamped(-5, 0, 10, 0, 100)).toBe(0);
    expect(remapClamped(15, 0, 10, 0, 100)).toBe(100);
  });
});

describe('clamp', () => {
  it('clamps below min', () => expect(clamp(-5, 0, 10)).toBe(0));
  it('clamps above max', () => expect(clamp(15, 0, 10)).toBe(10));
  it('passes through value in range', () => expect(clamp(5, 0, 10)).toBe(5));
});

describe('clamp01', () => {
  it('clamps to [0,1]', () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(0.5)).toBe(0.5);
  });
});

describe('smoothstep', () => {
  it('returns 0 at edge0', () => expect(smoothstep(0, 1, 0)).toBe(0));
  it('returns 1 at edge1', () => expect(smoothstep(0, 1, 1)).toBe(1));
  it('returns ~0.5 at midpoint', () => expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5));
  it('clamps outside edges', () => {
    expect(smoothstep(0, 1, -1)).toBe(0);
    expect(smoothstep(0, 1, 2)).toBe(1);
  });
  it('has zero derivative at edges', () => {
    const eps = 0.001;
    const dLeft = (smoothstep(0, 1, eps) - smoothstep(0, 1, 0)) / eps;
    const dRight = (smoothstep(0, 1, 1) - smoothstep(0, 1, 1 - eps)) / eps;
    expect(dLeft).toBeCloseTo(0, 1);
    expect(dRight).toBeCloseTo(0, 1);
  });
});

describe('smootherstep', () => {
  it('returns 0 at edge0', () => expect(smootherstep(0, 1, 0)).toBe(0));
  it('returns 1 at edge1', () => expect(smootherstep(0, 1, 1)).toBe(1));
});

describe('degToRad / radToDeg', () => {
  it('converts 180° to π', () => expect(degToRad(180)).toBeCloseTo(Math.PI));
  it('converts π to 180°', () => expect(radToDeg(Math.PI)).toBeCloseTo(180));
  it('are inverse of each other', () => expect(radToDeg(degToRad(45))).toBeCloseTo(45));
  it('DEG2RAD constant matches function', () => expect(DEG2RAD).toBeCloseTo(degToRad(1)));
  it('RAD2DEG constant matches function', () => expect(RAD2DEG).toBeCloseTo(radToDeg(1)));
  it('TAU is 2π', () => expect(TAU).toBeCloseTo(Math.PI * 2));
});

describe('repeat', () => {
  it('wraps at length', () => expect(repeat(10, 5)).toBeCloseTo(0));
  it('stays in range', () => {
    for (let i = -20; i <= 20; i++) {
      const v = repeat(i, 7);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(7);
    }
  });
});

describe('pingPong', () => {
  it('starts at 0', () => expect(pingPong(0, 5)).toBeCloseTo(0));
  it('peaks at length', () => expect(pingPong(5, 5)).toBeCloseTo(5));
  it('returns to 0 at 2*length', () => expect(pingPong(10, 5)).toBeCloseTo(0));
});

describe('wrapAngle', () => {
  it('wraps 2π to ~0', () => expect(wrapAngle(Math.PI * 2)).toBeCloseTo(0));
  it('wraps -π to π boundary', () => expect(wrapAngle(-Math.PI)).toBeCloseTo(-Math.PI));
  it('keeps values in (-π, π]', () => {
    const angles = [0, Math.PI / 2, Math.PI, -Math.PI / 2, 3 * Math.PI];
    for (const a of angles) {
      const w = wrapAngle(a);
      expect(w).toBeGreaterThan(-Math.PI - 1e-9);
      expect(w).toBeLessThanOrEqual(Math.PI + 1e-9);
    }
  });
});

describe('approxEqual', () => {
  it('returns true for very close values', () => expect(approxEqual(1, 1 + 1e-7)).toBe(true));
  it('returns false for distant values', () => expect(approxEqual(1, 2)).toBe(false));
  it('accepts custom epsilon', () => expect(approxEqual(0, 0.1, 0.2)).toBe(true));
});

describe('sign', () => {
  it('returns -1 for negatives', () => expect(sign(-5)).toBe(-1));
  it('returns 1 for positives', () => expect(sign(5)).toBe(1));
  it('returns 0 for zero', () => expect(sign(0)).toBe(0));
});

describe('moveTowards', () => {
  it('moves by maxDelta', () => expect(moveTowards(0, 10, 3)).toBe(3));
  it('does not overshoot', () => expect(moveTowards(9, 10, 5)).toBe(10));
  it('works going backwards', () => expect(moveTowards(10, 0, 3)).toBe(7));
});

describe('moveTowardsAngle', () => {
  it('moves towards target by maxDelta', () => {
    const result = moveTowardsAngle(0, Math.PI / 2, 0.1);
    expect(result).toBeCloseTo(0.1);
  });
  it('takes shortest arc (wrap)', () => {
    // Going from π-0.1 to -(π-0.1) — shortest path is backwards (0.2 rad)
    const from = Math.PI - 0.1;
    const to = -(Math.PI - 0.1);
    const result = moveTowardsAngle(from, to, 0.05);
    expect(result).toBeCloseTo(from + 0.05, 4);
  });
});
