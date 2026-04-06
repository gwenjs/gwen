/**
 * @file Browser safety tests for @gwenjs/app
 *
 * Verifies that the main browser entry (src/index.ts) and src/types.ts have
 * no transitive Node.js-only dependencies (c12, node:fs, etc.).
 *
 * Regression tests for: ReferenceError: process is not defined (c12 in browser)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC = resolve(__dirname, '../src');

function readSrc(file: string): string {
  return readFileSync(resolve(SRC, file), 'utf-8');
}

// ─── types.ts ─────────────────────────────────────────────────────────────────

describe('src/types.ts — browser-safe', () => {
  const src = readSrc('types.ts');

  it('does not import c12', () => {
    expect(src).not.toContain("from 'c12'");
    expect(src).not.toContain('from "c12"');
  });

  it('does not import node:fs or node:path', () => {
    expect(src).not.toMatch(/from ['"]node:/);
  });

  it('exports defineConfig', () => {
    expect(src).toContain('export function defineConfig');
  });

  it('exports GwenUserConfig interface', () => {
    expect(src).toContain('export interface GwenUserConfig');
  });

  it('exports ResolvedGwenConfig type', () => {
    expect(src).toContain('export type ResolvedGwenConfig');
  });
});

// ─── index.ts ─────────────────────────────────────────────────────────────────

describe('src/index.ts — browser-safe entry point', () => {
  const src = readSrc('index.ts');

  it('does not import directly from ./config', () => {
    // Should import from ./types, not ./config (which has c12)
    expect(src).not.toMatch(/from ['"]\.\/config['"]/);
  });

  it('imports defineConfig from ./types', () => {
    expect(src).toMatch(/from ['"]\.\/types['"]/);
  });

  it('does not reference c12', () => {
    // Allow mention in JSDoc comments, but must not import c12
    expect(src).not.toMatch(/import\s+.*from\s+['"]c12['"]/);
    expect(src).not.toMatch(/require\(['"]c12['"]\)/);
  });
});

// ─── config.ts ────────────────────────────────────────────────────────────────

describe('src/config.ts — Node.js only (must stay out of browser bundle)', () => {
  const src = readSrc('config.ts');

  it('does NOT export defineConfig (moved to types.ts)', () => {
    expect(src).not.toContain('export function defineConfig');
  });

  it('imports types from ./types, not re-defining them', () => {
    expect(src).toMatch(/from ['"]\.\/types['"]/);
  });
});

// ─── config-loader.ts ─────────────────────────────────────────────────────────

describe('src/config-loader.ts — Node.js only (contains c12 interop)', () => {
  const src = readSrc('config-loader.ts');

  it('imports c12 (this is correct — it is Node.js only)', () => {
    expect(src).toMatch(/from ['"]c12['"]/);
  });

  it('imports node:fs (Node.js only, correct)', () => {
    expect(src).toMatch(/from ['"]node:fs['"]/);
  });

  it('exports loadRawGwenConfig', () => {
    expect(src).toContain('export async function loadRawGwenConfig');
  });

  it('exports GwenConfigLoadError', () => {
    expect(src).toContain('export class GwenConfigLoadError');
  });
});

// ─── defineConfig functional test ─────────────────────────────────────────────

describe('defineConfig — identity function', () => {
  it('returns the config object unchanged', async () => {
    const { defineConfig } = await import('../src/types.js');
    const cfg = { modules: ['@gwenjs/input'], engine: { maxEntities: 100 } };
    expect(defineConfig(cfg)).toBe(cfg);
  });

  it('is also exported from src/index.ts', async () => {
    const { defineConfig } = await import('../src/index.js');
    expect(typeof defineConfig).toBe('function');
    const cfg = { modules: [] };
    expect(defineConfig(cfg)).toBe(cfg);
  });
});
