/**
 * Tests for loadRawGwenConfig — RFC-011 CJS/ESM interop fix.
 *
 * Covers the three wrapping depths that can arise from jiti + c12:
 *   1. No wrapping     — config IS the object
 *   2. Single wrap     — { default: config }
 *   3. Double wrap     — { default: { __esModule: true, default: config } }
 *      (the real-world case when jiti-register hook is active)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  const dir = join(tmpdir(), `gwen-cfg-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ─── resolveModule unwrap logic ───────────────────────────────────────────────
// We extract and test the resolveModule function's three-depth unwrap logic
// independently of c12 to verify correctness without requiring disk I/O.

type AnyRecord = Record<string, unknown>;

/** Mirrors the resolveModule implementation in config-loader.ts */
function unwrap(mod: unknown): unknown {
  const first = (mod as AnyRecord)?.['default'] ?? mod;
  const second = (first as AnyRecord)?.['default'] ?? first;
  return second ?? {};
}

describe('resolveModule unwrap logic', () => {
  const config = { modules: ['@gwenjs/physics2d'], engine: { maxEntities: 1000 } };

  it('case 1: no wrapping — returns the object as-is', () => {
    expect(unwrap(config)).toBe(config);
  });

  it('case 2: single wrap { default: config } — returns config', () => {
    expect(unwrap({ default: config })).toBe(config);
  });

  it('case 3: double wrap { default: { __esModule: true, default: config } } — returns config', () => {
    const doubleWrapped = { default: { __esModule: true, default: config } };
    expect(unwrap(doubleWrapped)).toBe(config);
  });

  it('handles null / undefined gracefully', () => {
    expect(unwrap(null)).toEqual({});
    expect(unwrap(undefined)).toEqual({});
  });

  it('handles empty object', () => {
    expect(unwrap({})).toEqual({});
  });
});

// ─── loadRawGwenConfig integration tests ─────────────────────────────────────

describe('loadRawGwenConfig', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('loads a simple export default config and returns modules', async () => {
    writeFileSync(
      join(tmpDir, 'gwen.config.ts'),
      `export default { modules: ['@gwenjs/input'], engine: { maxEntities: 500 } };`,
      'utf-8',
    );

    const { loadRawGwenConfig } = await import('../src/config-loader.js');
    const { config, configFile } = await loadRawGwenConfig(tmpDir);

    expect(configFile).toContain('gwen.config.ts');
    expect(config.modules).toEqual(['@gwenjs/input']);
    expect(config.engine?.maxEntities).toBe(500);
  });

  it('returns a configFile path', async () => {
    writeFileSync(join(tmpDir, 'gwen.config.ts'), `export default {};`, 'utf-8');

    const { loadRawGwenConfig } = await import('../src/config-loader.js');
    const { configFile } = await loadRawGwenConfig(tmpDir);

    expect(configFile).toMatch(/gwen\.config\.(ts|js|mjs|cjs)$/);
  });

  it('throws GwenConfigLoadError when no config file exists', async () => {
    const { loadRawGwenConfig, GwenConfigLoadError } = await import('../src/config-loader.js');

    await expect(loadRawGwenConfig(tmpDir)).rejects.toBeInstanceOf(GwenConfigLoadError);
  });

  it('GwenConfigLoadError has a descriptive message', async () => {
    const { loadRawGwenConfig } = await import('../src/config-loader.js');

    try {
      await loadRawGwenConfig(tmpDir);
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as Error).message).toMatch(/gwen\.config/i);
    }
  });
});
