/**
 * GWEN Math — RGBA colour helpers.
 *
 * All colour components are in `[0, 1]` (linear space unless noted).
 * All functions are pure unless the name ends in `Mut`.
 */

import type { Color } from './types.js';
import { clamp01 } from './scalar.js';

// ── Constructors ──────────────────────────────────────────────────────────────

/** Create a colour from normalised `[0, 1]` RGBA components. */
export function color(r: number, g: number, b: number, a = 1): Color {
  return { r, g, b, a };
}

/** Opaque white. */
export function colorWhite(): Color {
  return { r: 1, g: 1, b: 1, a: 1 };
}

/** Opaque black. */
export function colorBlack(): Color {
  return { r: 0, g: 0, b: 0, a: 1 };
}

/** Fully transparent black. */
export function colorTransparent(): Color {
  return { r: 0, g: 0, b: 0, a: 0 };
}

// ── Parsing / serialisation ───────────────────────────────────────────────────

/**
 * Parse a CSS hex string (`#RGB`, `#RGBA`, `#RRGGBB`, `#RRGGBBAA`) into a Color.
 * Throws if the format is not recognised.
 */
export function colorFromHex(hex: string): Color {
  const h = hex.startsWith('#') ? hex.slice(1) : hex;
  let r: number,
    g: number,
    b: number,
    a = 1;

  if (h.length === 3 || h.length === 4) {
    const rHex = h.slice(0, 1);
    const gHex = h.slice(1, 2);
    const bHex = h.slice(2, 3);
    const aHex = h.slice(3, 4);
    r = parseInt(rHex + rHex, 16) / 255;
    g = parseInt(gHex + gHex, 16) / 255;
    b = parseInt(bHex + bHex, 16) / 255;
    if (h.length === 4) a = parseInt(aHex + aHex, 16) / 255;
  } else if (h.length === 6 || h.length === 8) {
    r = parseInt(h.slice(0, 2), 16) / 255;
    g = parseInt(h.slice(2, 4), 16) / 255;
    b = parseInt(h.slice(4, 6), 16) / 255;
    if (h.length === 8) a = parseInt(h.slice(6, 8), 16) / 255;
  } else {
    throw new Error(`colorFromHex: invalid hex "${hex}"`);
  }

  if (isNaN(r) || isNaN(g) || isNaN(b) || isNaN(a)) {
    throw new Error(`colorFromHex: invalid hex "${hex}"`);
  }

  return { r, g, b, a };
}

/**
 * Serialise a Color to a `#RRGGBBAA` hex string.
 */
export function colorToHex(c: Color): string {
  const toHexByte = (v: number) =>
    Math.round(clamp01(v) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${toHexByte(c.r)}${toHexByte(c.g)}${toHexByte(c.b)}${toHexByte(c.a)}`;
}

/**
 * Create a Color from 8-bit integer channels `[0, 255]`.
 */
export function colorFromRGB255(r: number, g: number, b: number, a = 255): Color {
  return { r: r / 255, g: g / 255, b: b / 255, a: a / 255 };
}

// ── HSL conversion ────────────────────────────────────────────────────────────

/**
 * Create a Color from HSL values.
 *
 * @param h - Hue in `[0, 360]`.
 * @param s - Saturation in `[0, 1]`.
 * @param l - Lightness in `[0, 1]`.
 * @param a - Alpha in `[0, 1]`.
 */
export function colorFromHSL(h: number, s: number, l: number, a = 1): Color {
  if (s === 0) {
    return { r: l, g: l, b: l, a };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hk = (((h % 360) + 360) % 360) / 360;
  return {
    r: _hue2rgb(p, q, hk + 1 / 3),
    g: _hue2rgb(p, q, hk),
    b: _hue2rgb(p, q, hk - 1 / 3),
    a,
  };
}

/**
 * Convert a Color to its HSL representation.
 * Returns `{ h: [0,360], s: [0,1], l: [0,1], a: [0,1] }`.
 */
export function colorToHSL(c: Color): { h: number; s: number; l: number; a: number } {
  const max = Math.max(c.r, c.g, c.b);
  const min = Math.min(c.r, c.g, c.b);
  const l = (max + min) / 2;
  let h = 0,
    s = 0;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case c.r:
        h = (c.g - c.b) / d + (c.g < c.b ? 6 : 0);
        break;
      case c.g:
        h = (c.b - c.r) / d + 2;
        break;
      default:
        h = (c.r - c.g) / d + 4;
        break;
    }
    h *= 60;
  }

  return { h, s, l, a: c.a };
}

// ── Operations ────────────────────────────────────────────────────────────────

/**
 * Linear interpolation between `a` and `b` by factor `t`.
 */
export function colorLerp(a: Color, b: Color, t: number): Color {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
    a: a.a + (b.a - a.a) * t,
  };
}

/**
 * Pre-multiply alpha into RGB channels.
 * Useful before passing to WebGL blending operations.
 */
export function colorPremultiply(c: Color): Color {
  return { r: c.r * c.a, g: c.g * c.a, b: c.b * c.a, a: c.a };
}

/**
 * Clamp all channels to `[0, 1]`.
 */
export function colorClamp(c: Color): Color {
  return {
    r: clamp01(c.r),
    g: clamp01(c.g),
    b: clamp01(c.b),
    a: clamp01(c.a),
  };
}

/** Shallow clone. */
export function colorClone(c: Color): Color {
  return { r: c.r, g: c.g, b: c.b, a: c.a };
}

// ── Private helpers ───────────────────────────────────────────────────────────

function _hue2rgb(p: number, q: number, t: number): number {
  const tt = ((t % 1) + 1) % 1;
  if (tt < 1 / 6) return p + (q - p) * 6 * tt;
  if (tt < 1 / 2) return q;
  if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
  return p;
}
