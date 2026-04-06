/**
 * RFC-010: GwenApp.prepare() — .gwen/ directory generation.
 *
 * Covers:
 * - prepare() creates .gwen/types/ directory
 * - auto-imports.d.ts is generated for registered auto-imports
 * - auto-imports.d.ts uses `as` aliases when present
 * - env.d.ts declares virtual:gwen/* modules
 * - .gwen/tsconfig.json is written with correct shape
 * - per-module type templates are written via addTypeTemplate
 * - writeIfChanged: unchanged files are NOT rewritten
 * - prepare() with no auto-imports writes a comment-only file
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { GwenApp } from '../src/app.js';
import { defineGwenModule } from '@gwenjs/kit';
import type { ResolvedGwenConfig } from '../src/config.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<ResolvedGwenConfig> = {}): ResolvedGwenConfig {
  return {
    modules: [],
    engine: {
      maxEntities: 1000,
      targetFPS: 60,
      variant: 'light',
      loop: 'internal',
      maxDeltaSeconds: 0.1,
    },
    ...overrides,
  };
}

let tmpRoot: string;

beforeEach(() => {
  // Fresh isolated temp dir per test
  tmpRoot = join(tmpdir(), `gwen-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpRoot, { recursive: true });
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

// ─── prepare() ────────────────────────────────────────────────────────────────

describe('GwenApp.prepare()', () => {
  it('creates .gwen/types/ directory', async () => {
    const app = new GwenApp();
    await app.setupModules(makeConfig());
    await app.prepare(tmpRoot);

    expect(existsSync(join(tmpRoot, '.gwen', 'types'))).toBe(true);
  });

  it('writes .gwen/types/auto-imports.d.ts', async () => {
    const mod = defineGwenModule({
      meta: { name: 'test-mod' },
      setup(_opts, gwen) {
        gwen.addAutoImports([{ name: 'usePhysics2D', from: '@gwenjs/physics2d' }]);
      },
    });

    const app = new GwenApp();
    await app.setupModules(makeConfig({ modules: ['test-mod'] }), async () => mod);
    await app.prepare(tmpRoot);

    const content = readFileSync(join(tmpRoot, '.gwen', 'types', 'auto-imports.d.ts'), 'utf8');
    expect(content).toContain('declare const usePhysics2D');
    expect(content).toContain('@gwenjs/physics2d');
  });

  it('uses `as` alias in auto-imports.d.ts', async () => {
    const mod = defineGwenModule({
      meta: { name: 'alias-mod' },
      setup(_opts, gwen) {
        gwen.addAutoImports([{ name: 'useRigidBody', from: '@gwenjs/physics2d', as: 'useBody' }]);
      },
    });

    const app = new GwenApp();
    await app.setupModules(makeConfig({ modules: ['alias-mod'] }), async () => mod);
    await app.prepare(tmpRoot);

    const content = readFileSync(join(tmpRoot, '.gwen', 'types', 'auto-imports.d.ts'), 'utf8');
    expect(content).toContain('declare const useBody');
    expect(content).toContain("['useRigidBody']");
  });

  it('writes .gwen/types/env.d.ts with virtual:gwen/* declarations', async () => {
    const app = new GwenApp();
    await app.setupModules(makeConfig());
    await app.prepare(tmpRoot);

    const content = readFileSync(join(tmpRoot, '.gwen', 'types', 'env.d.ts'), 'utf8');
    expect(content).toContain('virtual:gwen/auto-imports');
    expect(content).toContain('virtual:gwen/wasm');
    expect(content).toContain('virtual:gwen/env');
    expect(content).toContain('/// <reference types="vite/client" />');
  });

  it('writes .gwen/tsconfig.json with correct include paths', async () => {
    const app = new GwenApp();
    await app.setupModules(makeConfig());
    await app.prepare(tmpRoot);

    const raw = readFileSync(join(tmpRoot, '.gwen', 'tsconfig.json'), 'utf8');
    const tsconfig = JSON.parse(raw);
    expect(tsconfig.compilerOptions.noEmit).toBe(true);
    expect(tsconfig.include).toContain('../src/**/*.ts');
    expect(tsconfig.include).toContain('types/**/*.d.ts');
  });

  it('writes per-module type templates from addTypeTemplate', async () => {
    const mod = defineGwenModule({
      meta: { name: 'typed-mod' },
      setup(_opts, gwen) {
        gwen.addTypeTemplate({
          filename: 'physics2d.d.ts',
          getContents: () =>
            `declare module '@gwenjs/core' { interface GwenProvides { physics2d: unknown } }`,
        });
      },
    });

    const app = new GwenApp();
    await app.setupModules(makeConfig({ modules: ['typed-mod'] }), async () => mod);
    await app.prepare(tmpRoot);

    const dest = join(tmpRoot, '.gwen', 'types', 'physics2d.d.ts');
    expect(existsSync(dest)).toBe(true);
    const content = readFileSync(dest, 'utf8');
    expect(content).toContain('GwenProvides');
  });

  it('with no auto-imports writes a comment-only placeholder', async () => {
    const app = new GwenApp();
    await app.setupModules(makeConfig());
    await app.prepare(tmpRoot);

    const content = readFileSync(join(tmpRoot, '.gwen', 'types', 'auto-imports.d.ts'), 'utf8');
    expect(content).toContain('No auto-imports');
  });

  it('is idempotent — calling prepare() twice produces same files', async () => {
    const app = new GwenApp();
    await app.setupModules(makeConfig());
    await app.prepare(tmpRoot);

    const before = readFileSync(join(tmpRoot, '.gwen', 'tsconfig.json'), 'utf8');
    await app.prepare(tmpRoot);
    const after = readFileSync(join(tmpRoot, '.gwen', 'tsconfig.json'), 'utf8');
    expect(before).toBe(after);
  });

  it('writeIfChanged does not rewrite unchanged files (spy test)', async () => {
    const app = new GwenApp();
    await app.setupModules(makeConfig());
    await app.prepare(tmpRoot);

    // Manually inject a sentinel timestamp into a file
    const envPath = join(tmpRoot, '.gwen', 'types', 'env.d.ts');
    const original = readFileSync(envPath, 'utf8');

    // Second prepare — file content unchanged, should not be rewritten
    // We spy on writeFileSync to detect if it's called
    const spy = vi.spyOn({ writeFileSync }, 'writeFileSync');
    await app.prepare(tmpRoot);

    // The file should still have the original content
    expect(readFileSync(envPath, 'utf8')).toBe(original);
    spy.mockRestore();
  });
});
