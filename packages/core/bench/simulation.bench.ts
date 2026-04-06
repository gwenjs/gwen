/**
 * Benchmark: Simulated game update loop — realistic frame performance
 *
 * Simulates N frames of a typical game world:
 *  - Movement system: query [Position, Velocity] → position += velocity * dt
 *  - Health system: query [Health] → regenerate hp over time
 *  - Multi-system frame: both systems run each frame (realistic pipeline)
 *  - Sparse-entity variant: only 10% of entities have the queried components
 *
 * These benchmarks answer the real question: how fast is useQuery
 * when embedded in an actual per-frame update?
 *
 * Run:
 *   pnpm --filter @gwenjs/core exec vitest bench --run bench/simulation.bench.ts
 */

import { bench, describe, beforeAll } from 'vitest';
import { EntityManager, ComponentRegistry, QueryEngine } from '../src/core/ecs';
import { createEngine } from '../src/index';
import { defineComponent, Types, type InferComponent } from '../src/schema';
import type { EntityId } from '../src/types/entity';

// ── Component definitions ─────────────────────────────────────────────────────

const Position = defineComponent({ name: 'Position', schema: { x: Types.f32, y: Types.f32 } });
const Velocity = defineComponent({ name: 'Velocity', schema: { vx: Types.f32, vy: Types.f32 } });
const Health = defineComponent({
  name: 'Health',
  schema: { current: Types.f32, max: Types.f32, regenRate: Types.f32 },
});
const _Tag = defineComponent({ name: 'Tag', schema: { value: Types.u32 } });

type Pos = InferComponent<typeof Position>;
type Vel = InferComponent<typeof Velocity>;
type Hp = InferComponent<typeof Health>;

// ── Low-level TS ECS helpers ──────────────────────────────────────────────────

/** Build a world with N entities, all having Position + Velocity + Health. */
function makeFullWorld(n: number) {
  const em = new EntityManager(n);
  const cr = new ComponentRegistry();
  const qe = new QueryEngine();
  const ids: EntityId[] = [];
  for (let i = 0; i < n; i++) {
    const id = em.create();
    cr.add(id, Position, { x: i * 1.0, y: 0.0 });
    cr.add(id, Velocity, { vx: 1.0, vy: 0.5 });
    cr.add(id, Health, { current: 80.0, max: 100.0, regenRate: 1.0 });
    ids.push(id);
  }
  return { em, cr, qe, ids };
}

/** Build a sparse world: only `pct`% of entities have Velocity/Health. */
function makeSparseWorld(n: number, pct: number) {
  const em = new EntityManager(n);
  const cr = new ComponentRegistry();
  const qe = new QueryEngine();
  for (let i = 0; i < n; i++) {
    const id = em.create();
    cr.add(id, Position, { x: i * 1.0, y: 0.0 });
    if (i % Math.round(100 / pct) === 0) {
      cr.add(id, Velocity, { vx: 1.0, vy: 0.5 });
      cr.add(id, Health, { current: 80.0, max: 100.0, regenRate: 1.0 });
    }
  }
  return { em, cr, qe };
}

const DT = 1 / 60; // 16.67 ms frame

// ── Simulate N frames (direct TS ECS path) ────────────────────────────────────

function runMovementFrame(cr: ComponentRegistry, qe: QueryEngine, em: EntityManager): void {
  const entities = qe.resolve([Position, Velocity], em, cr);
  for (const id of entities) {
    const pos = cr.get<Pos>(id, Position)!;
    const vel = cr.get<Vel>(id, Velocity)!;
    cr.add(id, Position, { x: pos.x + vel.vx * DT, y: pos.y + vel.vy * DT });
  }
  qe.invalidate();
}

function runHealthFrame(cr: ComponentRegistry, qe: QueryEngine, em: EntityManager): void {
  const entities = qe.resolve([Health], em, cr);
  for (const id of entities) {
    const hp = cr.get<Hp>(id, Health)!;
    if (hp.current < hp.max) {
      cr.add(id, Health, {
        ...hp,
        current: Math.min(hp.current + hp.regenRate * DT, hp.max),
      });
    }
  }
  qe.invalidate();
}

// ── 1. Single system (movement), 1 frame ─────────────────────────────────────

describe('Movement system — 1 frame, direct TS ECS', () => {
  const s1k = makeFullWorld(1_000);
  const s5k = makeFullWorld(5_000);
  const s10k = makeFullWorld(10_000);

  bench('1 000 entities', () => runMovementFrame(s1k.cr, s1k.qe, s1k.em));
  bench('5 000 entities', () => runMovementFrame(s5k.cr, s5k.qe, s5k.em));
  bench('10 000 entities', () => runMovementFrame(s10k.cr, s10k.qe, s10k.em));
});

// ── 2. Multi-system frame (movement + health), 1 frame ───────────────────────

describe('Multi-system frame (movement + health) — 1 frame, direct TS ECS', () => {
  const s1k = makeFullWorld(1_000);
  const s5k = makeFullWorld(5_000);

  bench('1 000 entities', () => {
    runMovementFrame(s1k.cr, s1k.qe, s1k.em);
    runHealthFrame(s1k.cr, s1k.qe, s1k.em);
  });

  bench('5 000 entities', () => {
    runMovementFrame(s5k.cr, s5k.qe, s5k.em);
    runHealthFrame(s5k.cr, s5k.qe, s5k.em);
  });
});

// ── 3. 100-frame simulation (sustained throughput) ────────────────────────────

describe('Sustained 100-frame simulation — movement + health', () => {
  bench('1 000 entities × 100 frames', () => {
    const { em, cr, qe } = makeFullWorld(1_000);
    for (let f = 0; f < 100; f++) {
      runMovementFrame(cr, qe, em);
      runHealthFrame(cr, qe, em);
    }
  });

  bench('5 000 entities × 100 frames', () => {
    const { em, cr, qe } = makeFullWorld(5_000);
    for (let f = 0; f < 100; f++) {
      runMovementFrame(cr, qe, em);
      runHealthFrame(cr, qe, em);
    }
  });
});

// ── 4. Sparse world (10% entities have velocity) ─────────────────────────────

describe('Movement system — sparse world (10% have Velocity)', () => {
  const sparse1k = makeSparseWorld(1_000, 10);
  const sparse5k = makeSparseWorld(5_000, 10);

  bench('1 000 total entities, ~100 match', () => {
    runMovementFrame(sparse1k.cr, sparse1k.qe, sparse1k.em);
  });
  bench('5 000 total entities, ~500 match', () => {
    runMovementFrame(sparse5k.cr, sparse5k.qe, sparse5k.em);
  });
});

// ── 5. Engine-level simulation using createLiveQuery + EntityAccessor ─────────
// Note: createEngine() is async — engines are set up via a shared promise
// resolved once before the bench suite runs.

let _engine1k: Awaited<ReturnType<typeof createEngine>>;
let _engine5k: Awaited<ReturnType<typeof createEngine>>;
let _movQuery1k: ReturnType<typeof _engine1k.createLiveQuery>;
let _movQuery5k: ReturnType<typeof _engine5k.createLiveQuery>;

const _engineReady = (async () => {
  _engine1k = await createEngine({ maxEntities: 1_100 });
  for (let i = 0; i < 1_000; i++) {
    const id = _engine1k.createEntity();
    _engine1k.addComponent(id, Position, { x: i, y: 0 });
    _engine1k.addComponent(id, Velocity, { vx: 1, vy: 0.5 });
  }
  _movQuery1k = _engine1k.createLiveQuery([Position, Velocity]);

  _engine5k = await createEngine({ maxEntities: 5_100 });
  for (let i = 0; i < 5_000; i++) {
    const id = _engine5k.createEntity();
    _engine5k.addComponent(id, Position, { x: i, y: 0 });
    _engine5k.addComponent(id, Velocity, { vx: 1, vy: 0.5 });
  }
  _movQuery5k = _engine5k.createLiveQuery([Position, Velocity]);
})();

describe('Engine-level frame simulation — createLiveQuery + EntityAccessor.get()', () => {
  beforeAll(() => _engineReady);

  bench('1 000 entities — 1 frame (iterate + mutate via addComponent)', () => {
    for (const entity of _movQuery1k) {
      const pos = entity.get(Position) as Pos | undefined;
      const vel = entity.get(Velocity) as Vel | undefined;
      if (pos && vel) {
        _engine1k.addComponent(entity.id, Position, {
          x: pos.x + vel.vx * DT,
          y: pos.y + vel.vy * DT,
        });
      }
    }
  });

  bench('5 000 entities — 1 frame (iterate + mutate via addComponent)', () => {
    for (const entity of _movQuery5k) {
      const pos = entity.get(Position) as Pos | undefined;
      const vel = entity.get(Velocity) as Vel | undefined;
      if (pos && vel) {
        _engine5k.addComponent(entity.id, Position, {
          x: pos.x + vel.vx * DT,
          y: pos.y + vel.vy * DT,
        });
      }
    }
  });
});

// ── 6. Entity churn — spawn + destroy per frame ───────────────────────────────

describe('Entity churn — spawn 10 + destroy 10 per frame, 1 000 stable entities', () => {
  bench('100 frames with churn', () => {
    const { em, cr, qe } = makeFullWorld(1_000);
    const live: EntityId[] = [...em];
    for (let f = 0; f < 100; f++) {
      // Spawn 10
      for (let s = 0; s < 10; s++) {
        try {
          const id = em.create();
          cr.add(id, Position, { x: 0, y: 0 });
          cr.add(id, Velocity, { vx: 1, vy: 0 });
          live.push(id);
        } catch {
          break; // capacity reached
        }
      }
      // Destroy 10
      for (let d = 0; d < 10; d++) {
        const id = live.pop();
        if (id !== undefined) {
          em.destroy(id);
          cr.removeAll(id);
        }
      }
      qe.invalidate();
      runMovementFrame(cr, qe, em);
    }
  });
});
