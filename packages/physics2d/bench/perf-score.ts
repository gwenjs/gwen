/**
 * @module perf-score
 * Performance gate evaluation logic for @gwenjs/physics2d benchmarks.
 *
 * Exports the `evaluatePerfGate` function and all related types used by
 * perf-gate.test.ts and playgrounds-e2e.test.ts.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single row of solver benchmark output for one preset. */
export interface SolverResultRow {
  /** Name of the physics preset (e.g. 'low', 'medium', 'high', 'esport'). */
  preset: string;
  /** Median step time in milliseconds (optional — may not be emitted by all bench builds). */
  stepP50Ms?: number;
  /** 95th-percentile step time in milliseconds. */
  stepP95Ms: number;
  /** Fraction of bodies that tunnelled through colliders in [0, 1]. */
  tunnelRate: number;
  /** Number of solver iterations per step (optional). */
  solverIterations?: number;
  /** Positional jitter in metres at steady state (optional). */
  stabilityJitterM?: number;
}

/** Payload emitted by the Rust `bench_solver_presets` binary. */
export interface SolverPayload {
  /** Scenario identifier, expected to be `'solver-presets'`. */
  scenario: string;
  /** One row per physics preset. */
  results: SolverResultRow[];
}

/** Timing payload from the tilemap build/patch benchmark. */
export interface TilemapPayload {
  /** Wall-clock time in milliseconds to run `buildTilemapPhysicsChunks`. */
  buildMs: number;
  /** Wall-clock time in milliseconds to run `patchTilemapPhysicsChunk`. */
  patchMs: number;
}

/** Combined benchmark payload fed to `evaluatePerfGate`. */
export interface PerfPayload {
  /** Solver benchmark results. */
  solver: SolverPayload;
  /** Tilemap benchmark results. */
  tilemap: TilemapPayload;
}

/** A single metric threshold definition from `physics-perf-thresholds.json`. */
export interface MetricThreshold {
  /** Maximum allowed value for the metric. */
  max: number;
  /** Relative weight used to compute the composite score. */
  weight: number;
}

/** Parsed `physics-perf-thresholds.json` structure. */
export interface PerfThresholds {
  /** Threshold file format version. */
  version: number;
  /** Map of metric name → threshold definition. */
  metrics: Record<string, MetricThreshold>;
  /** Reserved metric names and their status strings. */
  reserved?: Record<string, string>;
}

/** Result for a single metric in a `PerfReport`. */
export interface MetricResult {
  /** Measured value, or `null` for reserved/not-yet-measured metrics. */
  value: number | null;
  /** Threshold used for comparison, or `null` for reserved metrics. */
  threshold: number | null;
  /** Relative weight of this metric in the composite score. */
  weight: number;
  /** Unit label (e.g. `'ms'`, `'ratio'`, `'count'`). */
  unit: string;
  /** Whether the metric passed its threshold. */
  pass: boolean;
  /** Optional status string for reserved metrics. */
  status?: string;
}

/** Full output of `evaluatePerfGate`. */
export interface PerfReport {
  /** Threshold file format version. */
  version: number;
  /** Overall gate verdict — `'pass'` only if every measured metric passes. */
  verdict: 'pass' | 'fail';
  /**
   * Weighted composite score in [0, 100].
   * A score of 100 means all measured metrics passed.
   */
  score: number;
  /** Per-metric results, keyed by metric name. */
  metrics: Record<string, MetricResult>;
  /** The raw benchmark payload that was evaluated. */
  payload: PerfPayload;
}

// ---------------------------------------------------------------------------
// Core function
// ---------------------------------------------------------------------------

/**
 * Evaluate a performance gate given a benchmark payload and a set of thresholds.
 *
 * @param payload   - Combined solver + tilemap benchmark measurements.
 * @param thresholds - Threshold definitions loaded from `physics-perf-thresholds.json`.
 * @returns A `PerfReport` with a verdict, composite score, and per-metric details.
 * @throws {Error} If the payload is missing the required `high` or `esport` solver rows.
 *
 * @example
 * ```ts
 * import { evaluatePerfGate } from './perf-score';
 * import thresholds from './physics-perf-thresholds.json';
 *
 * const report = evaluatePerfGate(payload, thresholds);
 * console.log(report.verdict); // 'pass' | 'fail'
 * ```
 */
export function evaluatePerfGate(payload: PerfPayload, thresholds: PerfThresholds): PerfReport {
  const high = payload.solver.results.find((row) => row.preset === 'high');
  const esport = payload.solver.results.find((row) => row.preset === 'esport');

  if (!high || !esport) {
    throw new Error(
      '[GWEN] Perf score requires `high` and `esport` rows from solver bench payload.',
    );
  }

  const defs = thresholds.metrics;

  const measuredMetrics: Record<string, MetricResult> = {
    solverHighStepP95Ms: {
      value: high.stepP95Ms,
      threshold: defs['solverHighStepP95Ms']?.max ?? null,
      weight: defs['solverHighStepP95Ms']?.weight ?? 0,
      unit: 'ms',
      pass: high.stepP95Ms <= (defs['solverHighStepP95Ms']?.max ?? Infinity),
    },
    solverHighTunnelRate: {
      value: high.tunnelRate,
      threshold: defs['solverHighTunnelRate']?.max ?? null,
      weight: defs['solverHighTunnelRate']?.weight ?? 0,
      unit: 'ratio',
      pass: high.tunnelRate <= (defs['solverHighTunnelRate']?.max ?? Infinity),
    },
    solverEsportStepP95Ms: {
      value: esport.stepP95Ms,
      threshold: defs['solverEsportStepP95Ms']?.max ?? null,
      weight: defs['solverEsportStepP95Ms']?.weight ?? 0,
      unit: 'ms',
      pass: esport.stepP95Ms <= (defs['solverEsportStepP95Ms']?.max ?? Infinity),
    },
    tilemapBuildMs: {
      value: payload.tilemap.buildMs,
      threshold: defs['tilemapBuildMs']?.max ?? null,
      weight: defs['tilemapBuildMs']?.weight ?? 0,
      unit: 'ms',
      pass: payload.tilemap.buildMs <= (defs['tilemapBuildMs']?.max ?? Infinity),
    },
    tilemapPatchMs: {
      value: payload.tilemap.patchMs,
      threshold: defs['tilemapPatchMs']?.max ?? null,
      weight: defs['tilemapPatchMs']?.weight ?? 0,
      unit: 'ms',
      pass: payload.tilemap.patchMs <= (defs['tilemapPatchMs']?.max ?? Infinity),
    },
  };

  const reservedMetrics: Record<string, MetricResult> = {
    droppedEvents: {
      value: null,
      threshold: null,
      weight: 0,
      unit: 'count',
      pass: true,
      status: thresholds.reserved?.['droppedEvents'] ?? 'reserved',
    },
    allocations: {
      value: null,
      threshold: null,
      weight: 0,
      unit: 'count',
      pass: true,
      status: thresholds.reserved?.['allocations'] ?? 'reserved',
    },
  };

  const totalWeight = Object.values(measuredMetrics).reduce((sum, item) => sum + item.weight, 0);
  const passedWeight = Object.values(measuredMetrics).reduce(
    (sum, item) => sum + (item.pass ? item.weight : 0),
    0,
  );

  return {
    version: thresholds.version,
    verdict: Object.values(measuredMetrics).every((item) => item.pass) ? 'pass' : 'fail',
    score: totalWeight === 0 ? 100 : Number(((passedWeight / totalWeight) * 100).toFixed(2)),
    metrics: {
      ...measuredMetrics,
      ...reservedMetrics,
    },
    payload,
  };
}
