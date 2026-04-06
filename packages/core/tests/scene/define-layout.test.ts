/**
 * @file Tests for defineLayout.ts — layout factory definition.
 *
 * Tests that defineLayout() correctly creates a LayoutDefinition and that
 * the factory is not called until explicitly invoked.
 */

import { describe, it, expect } from 'vitest';
import { defineLayout } from '../../src/scene/define-layout.js';
import { placeGroup } from '../../src/scene/place.js';

describe('defineLayout', () => {
  it('returns a LayoutDefinition with _factory and __layoutName__', () => {
    const Layout = defineLayout(() => ({}));
    expect(typeof Layout._factory).toBe('function');
    expect(typeof Layout.__layoutName__).toBe('string');
  });

  it('sets __layoutName__ to "anonymous" by default', () => {
    const Layout = defineLayout(() => ({}));
    expect(Layout.__layoutName__).toBe('anonymous');
  });

  it('factory is not called immediately on defineLayout()', () => {
    let called = false;
    defineLayout(() => {
      called = true;
      return {};
    });
    expect(called).toBe(false);
  });

  it('factory can be called and returns correct type', () => {
    const Layout = defineLayout(() => ({ foo: 'bar' }));
    const result = Layout._factory();
    expect(result).toEqual({ foo: 'bar' });
  });

  it('throws if placement composables are called outside the factory', () => {
    expect(() => placeGroup({ at: [0, 0] })).toThrow(/defineLayout/);
  });
});
