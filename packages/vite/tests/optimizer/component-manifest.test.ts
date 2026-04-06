import { describe, it, expect } from 'vitest';
import { ComponentManifest } from '../../src/optimizer/component-manifest';

describe('ComponentManifest', () => {
  it('starts empty', () => {
    const manifest = new ComponentManifest();
    expect(manifest.size).toBe(0);
  });

  it('registers a component entry', () => {
    const manifest = new ComponentManifest();
    manifest.register({
      name: 'Position',
      typeId: 1,
      byteSize: 8,
      f32Stride: 2,
      fields: [
        { name: 'x', type: 'f32', byteOffset: 0 },
        { name: 'y', type: 'f32', byteOffset: 4 },
      ],
      importPath: './components/position',
      exportName: 'Position',
    });
    expect(manifest.size).toBe(1);
    expect(manifest.get('Position')?.byteSize).toBe(8);
  });

  it('looks up by typeId', () => {
    const manifest = new ComponentManifest();
    manifest.register({
      name: 'Health',
      typeId: 2,
      byteSize: 4,
      f32Stride: 1,
      fields: [{ name: 'value', type: 'f32', byteOffset: 0 }],
      importPath: './components/health',
      exportName: 'Health',
    });
    expect(manifest.getById(2)?.name).toBe('Health');
  });

  it('returns undefined for unknown component', () => {
    const manifest = new ComponentManifest();
    expect(manifest.get('Unknown')).toBeUndefined();
  });
});
