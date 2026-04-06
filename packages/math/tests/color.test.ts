import { describe, it, expect } from 'vitest';
import {
  color,
  colorWhite,
  colorBlack,
  colorTransparent,
  colorFromHex,
  colorToHex,
  colorFromRGB255,
  colorFromHSL,
  colorToHSL,
  colorLerp,
  colorPremultiply,
  colorClamp,
  colorClone,
} from '../src/color.js';

describe('constructors', () => {
  it('color()', () =>
    expect(color(0.5, 0.25, 0.1, 0.8)).toEqual({ r: 0.5, g: 0.25, b: 0.1, a: 0.8 }));
  it('color() default alpha', () => expect(color(1, 0, 0).a).toBe(1));
  it('colorWhite', () => expect(colorWhite()).toEqual({ r: 1, g: 1, b: 1, a: 1 }));
  it('colorBlack', () => expect(colorBlack()).toEqual({ r: 0, g: 0, b: 0, a: 1 }));
  it('colorTransparent', () => expect(colorTransparent()).toEqual({ r: 0, g: 0, b: 0, a: 0 }));
});

describe('colorFromHex', () => {
  it('#RGB shorthand', () => {
    const c = colorFromHex('#fff');
    expect(c.r).toBeCloseTo(1);
    expect(c.g).toBeCloseTo(1);
    expect(c.b).toBeCloseTo(1);
    expect(c.a).toBe(1);
  });
  it('#RRGGBB', () => {
    const c = colorFromHex('#ff0000');
    expect(c.r).toBeCloseTo(1);
    expect(c.g).toBe(0);
    expect(c.b).toBe(0);
  });
  it('#RRGGBBAA', () => {
    const c = colorFromHex('#ffffff80');
    expect(c.r).toBeCloseTo(1);
    expect(c.a).toBeCloseTo(128 / 255);
  });
  it('without # prefix', () => {
    const c = colorFromHex('ff8800');
    expect(c.r).toBeCloseTo(1);
    expect(c.g).toBeCloseTo(0x88 / 255);
    expect(c.b).toBe(0);
  });
  it('throws on invalid format', () => {
    expect(() => colorFromHex('#zzz')).toThrow();
  });
});

describe('colorToHex', () => {
  it('roundtrip', () => {
    const c = color(1, 0, 0.5, 1);
    const hex = colorToHex(c);
    const back = colorFromHex(hex);
    expect(back.r).toBeCloseTo(c.r, 1);
    expect(back.g).toBeCloseTo(c.g, 1);
    expect(back.b).toBeCloseTo(c.b, 1);
    expect(back.a).toBeCloseTo(c.a, 1);
  });
  it('white', () => expect(colorToHex(colorWhite())).toBe('#ffffffff'));
  it('black', () => expect(colorToHex(colorBlack())).toBe('#000000ff'));
});

describe('colorFromRGB255', () => {
  it('255,255,255 = white', () => {
    const c = colorFromRGB255(255, 255, 255);
    expect(c.r).toBeCloseTo(1);
    expect(c.g).toBeCloseTo(1);
    expect(c.b).toBeCloseTo(1);
    expect(c.a).toBeCloseTo(1);
  });
  it('0,0,0 = black', () => {
    const c = colorFromRGB255(0, 0, 0, 255);
    expect(c).toEqual({ r: 0, g: 0, b: 0, a: 1 });
  });
});

describe('colorFromHSL / colorToHSL', () => {
  it('red = H:0 S:1 L:0.5', () => {
    const c = colorFromHSL(0, 1, 0.5);
    expect(c.r).toBeCloseTo(1, 4);
    expect(c.g).toBeCloseTo(0, 4);
    expect(c.b).toBeCloseTo(0, 4);
  });
  it('white = S:0 L:1', () => {
    const c = colorFromHSL(0, 0, 1);
    expect(c.r).toBeCloseTo(1);
    expect(c.g).toBeCloseTo(1);
    expect(c.b).toBeCloseTo(1);
  });
  it('round-trip', () => {
    const original = { r: 0.8, g: 0.3, b: 0.5, a: 1 };
    const hsl = colorToHSL(original);
    const back = colorFromHSL(hsl.h, hsl.s, hsl.l, hsl.a);
    expect(back.r).toBeCloseTo(original.r, 4);
    expect(back.g).toBeCloseTo(original.g, 4);
    expect(back.b).toBeCloseTo(original.b, 4);
  });
});

describe('colorLerp', () => {
  it('at t=0 returns a', () => {
    const a = color(1, 0, 0);
    const b = color(0, 0, 1);
    const result = colorLerp(a, b, 0);
    expect(result.r).toBeCloseTo(1);
    expect(result.b).toBeCloseTo(0);
  });
  it('at t=1 returns b', () => {
    const a = color(1, 0, 0);
    const b = color(0, 0, 1);
    const result = colorLerp(a, b, 1);
    expect(result.r).toBeCloseTo(0);
    expect(result.b).toBeCloseTo(1);
  });
  it('at t=0.5 is midpoint', () => {
    const a = color(0, 0, 0);
    const b = color(1, 1, 1);
    const result = colorLerp(a, b, 0.5);
    expect(result.r).toBeCloseTo(0.5);
  });
});

describe('colorPremultiply', () => {
  it('multiplies rgb by alpha', () => {
    const c = color(1, 0.5, 0.25, 0.5);
    const p = colorPremultiply(c);
    expect(p.r).toBeCloseTo(0.5);
    expect(p.g).toBeCloseTo(0.25);
    expect(p.b).toBeCloseTo(0.125);
    expect(p.a).toBe(0.5);
  });
});

describe('colorClamp', () => {
  it('clamps each channel to [0,1]', () => {
    const c = colorClamp({ r: -0.5, g: 1.5, b: 0.5, a: 2 });
    expect(c.r).toBe(0);
    expect(c.g).toBe(1);
    expect(c.b).toBe(0.5);
    expect(c.a).toBe(1);
  });
});

describe('colorClone', () => {
  it('returns new object with same values', () => {
    const c = color(0.1, 0.2, 0.3, 0.4);
    const clone = colorClone(c);
    expect(clone).toEqual(c);
    expect(clone).not.toBe(c);
  });
});
