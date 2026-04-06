import { describe, it, expect } from 'vitest';
import { PatternDetector } from '../../src/optimizer/pattern-detector';
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

describe('PatternDetector', () => {
  it('classifies a detectable pattern when all components are known', () => {
    const manifest = makeManifest();
    const detector = new PatternDetector(manifest);
    const result = detector.classify({
      queryComponents: ['Position', 'Velocity'],
      readComponents: ['Position', 'Velocity'],
      writeComponents: ['Position'],
      loc: { line: 1, column: 0, file: 'test.ts' },
    });
    expect(result.optimizable).toBe(true);
  });

  it('rejects a pattern with unknown component', () => {
    const manifest = makeManifest();
    const detector = new PatternDetector(manifest);
    const result = detector.classify({
      queryComponents: ['Position', 'UnknownComp'],
      readComponents: ['Position'],
      writeComponents: [],
      loc: { line: 1, column: 0, file: 'test.ts' },
    });
    expect(result.optimizable).toBe(false);
    expect(result.reason).toContain('UnknownComp');
  });
});
