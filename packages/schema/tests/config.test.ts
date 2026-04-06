/**
 * GWEN Schema Configuration Tests
 *
 * Tests for configuration defaults, merging, and validation.
 */

import { describe, it, expect } from 'vitest';
import {
  defaultOptions,
  resolveConfig,
  validateResolvedConfig,
  assertModuleFirstInput,
} from '../src';
import type { GwenConfigInput, GwenPluginBase } from '../src';

describe('@gwenjs/schema - Configuration', () => {
  describe('defaultOptions', () => {
    it('should have all required default properties', () => {
      expect(defaultOptions.engine.maxEntities).toBe(5000);
      expect(defaultOptions.engine.targetFPS).toBe(60);
      expect(defaultOptions.engine.debug).toBe(false);
      expect(defaultOptions.engine.enableStats).toBe(true);
      expect(defaultOptions.engine.loop).toBe('internal');
      expect(defaultOptions.engine.maxDeltaSeconds).toBe(0.1);
      expect(defaultOptions.html.title).toBe('GWEN Project');
      expect(defaultOptions.html.background).toBe('#000000');
      expect(defaultOptions.modules).toEqual([]);
      expect(defaultOptions.plugins).toEqual([]);
      expect(defaultOptions.scenes).toEqual([]);
      expect(defaultOptions.scenesMode).toBe('auto');
      expect(defaultOptions.srcDir).toBe('src');
      expect(defaultOptions.outDir).toBe('dist');
    });
  });

  describe('resolveConfig', () => {
    it('should apply defaults on empty config', () => {
      const config = resolveConfig({});
      expect(config.engine.maxEntities).toBe(5000);
      expect(config.engine.targetFPS).toBe(60);
      expect(config.srcDir).toBe('src');
      expect(config.outDir).toBe('dist');
    });

    it('should merge user config with defaults', () => {
      const config = resolveConfig({
        engine: { maxEntities: 10_000 },
        html: { title: 'My Game' },
      });
      expect(config.engine.maxEntities).toBe(10_000);
      expect(config.engine.targetFPS).toBe(60); // from default
      expect(config.engine.loop).toBe('internal'); // from default
      expect(config.html.title).toBe('My Game');
      expect(config.html.background).toBe('#000000'); // from default
    });

    it('should preserve engine loop and maxDeltaSeconds when provided', () => {
      const config = resolveConfig({
        engine: { loop: 'external', maxDeltaSeconds: 0.05 },
      });
      expect(config.engine.loop).toBe('external');
      expect(config.engine.maxDeltaSeconds).toBe(0.05);
    });

    it('should unify legacy tsPlugins into plugins array', () => {
      const plugin: GwenPluginBase = { name: 'test-plugin' };
      const input: GwenConfigInput = {
        tsPlugins: [plugin],
      };
      const config = resolveConfig(input);
      expect(config.plugins).toContain(plugin);
    });

    it('should unify legacy wasmPlugins into plugins array', () => {
      const plugin: GwenPluginBase = { name: 'wasm-plugin', wasm: {} };
      const input: GwenConfigInput = {
        wasmPlugins: [plugin],
      };
      const config = resolveConfig(input);
      expect(config.plugins).toContain(plugin);
    });

    it('should merge tsPlugins and wasmPlugins together', () => {
      const tsPlugin: GwenPluginBase = { name: 'ts-plugin' };
      const wasmPlugin: GwenPluginBase = { name: 'wasm-plugin', wasm: {} };
      const input: GwenConfigInput = {
        tsPlugins: [tsPlugin],
        wasmPlugins: [wasmPlugin],
      };
      const config = resolveConfig(input);
      expect(config.plugins).toHaveLength(2);
      expect(config.plugins).toContain(tsPlugin);
      expect(config.plugins).toContain(wasmPlugin);
    });

    it('should preserve modules if provided', () => {
      const config = resolveConfig({
        modules: ['@gwenjs/input', ['@gwenjs/audio', { masterVolume: 0.8 }]],
      });
      expect(config.modules).toEqual(['@gwenjs/input', ['@gwenjs/audio', { masterVolume: 0.8 }]]);
    });

    it('should preserve mainScene if provided', () => {
      const config = resolveConfig({
        mainScene: 'MainMenu',
      });
      expect(config.mainScene).toBe('MainMenu');
    });

    it('should validate the resolved config', () => {
      expect(() => {
        resolveConfig({
          engine: { maxEntities: 50 }, // Too small
        });
      }).toThrow('maxEntities must be between 100 and 1000000');
    });
  });

  describe('validateResolvedConfig', () => {
    it('should accept valid config', () => {
      const config = validateResolvedConfig({
        ...defaultOptions,
      });
      expect(config).toBeDefined();
    });

    it('should reject maxEntities below minimum', () => {
      expect(() => {
        validateResolvedConfig({
          ...defaultOptions,
          engine: { ...defaultOptions.engine, maxEntities: 50 },
        });
      }).toThrow('maxEntities must be between 100 and 1000000');
    });

    it('should reject maxEntities above maximum', () => {
      expect(() => {
        validateResolvedConfig({
          ...defaultOptions,
          engine: { ...defaultOptions.engine, maxEntities: 10_000_000 },
        });
      }).toThrow('maxEntities must be between 100 and 1000000');
    });

    it('should reject non-integer maxEntities', () => {
      expect(() => {
        validateResolvedConfig({
          ...defaultOptions,
          engine: { ...defaultOptions.engine, maxEntities: 100.5 },
        });
      }).toThrow('maxEntities must be between 100 and 1000000');
    });

    it('should reject targetFPS below minimum', () => {
      expect(() => {
        validateResolvedConfig({
          ...defaultOptions,
          engine: { ...defaultOptions.engine, targetFPS: 20 },
        });
      }).toThrow('targetFPS must be between 30 and 240');
    });

    it('should reject targetFPS above maximum', () => {
      expect(() => {
        validateResolvedConfig({
          ...defaultOptions,
          engine: { ...defaultOptions.engine, targetFPS: 300 },
        });
      }).toThrow('targetFPS must be between 30 and 240');
    });

    it('should reject invalid background color', () => {
      expect(() => {
        validateResolvedConfig({
          ...defaultOptions,
          html: { ...defaultOptions.html, background: 'red' },
        });
      }).toThrow('background must be a valid hex color');
    });

    it('should accept valid hex colors (6 digit)', () => {
      const config = validateResolvedConfig({
        ...defaultOptions,
        html: { ...defaultOptions.html, background: '#ffffff' },
      });
      expect(config.html.background).toBe('#ffffff');
    });

    it('should accept valid hex colors (3 digit)', () => {
      const config = validateResolvedConfig({
        ...defaultOptions,
        html: { ...defaultOptions.html, background: '#fff' },
      });
      expect(config.html.background).toBe('#fff');
    });

    it('should reject invalid hex color format', () => {
      expect(() => {
        validateResolvedConfig({
          ...defaultOptions,
          html: { ...defaultOptions.html, background: '#gggggg' },
        });
      }).toThrow('background must be a valid hex color');
    });

    it('should reject if plugins is not an array', () => {
      expect(() => {
        validateResolvedConfig({
          ...defaultOptions,
          plugins: {} as unknown as GwenPluginBase[],
        });
      }).toThrow('plugins must be an array');
    });

    it('should reject if modules is not an array', () => {
      expect(() => {
        validateResolvedConfig({
          ...defaultOptions,
          modules: {} as unknown as (typeof defaultOptions)['modules'],
        });
      }).toThrow('modules must be an array');
    });

    it('should reject invalid module tuple options', () => {
      expect(() => {
        validateResolvedConfig({
          ...defaultOptions,
          modules: [['@gwenjs/input', 'invalid-options' as unknown as Record<string, unknown>]],
        });
      }).toThrow('modules[0] must be a string or a [name, options] tuple with object options');
    });

    it('should reject invalid engine.loop value', () => {
      expect(() => {
        validateResolvedConfig({
          ...defaultOptions,
          engine: {
            ...defaultOptions.engine,
            loop: 'manual' as unknown as (typeof defaultOptions.engine)['loop'],
          },
        });
      }).toThrow("engine.loop must be 'internal' or 'external'");
    });

    it('should reject non-positive maxDeltaSeconds', () => {
      expect(() => {
        validateResolvedConfig({
          ...defaultOptions,
          engine: { ...defaultOptions.engine, maxDeltaSeconds: 0 },
        });
      }).toThrow('engine.maxDeltaSeconds must be > 0 and <= 1');
    });

    it('should reject too-large maxDeltaSeconds', () => {
      expect(() => {
        validateResolvedConfig({
          ...defaultOptions,
          engine: { ...defaultOptions.engine, maxDeltaSeconds: 2 },
        });
      }).toThrow('engine.maxDeltaSeconds must be > 0 and <= 1');
    });
  });

  describe('assertModuleFirstInput', () => {
    it('accepts module-first input', () => {
      expect(() => {
        assertModuleFirstInput({
          modules: ['@gwenjs/input'],
        });
      }).not.toThrow();
    });

    it('accepts empty input', () => {
      expect(() => {
        assertModuleFirstInput({});
      }).not.toThrow();
    });

    it('rejects legacy plugin-only input', () => {
      expect(() => {
        assertModuleFirstInput({
          plugins: [{ name: 'legacy-plugin' }],
        });
      }).toThrow('Module-first configuration required');
    });
  });
});
