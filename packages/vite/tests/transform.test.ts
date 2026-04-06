import { describe, it, expect, vi } from 'vitest';
import { gwenTransform } from '../src/transform';

describe('gwenTransform() RFC-008 foundation', () => {
  it('returns a Vite pre plugin named gwen-transform', () => {
    const plugin = gwenTransform();
    expect(plugin.name).toBe('gwen-transform');
    expect(plugin.enforce).toBe('pre');
    expect(typeof plugin.transform).toBe('function');
  });

  it('ignores node_modules by default', () => {
    const plugin = gwenTransform();
    const out = (plugin.transform as Function)(
      'export const x = 1;',
      '/repo/node_modules/pkg/index.ts',
    );
    expect(out).toBeNull();
  });

  it('ignores non-js/ts files by default', () => {
    const plugin = gwenTransform();
    const out = (plugin.transform as Function)('body { color: red; }', '/repo/src/style.css');
    expect(out).toBeNull();
  });

  it('accepts matching TS source and remains no-op by default', () => {
    const plugin = gwenTransform();
    const out = (plugin.transform as Function)('export const x = 1;', '/repo/src/game/system.ts');
    expect(out).toBeNull();
  });

  it('injects auto-imports when enabled and symbols are used', () => {
    const plugin = gwenTransform({ autoImports: true });
    const out = (plugin.transform as Function)(
      'const Position = defineComponent({ name: "Position", schema: { x: Types.f32 } });',
      '/repo/src/components/position.ts',
    );

    expect(out).not.toBeNull();
    expect(out.code).toContain("import { defineComponent, Types } from '@gwenjs/core';");
  });

  it('does not inject auto-import if core import already exists', () => {
    const plugin = gwenTransform({ autoImports: true });
    const source = [
      "import { defineSystem } from '@gwenjs/core';",
      'export const S = defineSystem({ name: "S", onUpdate() {} });',
    ].join('\n');
    const out = (plugin.transform as Function)(source, '/repo/src/systems/s.ts');
    expect(out).toBeNull();
  });

  it('merges missing named imports into existing core named import', () => {
    const plugin = gwenTransform({ autoImports: true });
    const source = [
      "import { defineSystem } from '@gwenjs/core';",
      'const Position = defineComponent({ name: "Position", schema: { x: Types.f32 } });',
      'export const S = defineSystem({ name: "S", onUpdate() {} });',
    ].join('\n');

    const out = (plugin.transform as Function)(source, '/repo/src/systems/s.ts');
    expect(out).not.toBeNull();
    expect(out.code).toContain(
      "import { defineSystem, defineComponent, Types } from '@gwenjs/core';",
    );
  });

  it('does NOT inject value specifiers into an existing import type declaration', () => {
    const plugin = gwenTransform({ autoImports: true });
    const source = [
      "import type { GwenPlugin } from '@gwenjs/core';",
      'defineSystem({ name: "S" });',
    ].join('\n');
    const out = (plugin.transform as Function)(source, '/repo/src/systems/s.ts');
    expect(out).not.toBeNull();
    // Should add a new value import, NOT modify the type import
    expect(out.code).toContain("import type { GwenPlugin } from '@gwenjs/core'");
    expect(out.code).toContain("import { defineSystem } from '@gwenjs/core'");
    expect(out.code).not.toContain('import type { GwenPlugin, defineSystem }');
  });

  it('adds a dedicated named import when only default core import exists', () => {
    const plugin = gwenTransform({ autoImports: true });
    const source = [
      "import Gwen from '@gwenjs/core';",
      'const Position = defineComponent({ name: "Position", schema: { x: Types.f32 } });',
      'console.log(Gwen);',
    ].join('\n');

    const out = (plugin.transform as Function)(source, '/repo/src/components/c.ts');
    expect(out).not.toBeNull();
    expect(out.code).toContain(
      "import Gwen from '@gwenjs/core';\nimport { defineComponent, Types } from '@gwenjs/core';",
    );
  });

  it('rewrites literal query arrays to as const when compileSystems is enabled', () => {
    const plugin = gwenTransform({ compileSystems: true });
    const out = (plugin.transform as Function)(
      'export const S = defineSystem({ name: "S", query: [Position, Velocity], onUpdate() {} });',
      '/repo/src/systems/s.ts',
    );
    expect(out).not.toBeNull();
    expect(out.code).toContain('query: [Position, Velocity] as const');
  });

  it('does not duplicate as const when already present', () => {
    const plugin = gwenTransform({ compileSystems: true });
    const source = 'export const S = defineSystem({ query: [Position] as const });';
    const out = (plugin.transform as Function)(source, '/repo/src/systems/s.ts');
    expect(out).toBeNull();
  });

  it('rewrites simple schema objects to as const when compileComponents is enabled', () => {
    const plugin = gwenTransform({ compileComponents: true });
    const out = (plugin.transform as Function)(
      'export const Position = defineComponent({ name: "Position", schema: { x: Types.f32, y: Types.f32 } });',
      '/repo/src/components/position.ts',
    );
    expect(out).not.toBeNull();
    expect(out.code).toContain('schema: { x: Types.f32, y: Types.f32 } as const');
  });

  it('does not duplicate schema as const when already present', () => {
    const plugin = gwenTransform({ compileComponents: true });
    const source =
      'export const Position = defineComponent({ schema: { x: Types.f32 } as const, name: "P" });';
    const out = (plugin.transform as Function)(source, '/repo/src/components/p.ts');
    expect(out).toBeNull();
  });

  it('rewrites nested schema objects to as const', () => {
    const plugin = gwenTransform({ compileComponents: true });
    const source =
      'export const T = defineComponent({ name: "T", schema: { position: Types.vec3, nested: { x: Types.f32 } } });';
    const out = (plugin.transform as Function)(source, '/repo/src/components/t.ts');
    expect(out).not.toBeNull();
    expect(out.code).toContain(
      'schema: { position: Types.vec3, nested: { x: Types.f32 } } as const',
    );
  });

  it('does not rewrite non-object schema values', () => {
    const plugin = gwenTransform({ compileComponents: true });
    const source = 'export const T = defineComponent({ name: "T", schema: Types.vec3 });';
    const out = (plugin.transform as Function)(source, '/repo/src/components/t.ts');
    expect(out).toBeNull();
  });

  // ─── Edge cases — multiline query arrays ────────────────────────────────────

  it('rewrites multiline query arrays to as const', () => {
    const plugin = gwenTransform({ compileSystems: true });
    const source = [
      'export const S = defineSystem({',
      '  name: "S",',
      '  query: [',
      '    Position,',
      '    Velocity,',
      '  ],',
      '  onUpdate() {}',
      '});',
    ].join('\n');
    const out = (plugin.transform as Function)(source, '/repo/src/systems/s.ts');
    expect(out).not.toBeNull();
    expect(out.code).toContain('] as const');
  });

  it('does not duplicate as const on multiline query array already present', () => {
    const plugin = gwenTransform({ compileSystems: true });
    const source = [
      'export const S = defineSystem({',
      '  query: [',
      '    Position,',
      '    Velocity,',
      '  ] as const,',
      '});',
    ].join('\n');
    const out = (plugin.transform as Function)(source, '/repo/src/systems/s.ts');
    expect(out).toBeNull();
  });

  it('rewrites query array with string-based component type names', () => {
    const plugin = gwenTransform({ compileSystems: true });
    const source = 'const S = defineSystem({ query: ["position", "velocity"], onUpdate() {} });';
    const out = (plugin.transform as Function)(source, '/repo/src/systems/s.ts');
    expect(out).not.toBeNull();
    expect(out.code).toContain('query: ["position", "velocity"] as const');
  });

  it('rewrites multiple query arrays in the same file', () => {
    const plugin = gwenTransform({ compileSystems: true });
    const source = [
      'const A = defineSystem({ query: [Position], onUpdate() {} });',
      'const B = defineSystem({ query: [Velocity, Health], onUpdate() {} });',
    ].join('\n');
    const out = (plugin.transform as Function)(source, '/repo/src/systems/s.ts');
    expect(out).not.toBeNull();
    expect(out.code).toContain('query: [Position] as const');
    expect(out.code).toContain('query: [Velocity, Health] as const');
  });

  // ─── Edge cases — mixed imports ───────────────────────────────────────────────

  it('handles autoImports + compileSystems together', () => {
    const plugin = gwenTransform({ autoImports: true, compileSystems: true });
    const source = 'const S = defineSystem({ name: "S", query: [Position], onUpdate() {} });';
    const out = (plugin.transform as Function)(source, '/repo/src/systems/s.ts');
    expect(out).not.toBeNull();
    expect(out.code).toContain("import { defineSystem } from '@gwenjs/core'");
    expect(out.code).toContain('query: [Position] as const');
  });

  it('handles autoImports + compileComponents together', () => {
    const plugin = gwenTransform({ autoImports: true, compileComponents: true });
    const source = 'const P = defineComponent({ name: "P", schema: { x: Types.f32 } });';
    const out = (plugin.transform as Function)(source, '/repo/src/components/p.ts');
    expect(out).not.toBeNull();
    expect(out.code).toContain("import { defineComponent, Types } from '@gwenjs/core'");
    expect(out.code).toContain('schema: { x: Types.f32 } as const');
  });

  it('uses custom include/exclude predicates', () => {
    const include = vi.fn((id: string) => id.endsWith('.my.ts'));
    const exclude = vi.fn(() => false);

    const plugin = gwenTransform({ include, exclude });
    const transform = plugin.transform as Function;

    expect(transform('export const ok = true;', '/repo/src/a.ts')).toBeNull();
    expect(transform('export const ok = true;', '/repo/src/a.my.ts')).toBeNull();

    expect(include).toHaveBeenCalledTimes(2);
    expect(exclude).toHaveBeenCalledTimes(2);
  });
});

// ─── Edge cases that AST handles correctly but regex/bracket scanning can't ──

describe('gwenTransform() — AST edge cases', () => {
  it('does NOT rewrite query inside a line comment', () => {
    const plugin = gwenTransform({ compileSystems: true });
    const source = [
      '// query: [Position, Velocity]',
      'export const S = defineSystem({ name: "S", onUpdate() {} });',
    ].join('\n');
    const out = (plugin.transform as Function)(source, '/repo/src/systems/s.ts');
    expect(out).toBeNull();
  });

  it('does NOT rewrite query inside a block comment', () => {
    const plugin = gwenTransform({ compileSystems: true });
    const source = [
      '/* query: [Position] */',
      'export const S = defineSystem({ name: "S", onUpdate() {} });',
    ].join('\n');
    const out = (plugin.transform as Function)(source, '/repo/src/systems/s.ts');
    expect(out).toBeNull();
  });

  it('does NOT rewrite query inside a string literal', () => {
    const plugin = gwenTransform({ compileSystems: true });
    const source = 'const doc = "usage: query: [Position]";';
    const out = (plugin.transform as Function)(source, '/repo/src/systems/s.ts');
    expect(out).toBeNull();
  });

  it('does NOT rewrite schema inside a template literal', () => {
    const plugin = gwenTransform({ compileComponents: true });
    const source = 'const msg = `schema: { x: ${Types.f32} }`;';
    const out = (plugin.transform as Function)(source, '/repo/src/components/c.ts');
    expect(out).toBeNull();
  });

  it('rewrites query when preceded by a comment on the same line', () => {
    const plugin = gwenTransform({ compileSystems: true });
    const source =
      'export const S = defineSystem({ /* opts */ query: [Position], onUpdate() {} });';
    const out = (plugin.transform as Function)(source, '/repo/src/systems/s.ts');
    expect(out).not.toBeNull();
    expect(out.code).toContain('query: [Position] as const');
  });

  it('returns a proper sourcemap (not null)', () => {
    const plugin = gwenTransform({ compileSystems: true });
    const out = (plugin.transform as Function)(
      'const S = defineSystem({ query: [Position] });',
      '/repo/src/systems/s.ts',
    );
    expect(out).not.toBeNull();
    expect(out.map).not.toBeNull();
    expect(typeof out.map).toBe('object');
  });
});
