/**
 * @module bench-ci.test
 * Integration test that verifies the bench infrastructure is correctly wired.
 *
 * Checks that:
 * - Vitest bench config picks up all *.bench.ts files
 * - The perf-score module loads thresholds correctly
 * - All expected bench entry points exist
 *
 * This test runs in normal `vitest run` (no BENCH_SLOW required).
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluatePerfGate } from './perf-score';
import thresholds from './physics-perf-thresholds.json';

const benchDir = path.resolve(fileURLToPath(new URL('.', import.meta.url)));

// ---------------------------------------------------------------------------
// Expected bench files
// ---------------------------------------------------------------------------

const EXPECTED_BENCH_FILES = [
  'tilemap.bench.ts',
  'helpers.bench.ts',
  'integration.bench.ts',
] as const;

const EXPECTED_TEST_FILES = [
  'perf-gate.test.ts',
  'solver.test.ts',
  'bundle-size.test.ts',
  'bench-ci.test.ts',
] as const;

describe('bench infrastructure', () => {
  it('all expected *.bench.ts files exist', () => {
    for (const file of EXPECTED_BENCH_FILES) {
      expect(fs.existsSync(path.join(benchDir, file)), `missing: ${file}`).toBe(true);
    }
  });

  it('all expected *.test.ts files exist', () => {
    for (const file of EXPECTED_TEST_FILES) {
      expect(fs.existsSync(path.join(benchDir, file)), `missing: ${file}`).toBe(true);
    }
  });

  it('physics-perf-thresholds.json has all required metric keys', () => {
    const required = [
      'solverHighStepP95Ms',
      'solverHighTunnelRate',
      'solverEsportStepP95Ms',
      'tilemapBuildMs',
      'tilemapPatchMs',
    ];
    for (const key of required) {
      expect(thresholds.metrics, `missing threshold: ${key}`).toHaveProperty(key);
    }
  });

  it('evaluatePerfGate returns pass for a payload within thresholds', () => {
    const payload = {
      solver: {
        scenario: 'solver-presets',
        results: [
          {
            preset: 'high',
            stepP50Ms: 1,
            stepP95Ms: 5,
            tunnelRate: 0,
            solverIterations: 4,
            stabilityJitterM: 0.001,
          },
          {
            preset: 'esport',
            stepP50Ms: 1,
            stepP95Ms: 8,
            tunnelRate: 0,
            solverIterations: 8,
            stabilityJitterM: 0.0005,
          },
        ],
      },
      tilemap: { buildMs: 200, patchMs: 10 },
    };

    const report = evaluatePerfGate(payload, thresholds);
    expect(report.verdict).toBe('pass');
    expect(report.score).toBe(100);
  });

  it('evaluatePerfGate returns fail when a metric exceeds threshold', () => {
    const payload = {
      solver: {
        scenario: 'solver-presets',
        results: [
          {
            preset: 'high',
            stepP50Ms: 1,
            stepP95Ms: 99,
            tunnelRate: 0,
            solverIterations: 4,
            stabilityJitterM: 0.001,
          },
          {
            preset: 'esport',
            stepP50Ms: 1,
            stepP95Ms: 8,
            tunnelRate: 0,
            solverIterations: 8,
            stabilityJitterM: 0.0005,
          },
        ],
      },
      tilemap: { buildMs: 200, patchMs: 10 },
    };

    const report = evaluatePerfGate(payload, thresholds);
    expect(report.verdict).toBe('fail');
  });
});
