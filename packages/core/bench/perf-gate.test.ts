/**
 * @module perf-gate.test
 *
 * CI-blocking performance gate tests for the @gwenjs/core ECS.
 *
 * These tests measure the TypeScript-side overhead of core ECS operations and
 * fail CI if the operations regress beyond generous, machine-independent
 * thresholds. They run via `pnpm --filter @gwenjs/core test`.
 *
 * Thresholds are intentionally generous to avoid flakiness on slow CI runners
 * while still catching catastrophic regressions (e.g. accidental O(n²) loops).
 *
 * Baseline machine: M-series Mac, single-threaded Node 20.
 */

import { expect, test } from 'vitest';
import { EntityManager, ComponentRegistry, QueryEngine } from '../src/core/ecs';
import { defineComponent, Types } from '../src/schema';

// ── Component definitions ─────────────────────────────────────────────────────

const Position = defineComponent({ name: 'Position', schema: { x: Types.f32, y: Types.f32 } });
const Velocity = defineComponent({ name: 'Velocity', schema: { vx: Types.f32, vy: Types.f32 } });

// ── Gate 1: createEntity() × 1000 ────────────────────────────────────────────

test('createEntity() × 1000 completes in < 50ms', () => {
  const start = performance.now();

  const em = new EntityManager(1_000);
  for (let i = 0; i < 1_000; i++) {
    em.create();
  }

  const elapsed = performance.now() - start;
  expect(elapsed).toBeLessThan(50);
});

// ── Gate 2: getComponent() × 1000 ────────────────────────────────────────────

test('getComponent() × 1000 completes in < 50ms', () => {
  // Pre-populate world outside the timed section.
  const em = new EntityManager(1_000);
  const cr = new ComponentRegistry();
  const ids: bigint[] = [];

  for (let i = 0; i < 1_000; i++) {
    const id = em.create();
    cr.add(id, Position, { x: i, y: 0 });
    ids.push(id);
  }

  const start = performance.now();

  for (let i = 0; i < 1_000; i++) {
    cr.get<{ x: number; y: number }>(ids[i]!, Position);
  }

  const elapsed = performance.now() - start;
  expect(elapsed).toBeLessThan(50);
});

// ── Gate 3: useQuery iteration over 10 000 entities ───────────────────────────

test('QueryEngine.resolve iteration over 10 000 entities completes in < 100ms', () => {
  // Pre-populate world outside the timed section.
  const em = new EntityManager(10_000);
  const cr = new ComponentRegistry();
  const qe = new QueryEngine();

  for (let i = 0; i < 10_000; i++) {
    const id = em.create();
    cr.add(id, Position, { x: i, y: 0 });
    cr.add(id, Velocity, { vx: 1, vy: 0 });
  }

  const start = performance.now();

  qe.invalidate();
  const results = qe.resolve([Position, Velocity], em, cr);
  let sum = 0;
  for (const id of results) {
    const pos = cr.get<{ x: number; y: number }>(id, Position);
    sum += pos?.x ?? 0;
  }

  const elapsed = performance.now() - start;

  // Consume sum to prevent dead-code elimination.
  expect(sum).toBeGreaterThanOrEqual(0);
  expect(elapsed).toBeLessThan(100);
});
