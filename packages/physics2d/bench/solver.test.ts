/**
 * @module solver.test
 * Vitest test suite for the Rust `bench_solver_presets` binary.
 *
 * All tests are skipped unless the `BENCH_SLOW` environment variable is set,
 * because they require compiling and running a Cargo binary (~minutes in CI).
 *
 * Set `BENCH_SLOW=1` to enable:
 * ```sh
 * BENCH_SLOW=1 pnpm --filter @gwenjs/physics2d test:bench:solver
 * ```
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const BENCH_SLOW = Boolean(process.env['BENCH_SLOW']);

const repoRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');
const manifestPath = path.join(repoRoot, 'crates/gwen-core/Cargo.toml');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single row from the `bench_solver_presets` JSON output. */
interface SolverRow {
  preset: string;
  stepP50Ms: number;
  stepP95Ms: number;
  tunnelRate: number;
  solverIterations: number;
  stabilityJitterM: number;
}

/** Top-level shape of the `bench_solver_presets --json` output. */
interface SolverBenchPayload {
  scenario: string;
  results: SolverRow[];
}

// ---------------------------------------------------------------------------
// Shared state — cargo is run once in beforeAll to avoid multiple compilations
// ---------------------------------------------------------------------------

let payload: SolverBenchPayload;
let byPreset: Record<string, SolverRow>;

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

/**
 * Solver bench test suite.
 *
 * Validates structural correctness and physics invariants of the Rust solver
 * benchmark output.
 */
describe('solver bench (cargo)', () => {
  beforeAll(() => {
    if (!BENCH_SLOW) return;

    try {
      const raw = execFileSync(
        'cargo',
        [
          'run',
          '--quiet',
          '--manifest-path',
          manifestPath,
          '--bin',
          'bench_solver_presets',
          '--features',
          'physics2d',
          '--',
          '--json',
        ],
        {
          cwd: repoRoot,
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe'], // prevent stderr bleed into stdout
        },
      ).trim();

      const jsonStart = raw.indexOf('{');
      if (jsonStart === -1) throw new Error(`No JSON in cargo output:\n${raw}`);
      payload = JSON.parse(raw.slice(jsonStart)) as SolverBenchPayload;
      byPreset = Object.fromEntries(payload.results.map((row) => [row.preset, row])) as Record<
        string,
        SolverRow
      >;
    } catch (err) {
      throw new Error(`[GWEN] cargo bench_solver_presets failed: ${(err as Error).message}`);
    }
  }, 300_000);

  it.skipIf(!BENCH_SLOW)(
    'produces valid solver-presets payload',
    () => {
      expect(payload.scenario).toBe('solver-presets');
      expect(Array.isArray(payload.results)).toBe(true);
      expect(payload.results).toHaveLength(4);

      for (const row of payload.results) {
        expect(row.stepP50Ms).toBeGreaterThan(0);
        expect(row.stepP95Ms).toBeGreaterThanOrEqual(row.stepP50Ms);
        expect(row.tunnelRate).toBeGreaterThanOrEqual(0);
        expect(row.tunnelRate).toBeLessThanOrEqual(1);
        expect(row.stabilityJitterM).toBeGreaterThanOrEqual(0);
      }
    },
    300_000,
  );

  it.skipIf(!BENCH_SLOW)(
    'high preset has no worse tunnel rate than low preset',
    () => {
      expect(byPreset['high'], 'high preset must be present in solver results').toBeDefined();
      expect(byPreset['low'], 'low preset must be present in solver results').toBeDefined();
      expect(byPreset['esport'], 'esport preset must be present in solver results').toBeDefined();
      expect(byPreset['high']!.tunnelRate).toBeLessThanOrEqual(byPreset['low']!.tunnelRate);
      expect(byPreset['esport']!.tunnelRate).toBeLessThanOrEqual(byPreset['low']!.tunnelRate);
    },
    300_000,
  );

  it.skipIf(!BENCH_SLOW)(
    'esport has more solver iterations than high',
    () => {
      expect(byPreset['esport'], 'esport preset must be present in solver results').toBeDefined();
      expect(byPreset['high'], 'high preset must be present in solver results').toBeDefined();
      expect(byPreset['esport']!.solverIterations).toBeGreaterThanOrEqual(
        byPreset['high']!.solverIterations,
      );
    },
    300_000,
  );
});
