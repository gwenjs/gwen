/**
 * @module perf-gate.test
 * Unit tests for the `evaluatePerfGate` function in `perf-score.ts`.
 *
 * Tests cover:
 * - Passing payload → verdict=pass, score=100
 * - Degraded payload → verdict=fail with correct metric failures
 * - Missing preset rows → throws
 * - Reserved metrics → null values and pass=true
 * - Partial failures → score is proportional to passing weight
 */

import { describe, it, expect } from 'vitest';
import { evaluatePerfGate } from './perf-score';
import type { PerfPayload } from './perf-score';
import thresholds from './physics-perf-thresholds.json';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A payload where all metrics are well under their thresholds. */
const passingPayload: PerfPayload = {
  solver: {
    scenario: 'solver-presets',
    results: [
      { preset: 'low', stepP95Ms: 0.5, tunnelRate: 0, solverIterations: 2, stabilityJitterM: 0 },
      { preset: 'medium', stepP95Ms: 1, tunnelRate: 0, solverIterations: 4, stabilityJitterM: 0 },
      { preset: 'high', stepP95Ms: 5, tunnelRate: 0, solverIterations: 8, stabilityJitterM: 0 },
      { preset: 'esport', stepP95Ms: 6, tunnelRate: 0, solverIterations: 16, stabilityJitterM: 0 },
    ],
  },
  tilemap: { buildMs: 100, patchMs: 10 },
};

/** A payload where all measured metrics exceed their thresholds. */
const degradedPayload: PerfPayload = {
  solver: {
    scenario: 'solver-presets',
    results: [
      { preset: 'low', stepP95Ms: 1, tunnelRate: 1 },
      { preset: 'medium', stepP95Ms: 1, tunnelRate: 1 },
      { preset: 'high', stepP95Ms: 99, tunnelRate: 0.5 },
      { preset: 'esport', stepP95Ms: 99, tunnelRate: 0.5 },
    ],
  },
  tilemap: { buildMs: 9999, patchMs: 999 },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('evaluatePerfGate', () => {
  it('passing payload returns verdict=pass and score=100', () => {
    const report = evaluatePerfGate(passingPayload, thresholds);

    expect(report.verdict).toBe('pass');
    expect(report.score).toBe(100);
  });

  it('degraded payload returns verdict=fail with correct metric failures', () => {
    const report = evaluatePerfGate(degradedPayload, thresholds);

    expect(report.verdict).toBe('fail');
    expect(report.metrics['solverHighTunnelRate']?.pass).toBe(false);
    expect(report.metrics['tilemapBuildMs']?.pass).toBe(false);
  });

  it('throws when high/esport preset rows are missing', () => {
    const incompletePayload: PerfPayload = {
      solver: {
        scenario: 'solver-presets',
        results: [
          { preset: 'low', stepP95Ms: 0.5, tunnelRate: 0 },
          { preset: 'medium', stepP95Ms: 1, tunnelRate: 0 },
        ],
      },
      tilemap: { buildMs: 100, patchMs: 10 },
    };

    expect(() => evaluatePerfGate(incompletePayload, thresholds)).toThrow(
      'requires `high` and `esport` rows',
    );
  });

  it('reserved metrics have null values and pass=true', () => {
    const report = evaluatePerfGate(passingPayload, thresholds);

    expect(report.metrics['droppedEvents']?.value).toBeNull();
    expect(report.metrics['droppedEvents']?.pass).toBe(true);
    expect(report.metrics['allocations']?.value).toBeNull();
    expect(report.metrics['allocations']?.pass).toBe(true);
  });

  it('score is proportional to passing weight', () => {
    // Use degraded payload — only some metrics will pass (if any), so score < 100.
    // The degraded payload has high.tunnelRate=0.5 (> max 0) and high.stepP95Ms=99 (> max 10),
    // esport.stepP95Ms=99 (> max 12), tilemapBuildMs=9999 (> max 1000), tilemapPatchMs=999 (> max 120).
    // All measured metrics fail → score = 0.
    const allFailReport = evaluatePerfGate(degradedPayload, thresholds);
    expect(allFailReport.score).toBeGreaterThanOrEqual(0);
    expect(allFailReport.score).toBeLessThan(100);

    // Construct a partially-passing payload: only tilemap metrics exceed thresholds.
    const partialPayload: PerfPayload = {
      solver: {
        scenario: 'solver-presets',
        results: [
          { preset: 'low', stepP95Ms: 0.5, tunnelRate: 0 },
          { preset: 'medium', stepP95Ms: 1, tunnelRate: 0 },
          { preset: 'high', stepP95Ms: 5, tunnelRate: 0 }, // passes
          { preset: 'esport', stepP95Ms: 6, tunnelRate: 0 }, // passes
        ],
      },
      tilemap: { buildMs: 9999, patchMs: 999 }, // fails
    };
    const partialReport = evaluatePerfGate(partialPayload, thresholds);
    expect(partialReport.score).toBeGreaterThan(0);
    expect(partialReport.score).toBeLessThan(100);
  });
});
