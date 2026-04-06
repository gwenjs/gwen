import { describe, it, expect } from 'vitest';
import { CodeGenerator } from '../../src/optimizer/code-generator';
import { ComponentManifest } from '../../src/optimizer/component-manifest';

function makeManifest(): ComponentManifest {
  const m = new ComponentManifest();
  m.register({
    name: 'Position',
    typeId: 1,
    byteSize: 8,
    f32Stride: 2,
    fields: [
      { name: 'x', type: 'f32', byteOffset: 0 },
      { name: 'y', type: 'f32', byteOffset: 4 },
    ],
    importPath: './components',
    exportName: 'Position',
  });
  m.register({
    name: 'Velocity',
    typeId: 2,
    byteSize: 8,
    f32Stride: 2,
    fields: [
      { name: 'x', type: 'f32', byteOffset: 0 },
      { name: 'y', type: 'f32', byteOffset: 4 },
    ],
    importPath: './components',
    exportName: 'Velocity',
  });
  return m;
}

describe('CodeGenerator', () => {
  it('generates a queryReadBulk call with correct typeId and f32Stride', () => {
    const gen = new CodeGenerator(makeManifest(), 'core');
    const code = gen.generateBulkRead(['Position', 'Velocity'], 'Position');
    expect(code).toContain('queryReadBulk');
    expect(code).toContain('1'); // typeId of Position
    expect(code).toContain('2'); // f32Stride of Position
  });

  it('generates a queryWriteBulk call', () => {
    const gen = new CodeGenerator(makeManifest(), 'core');
    const code = gen.generateBulkWrite('Position', '_slots', '_gens', '_posData');
    expect(code).toContain('queryWriteBulk');
    expect(code).toContain('1'); // typeId of Position
  });

  it('generates accessor code for a field by byte offset', () => {
    const gen = new CodeGenerator(makeManifest(), 'core');
    const accessor = gen.generateFieldAccessor('Position', 'x', 'i', '_posData');
    expect(accessor).toContain('_posData');
    expect(accessor).toContain('[i * 2 + 0]');
  });
});
