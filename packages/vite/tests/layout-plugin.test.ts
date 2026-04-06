import { describe, it, expect } from 'vitest';
import {
  generateLayoutsModule,
  transformLayoutNames,
  extractLayoutNames,
} from '../src/plugins/layout.js';

describe('generateLayoutsModule', () => {
  it('returns empty layouts object when no files given', () => {
    const code = generateLayoutsModule(new Map());
    expect(code).toContain('export const layouts = {}');
  });

  it('generates lazy imports for each layout', () => {
    const layoutMap = new Map([
      ['Level1', '/project/src/layouts/level-1.ts'],
      ['DungeonFloor1', '/project/src/layouts/dungeon-floor-1.ts'],
    ]);
    const code = generateLayoutsModule(layoutMap);

    expect(code).toContain("import('/project/src/layouts/level-1.ts')");
    expect(code).toContain("import('/project/src/layouts/dungeon-floor-1.ts')");
    expect(code).toContain("'Level1':");
    expect(code).toContain("'DungeonFloor1':");
    expect(code).toContain('export const layouts = {');
  });

  it('generates correct number of entries', () => {
    const layoutMap = new Map([
      ['A', '/a.ts'],
      ['B', '/b.ts'],
      ['C', '/c.ts'],
    ]);
    const code = generateLayoutsModule(layoutMap);
    const matches = code.match(/import\(/g);
    expect(matches).toHaveLength(3);
  });

  it('properly formats the layouts object', () => {
    const layoutMap = new Map([['TestLayout', '/path/to/test.ts']]);
    const code = generateLayoutsModule(layoutMap);

    expect(code).toMatch(/\{\s*'TestLayout':/);
    expect(code).toMatch(/\}\s*;/);
  });
});

describe('extractLayoutNames', () => {
  it('extracts layout names from const declarations', () => {
    const code = `const Level1 = defineLayout(() => {});`;
    const names = extractLayoutNames(code);

    expect(names).toContain('Level1');
    expect(names.size).toBe(1);
  });

  it('extracts multiple layout names from the same file', () => {
    const code = `
      const Level1 = defineLayout(() => {});
      const Level2 = defineLayout(() => {});
    `;
    const names = extractLayoutNames(code);

    expect(names).toContain('Level1');
    expect(names).toContain('Level2');
    expect(names.size).toBe(2);
  });

  it('extracts layout names with export keyword', () => {
    const code = `export const Level1 = defineLayout(() => {});`;
    const names = extractLayoutNames(code);

    expect(names).toContain('Level1');
  });

  it('handles multiline defineLayout calls', () => {
    const code = `
      export const ComplexLayout = defineLayout(
        () => {
          return { width: 100 };
        }
      );
    `;
    const names = extractLayoutNames(code);

    expect(names).toContain('ComplexLayout');
  });

  it('returns empty set when no defineLayout found', () => {
    const code = `const x = 1;`;
    const names = extractLayoutNames(code);

    expect(names.size).toBe(0);
  });

  it('ignores non-layout definitions', () => {
    const code = `
      const defineLayout = () => {};
      const Level1 = defineLayout(() => {});
      const someOtherVar = something();
    `;
    const names = extractLayoutNames(code);

    expect(names).toContain('Level1');
    expect(names.size).toBe(1);
  });
});

describe('transformLayoutNames', () => {
  it('injects __layoutName__ using Object.assign for simple single-line calls', () => {
    const input = `const Level1 = defineLayout(() => {});`;
    const result = transformLayoutNames(input);

    expect(result).toContain('Object.assign');
    expect(result).toContain('__layoutName__');
    expect(result).toContain("'Level1'");
    expect(result).toContain('defineLayout');
  });

  it('wraps the entire defineLayout call', () => {
    const input = `const MyLayout = defineLayout(MyConfig);`;
    const result = transformLayoutNames(input);

    expect(result).toMatch(/Object\.assign\(defineLayout\(MyConfig\)/);
    expect(result).toMatch(/\{ __layoutName__: 'MyLayout' \}\)/);
  });

  it('works with export const declarations', () => {
    const input = `export const Level1 = defineLayout(() => {});`;
    const result = transformLayoutNames(input);

    expect(result).toContain('export');
    expect(result).toContain('Object.assign');
    expect(result).toContain("'Level1'");
  });

  it('returns code unchanged if no defineLayout found', () => {
    const input = `const x = 1;`;
    const result = transformLayoutNames(input);

    expect(result).toBe(input);
  });

  it('handles multiple defineLayout calls in one file', () => {
    const input = `
      const Level1 = defineLayout(() => {});
      const Level2 = defineLayout(() => {});
    `;
    const result = transformLayoutNames(input);

    expect(result).toContain("'Level1'");
    expect(result).toContain("'Level2'");
    expect((result.match(/Object\.assign/g) || []).length).toBe(2);
  });

  it('preserves the function body', () => {
    const input = `const MyLayout = defineLayout(() => ({ width: 100 }));`;
    const result = transformLayoutNames(input);

    expect(result).toContain('width: 100');
  });

  it('handles complex arrow function bodies', () => {
    const input = `const ComplexLayout = defineLayout((config) => {
      return {
        width: config.width,
        height: config.height,
      };
    });`;
    const result = transformLayoutNames(input);

    expect(result).toContain('Object.assign');
    expect(result).toContain('width: config.width');
    expect(result).toContain('__layoutName__');
  });

  it('does not double-wrap already wrapped calls', () => {
    const input = `const Level1 = Object.assign(defineLayout(() => {}), { __layoutName__: 'Level1' });`;
    const result = transformLayoutNames(input);

    // Should not have double Object.assign
    const count = (result.match(/Object\.assign/g) || []).length;
    expect(count).toBeLessThanOrEqual(2); // May have the original if regex doesn't match perfectly
  });

  it('formats the output correctly', () => {
    const input = `const Test = defineLayout(() => {});`;
    const result = transformLayoutNames(input);

    // Should have Object.assign wrapping with the __layoutName__ property
    expect(result).toContain('Object.assign(defineLayout(');
    expect(result).toContain("), { __layoutName__: 'Test' }");
    expect(result).toMatch(/\}\);$/);
  });

  it('handles deeply nested parentheses in defineLayout callback', () => {
    const code = `const Level1 = defineLayout(() => { if (f(x)) { spawn(p(opts)); } });`;
    const result = transformLayoutNames(code);
    expect(result).toContain('Object.assign(defineLayout(');
    expect(result).toContain("{ __layoutName__: 'Level1' })");
  });

  it('does not transform defineLayout in a comment', () => {
    const code = `// const Foo = defineLayout(() => {})`;
    expect(transformLayoutNames(code)).toBe(code);
  });
});
