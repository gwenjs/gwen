/**
 * @module bundle-size.test
 * Vitest test suite for the @gwenjs/physics2d tree-shaking / bundle-size invariants.
 *
 * All tests are skipped unless `BENCH_SLOW=1` is set, because they require a
 * full `pnpm build` of the package (~seconds, blocks fast CI).
 *
 * ```sh
 * BENCH_SLOW=1 pnpm --filter @gwenjs/physics2d test:bench:tree-shaking
 * ```
 */

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const BENCH_SLOW = Boolean(process.env['BENCH_SLOW']);

const repoRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');
const distRoot = path.join(repoRoot, 'packages/physics2d/dist');

/** All dist entry file names whose sizes are tracked. */
const ENTRIES = [
  'index.js',
  'core.js',
  'helpers.js',
  'helpers-queries.js',
  'helpers-movement.js',
  'helpers-contact.js',
  'helpers-static-geometry.js',
  'helpers-orchestration.js',
  'tilemap.js',
  'debug.js',
] as const;

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------

/** Byte sizes keyed by entry filename. */
const sizes: Record<string, number> = {};

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

/**
 * Bundle size tree-shaking test suite.
 *
 * Verifies that domain-specific entry points are not larger than the full
 * aggregate bundles — a proxy for correct tree-shaking.
 */
describe('bundle size (tree-shaking)', () => {
  beforeAll(async () => {
    if (!BENCH_SLOW) return;

    try {
      execFileSync('pnpm', ['--filter', '@gwenjs/physics2d', 'build'], {
        cwd: repoRoot,
        stdio: 'pipe',
      });
    } catch (err) {
      throw new Error(`[GWEN] pnpm build @gwenjs/physics2d failed: ${(err as Error).message}`);
    }

    for (const entry of ENTRIES) {
      const stat = await fs.stat(path.join(distRoot, entry));
      sizes[entry] = stat.size;
    }
  });

  it.skipIf(!BENCH_SLOW)(
    'all dist entries have non-zero sizes',
    () => {
      for (const entry of ENTRIES) {
        expect(sizes[entry], `${entry} must have a non-zero size`).toBeGreaterThan(0);
      }
    },
    120_000,
  );

  it.skipIf(!BENCH_SLOW)(
    'focused entry points (core, tilemap, debug) are not larger than index',
    () => {
      // helpers.js is intentionally larger than index.js as it aggregates all helpers
      expect(sizes['core.js']).toBeLessThanOrEqual(sizes['index.js'] ?? 0);
      expect(sizes['tilemap.js']).toBeLessThanOrEqual(sizes['index.js'] ?? 0);
      expect(sizes['debug.js']).toBeLessThanOrEqual(sizes['index.js'] ?? 0);
    },
    120_000,
  );

  it.skipIf(!BENCH_SLOW)(
    'helper sub-paths are not larger than helpers bundle',
    () => {
      expect(sizes['helpers-queries.js']).toBeLessThanOrEqual(sizes['helpers.js'] ?? 0);
      expect(sizes['helpers-movement.js']).toBeLessThanOrEqual(sizes['helpers.js'] ?? 0);
      expect(sizes['helpers-contact.js']).toBeLessThanOrEqual(sizes['helpers.js'] ?? 0);
      expect(sizes['helpers-static-geometry.js']).toBeLessThanOrEqual(sizes['helpers.js'] ?? 0);
      expect(sizes['helpers-orchestration.js']).toBeLessThanOrEqual(sizes['index.js'] ?? 0);
    },
    120_000,
  );
});
