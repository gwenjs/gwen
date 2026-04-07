/**
 * @file vite-plugin extractLayerDefinitions / inlineLayerReferences unit tests.
 */
import { describe, it, expect, vi } from 'vitest';
import { extractLayerDefinitions, inlineLayerReferences } from '../../src/vite-plugin.js';
import { physics2dVitePlugin } from '../../src/vite-plugin.js';

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

describe('physics2dVitePlugin transform', () => {
  function callTransform(code: string, id = 'src/game.ts') {
    const plugin = physics2dVitePlugin();
    const transform = plugin.transform as (code: string, id: string) => { code: string; map: unknown } | null | undefined;
    return transform.call({}, code, id);
  }

  it('returns a non-null source map when layers are inlined', () => {
    const code = [
      "const Layers = defineLayers({ wall: 1 << 2, player: 1 << 0 });",
      "useStaticBody({ layer: Layers.wall, mask: Layers.player });",
    ].join('\n');

    const result = callTransform(code);

    expect(result).toBeDefined();
    expect(result!.map).not.toBeNull();
    expect(result!.map).toHaveProperty('mappings');
  });

  it('removes the defineLayers declaration when all references are inlined', () => {
    const code = [
      "const Layers = defineLayers({ wall: 4, player: 1 });",
      "useStaticBody({ layer: Layers.wall, mask: Layers.player });",
    ].join('\n');

    const result = callTransform(code);

    expect(result).toBeDefined();
    expect(result!.code).not.toContain('defineLayers');
    expect(result!.code).not.toContain('const Layers');
    expect(result!.code).toContain('4');
    expect(result!.code).toContain('1');
  });

  it('keeps the defineLayers declaration when the variable is still referenced', () => {
    const code = [
      "const Layers = defineLayers({ wall: 4 });",
      "useStaticBody({ layer: Layers.wall });",
      "console.log(Layers);",
    ].join('\n');

    const result = callTransform(code);

    expect(result).toBeDefined();
    expect(result!.code).toContain('defineLayers');
  });

  it('warns when a layer is defined but never referenced', async () => {
    const plugin = physics2dVitePlugin();
    const warnings: string[] = [];
    const mockCtx = { warn: vi.fn((m: string) => warnings.push(m)) };

    const code = `
      const L = defineLayers({ wall: 1, player: 2 })
      useStaticBody({ layer: L.wall }) // player never used
    `;
    await (plugin.transform as Function).call(mockCtx, code, 'test.ts');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('player');
  });
});
