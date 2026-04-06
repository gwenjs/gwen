import { describe, it, expect } from 'vitest';
import { gwenOptimizerPlugin } from '../../src/plugins/optimizer';

describe('gwenOptimizerPlugin', () => {
  it('returns a Vite plugin with name gwen:optimizer', () => {
    const plugin = gwenOptimizerPlugin();
    expect(plugin.name).toBe('gwen:optimizer');
  });

  it('accepts debug option', () => {
    const plugin = gwenOptimizerPlugin({ debug: true });
    expect(plugin.name).toBe('gwen:optimizer');
  });

  it('has a transform hook', () => {
    const plugin = gwenOptimizerPlugin();
    expect(typeof plugin.transform).toBe('function');
  });

  it('does not transform non-ts files', async () => {
    const plugin = gwenOptimizerPlugin();
    const result = await (plugin.transform as Function)('const x = 1', 'file.css');
    expect(result).toBeNull();
  });
});
