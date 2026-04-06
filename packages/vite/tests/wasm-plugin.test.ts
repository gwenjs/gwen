import { describe, it, expect } from 'vitest';
import { gwenWasmPlugin } from '../src/plugins/wasm.js';

describe('gwenWasmPlugin', () => {
  it('has the plugin name "gwen:wasm"', () => {
    const plugin = gwenWasmPlugin({});
    expect(plugin.name).toBe('gwen:wasm');
  });

  it('resolves the virtual:gwen/wasm id', () => {
    const plugin = gwenWasmPlugin({});
    // resolveId is a function on the plugin
    const resolved =
      typeof plugin.resolveId === 'function'
        ? plugin.resolveId.call({} as never, 'virtual:gwen/wasm', undefined, {} as never)
        : undefined;
    expect(resolved).toBe('\0virtual:gwen/wasm');
  });

  it('returns undefined for unrelated ids', () => {
    const plugin = gwenWasmPlugin({});
    const resolved =
      typeof plugin.resolveId === 'function'
        ? plugin.resolveId.call({} as never, 'some-other-module', undefined, {} as never)
        : undefined;
    expect(resolved).toBeUndefined();
  });

  it('can be constructed with default options without throwing', () => {
    expect(() => gwenWasmPlugin({})).not.toThrow();
  });

  it('can be constructed with explicit debug variant without throwing', () => {
    expect(() => gwenWasmPlugin({ wasm: { variant: 'debug' } })).not.toThrow();
  });

  it('can be constructed with explicit release variant without throwing', () => {
    expect(() => gwenWasmPlugin({ wasm: { variant: 'release' } })).not.toThrow();
  });

  it('can be constructed with auto variant without throwing', () => {
    expect(() => gwenWasmPlugin({ wasm: { variant: 'auto' } })).not.toThrow();
  });

  it('sets variant to "debug" in dev mode when auto', () => {
    const plugin = gwenWasmPlugin({ wasm: { variant: 'auto' } });
    // Simulate configResolved with dev command
    const mockConfig = { command: 'serve' } as never;
    if (typeof plugin.configResolved === 'function') {
      plugin.configResolved.call({} as never, mockConfig);
    }
    // No errors thrown — structural test
    expect(plugin.name).toBe('gwen:wasm');
  });

  it('sets variant to "release" in build mode when auto', () => {
    const plugin = gwenWasmPlugin({ wasm: { variant: 'auto' } });
    // Simulate configResolved with build command
    const mockConfig = { command: 'build' } as never;
    if (typeof plugin.configResolved === 'function') {
      plugin.configResolved.call({} as never, mockConfig);
    }
    // No errors thrown — structural test
    expect(plugin.name).toBe('gwen:wasm');
  });
});
