/**
 * Benchmark: useQuery / createLiveQuery — entity iteration performance
 *
 * Measures the cost of:
 *  1. Query setup (createLiveQuery call — happens once at system setup)
 *  2. Full iteration over matching entities at various world sizes
 *  3. Multi-component filter queries (all: [A, B, C])
 *  4. EntityAccessor.get() per-component read inside iteration
 *  5. Query invalidation cost after a component mutation
 *  6. Engine-level createLiveQuery vs direct QueryEngine.resolve()
 *
 * Run:
 *   pnpm --filter @gwenjs/core exec vitest bench --run bench/query.bench.ts
 */

import { bench, describe } from 'vitest';
import { EntityManager, ComponentRegistry, QueryEngine } from '../src/core/ecs';
import { createEngine } from '../src/index';
import { defineComponent, Types } from '../src/schema';

// ── Component definitions ─────────────────────────────────────────────────────

const Position = defineComponent({ name: 'Position', schema: { x: Types.f32, y: Types.f32 } });
const Velocity = defineComponent({ name: 'Velocity', schema: { vx: Types.f32, vy: Types.f32 } });
const Health = defineComponent({ name: 'Health', schema: { current: Types.f32, max: Types.f32 } });

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a populated TS ECS world with N entities, each having Position + Velocity. */
function makeWorld(n: number) {
  const em = new EntityManager(n);
  const cr = new ComponentRegistry();
  const qe = new QueryEngine();
  for (let i = 0; i < n; i++) {
    const id = em.create();
    cr.add(id, Position, { x: i, y: 0 });
    cr.add(id, Velocity, { vx: 1, vy: 0 });
  }
  return { em, cr, qe };
}

// ── 1. Query setup cost ───────────────────────────────────────────────────────

describe('Query setup (createLiveQuery) — one-time cost per system', () => {
  let engine: Awaited<ReturnType<typeof createEngine>>;

  bench(
    'engine.createLiveQuery([Position, Velocity])',
    async () => {
      if (!engine) engine = await createEngine({ maxEntities: 1_000 });
      engine.createLiveQuery([Position, Velocity]);
    },
    { warmupIterations: 5 },
  );
});

// ── 2. Iteration — various world sizes ────────────────────────────────────────

describe('Query iteration — 500 entities, 1 component', () => {
  const { em, cr, qe } = makeWorld(500);

  bench('QueryEngine.resolve (direct)', () => {
    qe.invalidate();
    const results = qe.resolve([Position], em, cr);
    let sum = 0;
    for (const id of results) {
      const pos = cr.get<{ x: number; y: number }>(id, Position);
      sum += pos?.x ?? 0;
    }
    return sum;
  });
});

describe('Query iteration — 1 000 entities, 1 component', () => {
  const { em, cr, qe } = makeWorld(1_000);

  bench('QueryEngine.resolve (direct)', () => {
    qe.invalidate();
    const results = qe.resolve([Position], em, cr);
    let sum = 0;
    for (const id of results) {
      const pos = cr.get<{ x: number; y: number }>(id, Position);
      sum += pos?.x ?? 0;
    }
    return sum;
  });

  bench('engine.createLiveQuery — EntityAccessor.get()', async () => {
    const engine = await createEngine({ maxEntities: 1_000 });
    for (let i = 0; i < 1_000; i++) {
      const id = engine.createEntity();
      engine.addComponent(id, Position, { x: i, y: 0 });
      engine.addComponent(id, Velocity, { vx: 1, vy: 0 });
    }
    const query = engine.createLiveQuery([Position, Velocity]);
    let sum = 0;
    for (const entity of query) {
      const pos = entity.get(Position);
      sum += pos?.x ?? 0;
    }
    return sum;
  });
});

describe('Query iteration — 5 000 entities, 1 component', () => {
  const { em, cr, qe } = makeWorld(5_000);

  bench('QueryEngine.resolve (direct)', () => {
    qe.invalidate();
    const results = qe.resolve([Position], em, cr);
    let sum = 0;
    for (const id of results) {
      const pos = cr.get<{ x: number; y: number }>(id, Position);
      sum += pos?.x ?? 0;
    }
    return sum;
  });
});

describe('Query iteration — 10 000 entities, 1 component', () => {
  const { em, cr, qe } = makeWorld(10_000);

  bench('QueryEngine.resolve (direct)', () => {
    qe.invalidate();
    const results = qe.resolve([Position], em, cr);
    let sum = 0;
    for (const id of results) {
      const pos = cr.get<{ x: number; y: number }>(id, Position);
      sum += pos?.x ?? 0;
    }
    return sum;
  });
});

// ── 3. Multi-component filter (all: [A, B, C]) ────────────────────────────────

describe('Multi-component query — 1 000 entities, 3 components (all match)', () => {
  const em = new EntityManager(1_000);
  const cr = new ComponentRegistry();
  const qe = new QueryEngine();
  for (let i = 0; i < 1_000; i++) {
    const id = em.create();
    cr.add(id, Position, { x: i, y: 0 });
    cr.add(id, Velocity, { vx: 1, vy: 0 });
    cr.add(id, Health, { current: 100, max: 100 });
  }

  bench('all: [Position, Velocity, Health]', () => {
    qe.invalidate();
    qe.resolve([Position, Velocity, Health], em, cr);
  });
});

describe('Multi-component query — 1 000 entities, 3 components (50% match)', () => {
  const em = new EntityManager(1_000);
  const cr = new ComponentRegistry();
  const qe = new QueryEngine();
  for (let i = 0; i < 1_000; i++) {
    const id = em.create();
    cr.add(id, Position, { x: i, y: 0 });
    cr.add(id, Velocity, { vx: 1, vy: 0 });
    // Only half have Health
    if (i % 2 === 0) cr.add(id, Health, { current: 100, max: 100 });
  }

  bench('all: [Position, Velocity, Health] — half match', () => {
    qe.invalidate();
    qe.resolve([Position, Velocity, Health], em, cr);
  });
});

// ── 4. EntityAccessor.get() per-field read cost ───────────────────────────────

describe('EntityAccessor.get() — 1 000 entities × 2 components per frame', () => {
  let engine: Awaited<ReturnType<typeof createEngine>>;
  let query: Iterable<{ get: (def: typeof Position | typeof Velocity) => unknown }>;

  bench(
    'iterate + get(Position) + get(Velocity)',
    async () => {
      if (!engine) {
        engine = await createEngine({ maxEntities: 1_000 });
        for (let i = 0; i < 1_000; i++) {
          const id = engine.createEntity();
          engine.addComponent(id, Position, { x: i, y: 0 });
          engine.addComponent(id, Velocity, { vx: 1, vy: 0 });
        }
        query = engine.createLiveQuery([Position, Velocity]);
      }
      let sum = 0;
      for (const entity of query) {
        const pos = entity.get(Position) as { x: number } | undefined;
        const vel = entity.get(Velocity) as { vx: number } | undefined;
        sum += (pos?.x ?? 0) + (vel?.vx ?? 0);
      }
      return sum;
    },
    { warmupIterations: 3 },
  );
});

// ── 5. Invalidation cost after mutation ───────────────────────────────────────

describe('Query invalidation after addComponent — 100 mutations', () => {
  const em = new EntityManager(1_000);
  const cr = new ComponentRegistry();
  const qe = new QueryEngine();
  const ids: bigint[] = [];
  for (let i = 0; i < 1_000; i++) {
    const id = em.create();
    cr.add(id, Position, { x: i, y: 0 });
    ids.push(id);
  }

  bench('addComponent × 100 (triggers invalidate each time)', () => {
    for (let i = 0; i < 100; i++) {
      const id = ids[i % ids.length]!;
      cr.add(id, Velocity, { vx: i, vy: 0 });
      qe.invalidate();
    }
  });
});

describe('Cached query re-read without invalidation — 1 000 entities', () => {
  const { em, cr, qe } = makeWorld(1_000);
  // warm up cache
  qe.resolve([Position], em, cr);

  bench('re-read cached query result (no invalidation)', () => {
    qe.resolve([Position], em, cr);
  });
});
