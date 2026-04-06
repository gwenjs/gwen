import { describe, it, expect } from 'vitest';
import { ComponentManifest } from '../../src/optimizer/component-manifest.js';
import { ComponentScanner } from '../../src/optimizer/component-scanner.js';

describe('ComponentScanner', () => {
  it('extracts a component with explicit _typeId and Types.* schema', async () => {
    const manifest = new ComponentManifest();
    const scanner = new ComponentScanner(manifest);
    scanner.scanSource(
      `
      export const Position = defineComponent({
        name: 'Position',
        _typeId: 1,
        schema: { x: Types.f32, y: Types.f32 },
      });
      `,
      'position.ts',
    );
    await scanner.scanFiles([]);

    const entry = manifest.get('Position')!;
    expect(entry.typeId).toBe(1);
    expect(entry.f32Stride).toBe(2);
    expect(entry.fields[0]).toEqual({ name: 'x', type: 'f32', byteOffset: 0 });
    expect(entry.fields[1]).toEqual({ name: 'y', type: 'f32', byteOffset: 4 });
    expect(entry.exportName).toBe('Position');
  });

  it('assigns alphabetical fallback IDs when _typeId is absent', async () => {
    const manifest = new ComponentManifest();
    const scanner = new ComponentScanner(manifest);
    scanner.scanSource(
      `
      export const Velocity = defineComponent({ name: 'Velocity', schema: { x: Types.f32 } });
      export const Position = defineComponent({ name: 'Position', schema: { x: Types.f32 } });
      `,
      'components.ts',
    );
    await scanner.scanFiles([]);

    expect(manifest.get('Position')!.typeId).toBe(1); // alphabetically first
    expect(manifest.get('Velocity')!.typeId).toBe(2);
  });

  it('ignores components without a schema', () => {
    const manifest = new ComponentManifest();
    const scanner = new ComponentScanner(manifest);
    scanner.scanSource(`export const Tag = defineComponent({ name: 'Tag' });`, 'tag.ts');
    expect(manifest.size).toBe(0);
  });

  it('ignores defineComponent in comments', () => {
    const manifest = new ComponentManifest();
    const scanner = new ComponentScanner(manifest);
    scanner.scanSource(
      `// const F = defineComponent({ name: 'F', schema: { x: Types.f32 } });`,
      'c.ts',
    );
    expect(manifest.size).toBe(0);
  });

  it('respects explicit IDs when assigning fallback IDs', async () => {
    const manifest = new ComponentManifest();
    const scanner = new ComponentScanner(manifest);
    scanner.scanSource(
      `
      export const A = defineComponent({ name: 'A', _typeId: 5, schema: { v: Types.f32 } });
      export const B = defineComponent({ name: 'B', schema: { v: Types.f32 } });
      `,
      'mixed.ts',
    );
    await scanner.scanFiles([]);

    expect(manifest.get('A')!.typeId).toBe(5);
    expect(manifest.get('B')!.typeId).toBe(6);
  });

  it('supports string literal schema values as fallback', async () => {
    const manifest = new ComponentManifest();
    const scanner = new ComponentScanner(manifest);
    scanner.scanSource(
      `
      export const Health = defineComponent({
        name: 'Health',
        _typeId: 2,
        schema: { value: 'f32' },
      });
      `,
      'health.ts',
    );
    await scanner.scanFiles([]);

    const entry = manifest.get('Health')!;
    expect(entry.typeId).toBe(2);
    expect(entry.fields[0]).toEqual({ name: 'value', type: 'f32', byteOffset: 0 });
  });

  it('computes byteSize as fields.length * 4', async () => {
    const manifest = new ComponentManifest();
    const scanner = new ComponentScanner(manifest);
    scanner.scanSource(
      `
      export const Transform = defineComponent({
        name: 'Transform',
        _typeId: 3,
        schema: { x: Types.f32, y: Types.f32, z: Types.f32 },
      });
      `,
      'transform.ts',
    );
    await scanner.scanFiles([]);

    const entry = manifest.get('Transform')!;
    expect(entry.byteSize).toBe(12); // 3 fields * 4 bytes
    expect(entry.f32Stride).toBe(3);
    expect(entry.fields[2]).toEqual({ name: 'z', type: 'f32', byteOffset: 8 });
  });

  it('stores importPath and exportName correctly', async () => {
    const manifest = new ComponentManifest();
    const scanner = new ComponentScanner(manifest);
    scanner.scanSource(
      `export const MyComp = defineComponent({ name: 'MyComp', _typeId: 10, schema: { x: Types.f32 } });`,
      '/project/src/components/my-comp.ts',
    );
    await scanner.scanFiles([]);

    const entry = manifest.get('MyComp')!;
    expect(entry.importPath).toBe('/project/src/components/my-comp.ts');
    expect(entry.exportName).toBe('MyComp');
  });

  it('handles multiple components in one file', async () => {
    const manifest = new ComponentManifest();
    const scanner = new ComponentScanner(manifest);
    scanner.scanSource(
      `
      export const Pos = defineComponent({ name: 'Pos', _typeId: 1, schema: { x: Types.f32 } });
      export const Vel = defineComponent({ name: 'Vel', _typeId: 2, schema: { dx: Types.f32 } });
      `,
      'multi.ts',
    );
    await scanner.scanFiles([]);

    expect(manifest.size).toBe(2);
    expect(manifest.get('Pos')!.typeId).toBe(1);
    expect(manifest.get('Vel')!.typeId).toBe(2);
  });

  it('skips source that does not contain defineComponent at all', () => {
    const manifest = new ComponentManifest();
    const scanner = new ComponentScanner(manifest);
    scanner.scanSource(`export const x = 42;`, 'unrelated.ts');
    expect(manifest.size).toBe(0);
  });
});
