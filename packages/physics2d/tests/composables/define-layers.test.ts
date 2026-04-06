/**
 * @file defineLayers() composable tests.
 */
import { describe, it, expect, vi } from 'vitest';
import { defineLayers } from '../../src/composables/define-layers.js';

describe('defineLayers', () => {
  it('returns the same values passed in', () => {
    const L = defineLayers({ player: 1, enemy: 2, wall: 4 });
    expect(L.player).toBe(1);
    expect(L.enemy).toBe(2);
    expect(L.wall).toBe(4);
  });

  it('works with bit-shifted values', () => {
    const L = defineLayers({ a: 1 << 0, b: 1 << 1, c: 1 << 2 });
    expect(L.a).toBe(1);
    expect(L.b).toBe(2);
    expect(L.c).toBe(4);
  });

  it('warns when two layers share bits', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    defineLayers({ a: 3, b: 2 }); // 3 & 2 = 2 ≠ 0
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('does not warn when no bits are shared', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    defineLayers({ a: 1, b: 2, c: 4 });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('does not warn for a single layer', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    defineLayers({ solo: 1 });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('returns an object with the correct number of keys', () => {
    const L = defineLayers({ x: 1, y: 2, z: 4, w: 8 });
    expect(Object.keys(L)).toHaveLength(4);
  });

  it('preserves string keys exactly', () => {
    const L = defineLayers({ myLayer: 1 });
    expect(Object.keys(L)[0]).toBe('myLayer');
  });
});
