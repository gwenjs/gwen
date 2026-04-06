/**
 * @file useQuery integration tests
 *
 * Tests for the `useQuery()` composable wired to the TS ECS
 * (EntityManager / ComponentRegistry / QueryEngine inside GwenEngineImpl).
 *
 * Each test creates a real engine instance and exercises the ECS API through
 * the public surface: `createEntity`, `addComponent`, `removeComponent`,
 * `destroyEntity`, and `useQuery` / `EntityAccessor`.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createEngine,
  defineSystem,
  onUpdate,
  useQuery,
  engineContext,
  defineComponent,
  Types,
} from '../src/index';
import type { GwenEngine, EntityAccessor } from '../src/index';

// ─── Component fixtures ───────────────────────────────────────────────────────

const Position = defineComponent({
  name: 'Position',
  schema: { x: Types.f32, y: Types.f32 },
  defaults: { x: 0, y: 0 },
});

const Velocity = defineComponent({
  name: 'Velocity',
  schema: { vx: Types.f32, vy: Types.f32 },
  defaults: { vx: 0, vy: 0 },
});

const EnemyTag = defineComponent({
  name: 'EnemyTag',
  schema: {},
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Collect all EntityAccessors from a live query into an array.
 * Uses a plain `for...of` loop to avoid hot-path allocations in production,
 * but for test readability we use spread here.
 */
function collect(query: Iterable<EntityAccessor>): EntityAccessor[] {
  const result: EntityAccessor[] = [];
  for (const e of query) result.push(e);
  return result;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('useQuery()', () => {
  let engine: GwenEngine;

  beforeEach(async () => {
    engineContext.unset();
    engine = await createEngine({ maxEntities: 100 });
  });

  // ── 1. Basic query — entities with matching components appear ──────────────

  it('returns entities that have all queried components', () => {
    const e1 = engine.createEntity();
    const e2 = engine.createEntity();
    const e3 = engine.createEntity(); // only Position — should NOT appear

    engine.addComponent(e1, Position, { x: 1, y: 2 });
    engine.addComponent(e1, Velocity, { vx: 3, vy: 4 });

    engine.addComponent(e2, Position, { x: 5, y: 6 });
    engine.addComponent(e2, Velocity, { vx: 0, vy: 0 });

    engine.addComponent(e3, Position, { x: 0, y: 0 });
    // e3 has no Velocity — must not appear in [Position, Velocity] query

    const query = engine.run(() => useQuery([Position, Velocity]));
    const results = collect(query);

    expect(results).toHaveLength(2);
    const ids = results.map((e) => e.id);
    expect(ids).toContain(e1);
    expect(ids).toContain(e2);
    expect(ids).not.toContain(e3);
  });

  // ── 2. Adding a component makes the entity appear ─────────────────────────

  it('reflects newly added components on the next iteration', () => {
    const e = engine.createEntity();
    engine.addComponent(e, Position, { x: 10, y: 20 });

    const query = engine.run(() => useQuery([Position, Velocity]));

    // Before adding Velocity, entity must not appear
    expect(collect(query)).toHaveLength(0);

    engine.addComponent(e, Velocity, { vx: 1, vy: 2 });

    // After adding Velocity, entity must appear
    const results = collect(query);
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe(e);
  });

  // ── 3. Removing a component removes the entity from results ───────────────

  it('removes the entity from results after a component is removed', () => {
    const e = engine.createEntity();
    engine.addComponent(e, Position, { x: 0, y: 0 });
    engine.addComponent(e, Velocity, { vx: 5, vy: 0 });

    const query = engine.run(() => useQuery([Position, Velocity]));

    expect(collect(query)).toHaveLength(1);

    engine.removeComponent(e, Velocity);

    expect(collect(query)).toHaveLength(0);
  });

  // ── 4. Destroying an entity removes it from results ───────────────────────

  it('removes the entity from results after it is destroyed', () => {
    const e = engine.createEntity();
    engine.addComponent(e, Position, { x: 0, y: 0 });
    engine.addComponent(e, Velocity, { vx: 0, vy: 0 });

    const query = engine.run(() => useQuery([Position, Velocity]));

    expect(collect(query)).toHaveLength(1);

    engine.destroyEntity(e);

    expect(collect(query)).toHaveLength(0);
  });

  // ── 5. EntityAccessor.get() returns correct component data ────────────────

  it('EntityAccessor.get() returns the stored component data', () => {
    const e = engine.createEntity();
    engine.addComponent(e, Position, { x: 42, y: 99 });
    engine.addComponent(e, Velocity, { vx: 1.5, vy: -3.0 });

    const query = engine.run(() => useQuery([Position, Velocity]));
    const [accessor] = collect(query);

    expect(accessor).toBeDefined();
    expect(accessor!.id).toBe(e);

    const pos = accessor!.get(Position);
    expect(pos).toBeDefined();
    expect(pos!.x).toBeCloseTo(42);
    expect(pos!.y).toBeCloseTo(99);

    const vel = accessor!.get(Velocity);
    expect(vel).toBeDefined();
    expect(vel!.vx).toBeCloseTo(1.5);
    expect(vel!.vy).toBeCloseTo(-3.0);
  });

  // ── 6. EntityAccessor.get() returns undefined for absent component ─────────

  it('EntityAccessor.get() returns undefined for a component the entity does not have', () => {
    const e = engine.createEntity();
    engine.addComponent(e, Position, { x: 0, y: 0 });
    // No Velocity, no EnemyTag

    const query = engine.run(() => useQuery([Position]));
    const [accessor] = collect(query);

    expect(accessor).toBeDefined();
    expect(accessor!.get(Velocity)).toBeUndefined();
    expect(accessor!.get(EnemyTag)).toBeUndefined();
  });

  // ── 7. Multiple-component filter (all of A and B) ─────────────────────────

  it('multi-component filter only includes entities with all listed components', () => {
    const eAll = engine.createEntity(); // has Position + Velocity + EnemyTag
    const eSome = engine.createEntity(); // has Position + EnemyTag (no Velocity)
    const eNone = engine.createEntity(); // has only Position

    engine.addComponent(eAll, Position, { x: 1, y: 0 });
    engine.addComponent(eAll, Velocity, { vx: 1, vy: 0 });
    engine.addComponent(eAll, EnemyTag, {});

    engine.addComponent(eSome, Position, { x: 2, y: 0 });
    engine.addComponent(eSome, EnemyTag, {});

    engine.addComponent(eNone, Position, { x: 3, y: 0 });

    // Query for all three
    const query = engine.run(() => useQuery([Position, Velocity, EnemyTag]));
    const results = collect(query);

    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe(eAll);
  });

  // ── 8. Empty query with no components returns all alive entities ───────────

  it('empty component list returns all alive entities', () => {
    const e1 = engine.createEntity();
    const e2 = engine.createEntity();
    const e3 = engine.createEntity();

    const query = engine.run(() => useQuery([]));
    const ids = collect(query).map((e) => e.id);

    expect(ids).toContain(e1);
    expect(ids).toContain(e2);
    expect(ids).toContain(e3);
  });

  // ── 9. Query is accessible inside onUpdate callbacks ─────────────────────

  it('query captured at setup time is iterable inside onUpdate', async () => {
    const e = engine.createEntity();
    engine.addComponent(e, Position, { x: 10, y: 20 });
    engine.addComponent(e, Velocity, { vx: 1, vy: 0 });

    const visited: EntityAccessor[] = [];

    const system = defineSystem(() => {
      const query = useQuery([Position, Velocity]);
      onUpdate(() => {
        for (const accessor of query) {
          visited.push(accessor);
        }
      });
    });

    await engine.use(system);
    await engine.startExternal();
    await engine.advance(16);

    expect(visited).toHaveLength(1);
    expect(visited[0]!.id).toBe(e);

    await engine.stop();
  });

  // ── 10. defaults are merged when addComponent is called ───────────────────

  it('component defaults are merged with supplied data', () => {
    const e = engine.createEntity();
    // Only supply x — y should fall back to the default (0)
    engine.addComponent(e, Position, { x: 77 });

    const data = engine.getComponent(e, Position);
    expect(data).toBeDefined();
    expect(data!.x).toBeCloseTo(77);
    expect(data!.y).toBeCloseTo(0); // from defaults
  });

  // ── 11. isAlive / destroyEntity ────────────────────────────────────────────

  it('isAlive returns false after destroyEntity', () => {
    const e = engine.createEntity();
    expect(engine.isAlive(e)).toBe(true);
    engine.destroyEntity(e);
    expect(engine.isAlive(e)).toBe(false);
  });

  it('destroyEntity returns false for an already-dead entity', () => {
    const e = engine.createEntity();
    engine.destroyEntity(e);
    expect(engine.destroyEntity(e)).toBe(false);
  });

  // ── 12. hasComponent ───────────────────────────────────────────────────────

  it('hasComponent returns true after addComponent and false after removeComponent', () => {
    const e = engine.createEntity();
    expect(engine.hasComponent(e, Position)).toBe(false);
    engine.addComponent(e, Position, { x: 0, y: 0 });
    expect(engine.hasComponent(e, Position)).toBe(true);
    engine.removeComponent(e, Position);
    expect(engine.hasComponent(e, Position)).toBe(false);
  });

  // ── 13. removeComponent returns false when component is absent ────────────

  it('removeComponent returns false when the component is not present', () => {
    const e = engine.createEntity();
    expect(engine.removeComponent(e, Velocity)).toBe(false);
  });
});
