import { describe, it, expect, vi } from 'vitest';
import { extractLayerDefinitions, inlineLayerReferences } from '../src/vite-plugin.js';

describe('extractLayerDefinitions', () => {
  it('extracts simple numeric layers', () => {
    const code = `const Layers = defineLayers({ player: 1, enemy: 2, ground: 4 })`;
    const result = extractLayerDefinitions(code);
    expect(result?.get('player')).toBe(1);
    expect(result?.get('enemy')).toBe(2);
    expect(result?.get('ground')).toBe(4);
  });

  it('returns null when no defineLayers call', () => {
    expect(extractLayerDefinitions('const x = 5')).toBeNull();
  });

  it('returns null when defineLayers has an empty body', () => {
    expect(extractLayerDefinitions('defineLayers({})')).toBeNull();
  });

  it('extracts hex literal values', () => {
    const code = `const L = defineLayers({ a: 0x01, b: 0x02 })`;
    const result = extractLayerDefinitions(code);
    expect(result?.get('a')).toBe(1);
    expect(result?.get('b')).toBe(2);
  });

  it('returns a Map with the correct number of entries', () => {
    const code = `const L = defineLayers({ x: 1, y: 2, z: 4, w: 8 })`;
    const result = extractLayerDefinitions(code);
    expect(result?.size).toBe(4);
  });

  it('skips entries with complex expressions that cannot be evaluated', () => {
    // someVar cannot be evaluated statically
    const code = `const L = defineLayers({ a: 1, b: someVar })`;
    const result = extractLayerDefinitions(code);
    // 'a' should be parsed, 'b' may be skipped
    expect(result).not.toBeNull();
    expect(result?.get('a')).toBe(1);
  });
});

describe('inlineLayerReferences', () => {
  it('replaces Layers.player with numeric value', () => {
    const map = new Map([
      ['player', 1],
      ['enemy', 2],
    ]);
    const result = inlineLayerReferences('if (layer === Layers.player) {}', 'Layers', map);
    expect(result).toBe('if (layer === 1) {}');
  });

  it('replaces all occurrences of a layer reference', () => {
    const map = new Map([['ground', 4]]);
    const code = 'const a = Layers.ground; const b = Layers.ground;';
    const result = inlineLayerReferences(code, 'Layers', map);
    expect(result).toBe('const a = 4; const b = 4;');
  });

  it('replaces multiple different layer names', () => {
    const map = new Map([
      ['player', 1],
      ['enemy', 2],
    ]);
    const code = 'a = Layers.player; b = Layers.enemy;';
    const result = inlineLayerReferences(code, 'Layers', map);
    expect(result).toBe('a = 1; b = 2;');
  });

  it('does not replace partial identifier matches', () => {
    const map = new Map([['pl', 1]]);
    const code = 'Layers.player';
    const result = inlineLayerReferences(code, 'Layers', map);
    // 'pl' should not replace 'player' due to word boundary
    expect(result).toBe('Layers.player');
  });

  it('returns code unchanged when layerMap is empty', () => {
    const code = 'layer === Layers.enemy';
    const result = inlineLayerReferences(code, 'Layers', new Map());
    expect(result).toBe(code);
  });
});

describe('physics3dVitePlugin', () => {
  it('plugin has name gwen:physics3d', async () => {
    const { physics3dVitePlugin } = await import('../src/vite-plugin.js');
    const plugin = physics3dVitePlugin();
    expect(plugin.name).toBe('gwen:physics3d');
  });

  it('transform returns undefined for non-TS/JS files', async () => {
    const { physics3dVitePlugin } = await import('../src/vite-plugin.js');
    const plugin = physics3dVitePlugin();
    const transform = plugin.transform as (code: string, id: string) => Promise<unknown>;
    const result = await transform('some code', 'styles.css');
    expect(result).toBeUndefined();
  });

  it('transform returns undefined when no defineLayers call', async () => {
    const { physics3dVitePlugin } = await import('../src/vite-plugin.js');
    const plugin = physics3dVitePlugin();
    const transform = plugin.transform as (code: string, id: string) => Promise<unknown>;
    const result = await transform('const x = 5', 'file.ts');
    expect(result).toBeUndefined();
  });

  it('transforms TypeScript file with defineLayers call and inlines layer values', async () => {
    const { physics3dVitePlugin } = await import('../src/vite-plugin.js');
    const plugin = physics3dVitePlugin();
    const transform = plugin.transform as (
      code: string,
      id: string,
    ) => Promise<{ code: string; map: unknown } | undefined>;
    const code = [
      "import { defineLayers } from '@gwenjs/physics3d';",
      'const Layers = defineLayers({ player: 0x0001, enemy: 0x0002 });',
      'useDynamicBody({ membershipLayers: Layers.player });',
      'useDynamicBody({ membershipLayers: Layers.enemy });',
    ].join('\n');

    const result = await transform(code, 'src/game.ts');

    expect(result).not.toBeUndefined();
    expect(result?.code).toContain('1'); // 0x0001 inlined as 1
    expect(result?.code).toContain('2'); // 0x0002 inlined as 2
    expect(result?.code).not.toContain('Layers.player');
    expect(result?.code).not.toContain('Layers.enemy');
    expect(result?.map).not.toBeNull();
  });

  it('returns a source map alongside transformed code', async () => {
    const { physics3dVitePlugin } = await import('../src/vite-plugin.js');
    const plugin = physics3dVitePlugin();
    const transform = plugin.transform as (
      code: string,
      id: string,
    ) => Promise<{ code: string; map: unknown } | undefined>;
    const code = 'const Layers = defineLayers({ ground: 4 });\nif (layer === Layers.ground) {}';

    const result = await transform(code, 'game.ts');

    expect(result).toBeDefined();
    expect(result?.map).not.toBeNull();
    expect(result?.map).toHaveProperty('mappings');
  });

  it('does not transform when no defineLayers call present', async () => {
    const { physics3dVitePlugin } = await import('../src/vite-plugin.js');
    const plugin = physics3dVitePlugin();
    const transform = plugin.transform as (code: string, id: string) => Promise<unknown>;
    const result = await transform('const x = 1;', 'src/game.ts');
    expect(result).toBeUndefined();
  });

  it('logs debug output when debug option is enabled and layers are inlined', async () => {
    const { physics3dVitePlugin } = await import('../src/vite-plugin.js');
    const plugin = physics3dVitePlugin({ debug: true });
    const transform = plugin.transform as (code: string, id: string) => Promise<unknown>;
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const code = 'const Layers = defineLayers({ a: 1 });\nif (Layers.a) {}';
    await transform(code, 'src/test.ts');

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[gwen:physics3d]'));
    consoleSpy.mockRestore();
  });

  it('returns a non-null source map when layers are inlined', async () => {
    const { physics3dVitePlugin } = await import('../src/vite-plugin.js');
    const plugin = physics3dVitePlugin();
    const transform = plugin.transform as (
      code: string,
      id: string,
    ) => Promise<{ code: string; map: unknown } | undefined>;

    const code = [
      "const Layers = defineLayers({ wall: 4, player: 1 });",
      "useDynamicBody({ layer: Layers.wall, mask: Layers.player });",
    ].join('\n');

    const result = await transform(code, 'src/game.ts');

    expect(result).toBeDefined();
    expect(result!.map).not.toBeNull();
    expect(result!.map).toHaveProperty('mappings');
  });

  it('removes the defineLayers declaration when all references are inlined', async () => {
    const { physics3dVitePlugin } = await import('../src/vite-plugin.js');
    const plugin = physics3dVitePlugin();
    const transform = plugin.transform as (
      code: string,
      id: string,
    ) => Promise<{ code: string; map: unknown } | undefined>;

    const code = [
      "const Layers = defineLayers({ wall: 4, player: 1 });",
      "useDynamicBody({ layer: Layers.wall, mask: Layers.player });",
    ].join('\n');

    const result = await transform(code, 'src/game.ts');

    expect(result).toBeDefined();
    expect(result!.code).not.toContain('defineLayers');
    expect(result!.code).not.toContain('const Layers');
    expect(result!.code).toContain('4');
    expect(result!.code).toContain('1');
  });

  it('keeps the defineLayers declaration when the variable is still referenced', async () => {
    const { physics3dVitePlugin } = await import('../src/vite-plugin.js');
    const plugin = physics3dVitePlugin();
    const transform = plugin.transform as (
      code: string,
      id: string,
    ) => Promise<{ code: string; map: unknown } | undefined>;

    const code = [
      "const Layers = defineLayers({ wall: 4 });",
      "useDynamicBody({ layer: Layers.wall });",
      "console.log(Layers);",
    ].join('\n');

    const result = await transform(code, 'src/game.ts');

    expect(result).toBeDefined();
    expect(result!.code).toContain('defineLayers');
  });

  it('warns when a layer is defined but never referenced', async () => {
    const { physics3dVitePlugin } = await import('../src/vite-plugin.js');
    const plugin = physics3dVitePlugin();
    const warnings: string[] = [];
    const mockCtx = { warn: vi.fn((m: string) => warnings.push(m)) };

    const code = `
      const L = defineLayers({ wall: 1, player: 2 })
      useDynamicBody({ layer: L.wall }) // player never used
    `;
    await (plugin.transform as Function).call(mockCtx, code, 'test.ts');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('player');
  });
});
