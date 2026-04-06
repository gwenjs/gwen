/**
 * @file vite-plugin extractLayerDefinitions / inlineLayerReferences unit tests.
 */
import { describe, it, expect } from 'vitest';
import { extractLayerDefinitions, inlineLayerReferences } from '../../src/vite-plugin.js';

describe('extractLayerDefinitions', () => {
  it('extracts simple bitmask values from bit-shift expressions', () => {
    const code = `const Layers = defineLayers({ player: 1 << 0, enemy: 1 << 1, wall: 1 << 2 })`;
    const map = extractLayerDefinitions(code);
    expect(map).not.toBeNull();
    expect(map!.get('player')).toBe(1);
    expect(map!.get('enemy')).toBe(2);
    expect(map!.get('wall')).toBe(4);
  });

  it('extracts literal numeric values', () => {
    const code = `const L = defineLayers({ a: 1, b: 2, c: 4 })`;
    const map = extractLayerDefinitions(code);
    expect(map!.get('a')).toBe(1);
    expect(map!.get('b')).toBe(2);
    expect(map!.get('c')).toBe(4);
  });

  it('returns null when defineLayers is not present', () => {
    expect(extractLayerDefinitions('const x = 1;')).toBeNull();
  });

  it('returns null for an empty defineLayers call', () => {
    const code = `const L = defineLayers({})`;
    expect(extractLayerDefinitions(code)).toBeNull();
  });

  it('handles whitespace around the call', () => {
    const code = `const L = defineLayers( { a: 1 } )`;
    const map = extractLayerDefinitions(code);
    expect(map).not.toBeNull();
    expect(map!.get('a')).toBe(1);
  });

  it('returns a Map with correct size', () => {
    const code = `const L = defineLayers({ x: 1, y: 2 })`;
    const map = extractLayerDefinitions(code);
    expect(map!.size).toBe(2);
  });
});

describe('inlineLayerReferences', () => {
  it('replaces a single layer reference with its literal value', () => {
    const map = new Map([
      ['wall', 4],
      ['player', 1],
    ]);
    const code = `useStaticBody({ layer: Layers.wall, mask: Layers.player })`;
    expect(inlineLayerReferences(code, 'Layers', map)).toBe(`useStaticBody({ layer: 4, mask: 1 })`);
  });

  it('replaces multiple occurrences of the same layer', () => {
    const map = new Map([['enemy', 2]]);
    const code = `x = Layers.enemy; y = Layers.enemy;`;
    expect(inlineLayerReferences(code, 'Layers', map)).toBe(`x = 2; y = 2;`);
  });

  it('does not modify code when there are no matches', () => {
    const map = new Map([['wall', 4]]);
    const code = `const x = 1;`;
    expect(inlineLayerReferences(code, 'Layers', map)).toBe(code);
  });

  it('only replaces the exact variable name (not similar prefixes)', () => {
    const map = new Map([['wall', 4]]);
    const code = `MyLayers.wall + Layers.wall`;
    const result = inlineLayerReferences(code, 'Layers', map);
    // Only Layers.wall should be replaced
    expect(result).toBe(`MyLayers.wall + 4`);
  });

  it('replaces across all entries in the map', () => {
    const map = new Map([
      ['a', 1],
      ['b', 2],
      ['c', 4],
    ]);
    const code = `L.a | L.b | L.c`;
    expect(inlineLayerReferences(code, 'L', map)).toBe(`1 | 2 | 4`);
  });
});
