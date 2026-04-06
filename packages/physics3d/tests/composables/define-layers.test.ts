import { vi, describe, it, expect, beforeEach } from 'vitest';
import { defineLayers } from '../../src/composables/define-layers.js';

describe('defineLayers', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('returns the same values as passed', () => {
    const result = defineLayers({ player: 1, enemy: 2, ground: 4 });
    expect(result.player).toBe(1);
    expect(result.enemy).toBe(2);
    expect(result.ground).toBe(4);
  });

  it('does not warn for valid non-overlapping layers', () => {
    defineLayers({ a: 1, b: 2, c: 4 });
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('emits console.warn when two layers share bits (a:1, b:3 — 1 & 3 = 1)', () => {
    defineLayers({ a: 1, b: 3 });
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('[gwen:physics3d] defineLayers: layers share bits'),
    );
  });

  it('includes the shared bit value in the warning', () => {
    defineLayers({ a: 6, b: 3 });
    // 6 & 3 = 2
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('= 2'));
  });

  it('returns result typed as { [K in keyof T]: number }', () => {
    const layers = defineLayers({ foo: 1, bar: 2 });
    // TypeScript type assertion — if this compiles, the type is correct
    const _foo: number = layers.foo;
    const _bar: number = layers.bar;
    expect(_foo).toBe(1);
    expect(_bar).toBe(2);
  });

  it('spreads into a new object (does not return the same reference)', () => {
    const def = { x: 1, y: 2 };
    const result = defineLayers(def);
    expect(result).not.toBe(def);
  });

  it('handles a single layer without warning', () => {
    defineLayers({ only: 8 });
    expect(console.warn).not.toHaveBeenCalled();
  });
});
