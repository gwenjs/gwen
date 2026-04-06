/**
 * @file Tests for checkPluginApiVersion and GWEN_PLUGIN_API_VERSION.
 */

import { describe, it, expect, vi } from 'vitest';
import { checkPluginApiVersion, GWEN_PLUGIN_API_VERSION } from '../../src/engine/gwen-engine';

describe('checkPluginApiVersion', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns true when no gwen_plugin_api_version export exists', () => {
    const exports = {} as WebAssembly.Exports; // Empty exports
    const result = checkPluginApiVersion(exports, 'oldPlugin');
    expect(result).toBe(true);
  });

  it('returns true when version matches expectedVersion', () => {
    const exports = {
      gwen_plugin_api_version: () => 1_000_000,
    } as WebAssembly.Exports;
    const result = checkPluginApiVersion(exports, 'myPlugin', 1_000_000);
    expect(result).toBe(true);
  });

  it('calls console.warn and returns false on mismatch with policy=warn', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const exports = {
      gwen_plugin_api_version: () => 1_002_003, // v1.2.3
    } as WebAssembly.Exports;

    const result = checkPluginApiVersion(
      exports,
      'myPlugin',
      1_000_000, // v1.0.0
      'warn',
    );

    expect(result).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      '[GWEN] Plugin "myPlugin" was compiled against API version 1002003 but engine expects 1000000.',
    );
  });

  it('throws on mismatch with policy=throw', () => {
    const exports = {
      gwen_plugin_api_version: () => 1_002_003, // v1.2.3
    } as WebAssembly.Exports;

    expect(() =>
      checkPluginApiVersion(
        exports,
        'myPlugin',
        1_000_000, // v1.0.0
        'throw',
      ),
    ).toThrow(
      '[GWEN] Plugin "myPlugin" was compiled against API version 1002003 but engine expects 1000000.',
    );
  });

  it('returns false silently on mismatch with policy=ignore', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const exports = {
      gwen_plugin_api_version: () => 1_002_003, // v1.2.3
    } as WebAssembly.Exports;

    const result = checkPluginApiVersion(
      exports,
      'myPlugin',
      1_000_000, // v1.0.0
      'ignore',
    );

    expect(result).toBe(false);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('uses GWEN_PLUGIN_API_VERSION as default expected version', () => {
    const exports = {
      gwen_plugin_api_version: () => GWEN_PLUGIN_API_VERSION,
    } as WebAssembly.Exports;

    const result = checkPluginApiVersion(exports, 'myPlugin'); // No expectedVersion provided

    expect(result).toBe(true);
  });

  it('uses "warn" as default policy when not specified', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const exports = {
      gwen_plugin_api_version: () => 2_000_000, // v2.0.0
    } as WebAssembly.Exports;

    const result = checkPluginApiVersion(exports, 'myPlugin', 1_000_000); // No policy provided

    expect(result).toBe(false);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('handles version encoding correctly (major * 1_000_000 + minor * 1_000 + patch)', () => {
    // v1.2.3 = 1*1_000_000 + 2*1_000 + 3 = 1_002_003
    const version123 = 1_002_003;
    const exports = {
      gwen_plugin_api_version: () => version123,
    } as WebAssembly.Exports;

    expect(checkPluginApiVersion(exports, 'plugin', version123)).toBe(true);
    expect(checkPluginApiVersion(exports, 'plugin', 1_002_004)).toBe(false);
    expect(checkPluginApiVersion(exports, 'plugin', 1_002_002)).toBe(false);
  });

  it('includes raw encoded integer versions in the warning message', () => {
    // v1.2.3 = 1_002_003
    // v2.3.4 = 2_003_004
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const exports = {
      gwen_plugin_api_version: () => 2_003_004,
    } as WebAssembly.Exports;

    checkPluginApiVersion(exports, 'testPlugin', 1_002_003, 'warn');

    expect(warnSpy).toHaveBeenCalledWith(
      '[GWEN] Plugin "testPlugin" was compiled against API version 2003004 but engine expects 1002003.',
    );
  });

  it('correctly types gwen_plugin_api_version as a function', () => {
    const exports = {
      gwen_plugin_api_version: () => 1_000_000,
      someOtherExport: 'not a function',
    } as WebAssembly.Exports;

    // This should not throw during version check
    const result = checkPluginApiVersion(exports, 'myPlugin', 1_000_000);
    expect(result).toBe(true);
  });

  it('ignores non-function gwen_plugin_api_version exports', () => {
    const exports = {
      gwen_plugin_api_version: 'not a function',
    } as WebAssembly.Exports;

    const result = checkPluginApiVersion(exports, 'myPlugin');
    expect(result).toBe(true); // Should return true as if no version export exists
  });
});

describe('GWEN_PLUGIN_API_VERSION', () => {
  it('is set to 1_000_000 (representing v1.0.0)', () => {
    expect(GWEN_PLUGIN_API_VERSION).toBe(1_000_000);
  });

  it('uses encoding: major * 1_000_000 + minor * 1_000 + patch', () => {
    // v1.0.0 = 1*1_000_000 + 0*1_000 + 0 = 1_000_000
    // oxlint-disable-next-line erasing-op
    expect(GWEN_PLUGIN_API_VERSION).toBe(1 * 1_000_000 + 0 * 1_000 + 0);
  });
});
