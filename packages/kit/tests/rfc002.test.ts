/**
 * RFC-002: satisfiesPluginContract, definePluginTypes tests
 * (definePlugin uses the existing class-based factory, which is the current implementation)
 */
import { describe, it, expect } from 'vitest';
import { definePlugin, satisfiesPluginContract, definePluginTypes } from '../src/index';

describe('definePlugin', () => {
  it('returns a callable constructor', () => {
    const Factory = definePlugin(() => ({ name: 'p', setup() {} }));
    expect(typeof Factory).toBe('function');
  });

  it('creates plugin with correct name', () => {
    const Factory = definePlugin(() => ({ name: 'Noop', setup() {} }));
    const plugin = new Factory() as { name: string };
    expect(plugin.name).toBe('Noop');
  });

  it('passes options to closure', () => {
    const Factory = definePlugin((opts: { value: number }) => ({
      name: 'WithOpts',
      setup() {},
      provides: { result: opts.value } as unknown as Record<string, unknown>,
    }));
    const plugin = new Factory({ value: 42 }) as { provides: Record<string, unknown> };
    expect(plugin.provides?.['result']).toBe(42);
  });
});

describe('satisfiesPluginContract', () => {
  it('is a runtime no-op — returns its argument', () => {
    const plugin = { name: 'p', setup() {} };
    const result = satisfiesPluginContract(plugin);
    expect(result).toBe(plugin);
  });
});

describe('definePluginTypes', () => {
  it('generates declaration merging with provides', () => {
    const output = definePluginTypes({ provides: { physics2d: 'Physics2DAPI' } });
    expect(output).toContain("declare module '@gwenjs/core'");
    expect(output).toContain('interface GwenProvides');
    expect(output).toContain('physics2d: Physics2DAPI');
  });

  it('starts with export {} to ensure module augmentation (not ambient replacement)', () => {
    const output = definePluginTypes({ provides: { foo: 'FooAPI' } });
    expect(output.trimStart()).toMatch(/^export \{\}/);
  });

  it('generates declaration merging with hooks', () => {
    const output = definePluginTypes({
      hooks: { 'physics2d:step': '(dt: number) => void' },
    });
    expect(output).toContain('interface GwenRuntimeHooks');
    expect(output).toContain("'physics2d:step'");
  });

  it('returns empty string when options are empty', () => {
    expect(definePluginTypes({})).toBe('');
  });

  it('includes both provides and hooks when both specified', () => {
    const output = definePluginTypes({
      provides: { foo: 'FooAPI' },
      hooks: { 'foo:event': '() => void' },
    });
    expect(output).toContain('GwenProvides');
    expect(output).toContain('GwenRuntimeHooks');
  });

  it('includes import statements when imports option is provided', () => {
    const output = definePluginTypes({
      imports: ["import type { MyAPI } from '@gwenjs/my-pkg'"],
      provides: { my: 'MyAPI' },
    });
    expect(output).toContain("import type { MyAPI } from '@gwenjs/my-pkg'");
    expect(output).toContain('my: MyAPI');
  });
});
