/**
 * ECS Tests — EntityManager, ComponentRegistry, QueryEngine
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { EntityManager, ComponentRegistry, QueryEngine } from '../src/core/ecs';
import { defineComponent, Types } from '../src/schema';

// ============= EntityManager =============

describe('EntityManager', () => {
  let em: EntityManager;

  beforeEach(() => {
    em = new EntityManager(100);
  });

  describe('create', () => {
    it('should create entities with unique IDs', () => {
      const e1 = em.create();
      const e2 = em.create();
      const e3 = em.create();
      expect(e1).not.toBe(e2);
      expect(e2).not.toBe(e3);
    });

    it('should increment entity count', () => {
      expect(em.count()).toBe(0);
      em.create();
      expect(em.count()).toBe(1);
      em.create();
      expect(em.count()).toBe(2);
    });

    it('should throw when capacity is exceeded', () => {
      const small = new EntityManager(3);
      small.create();
      small.create();
      small.create();
      expect(() => small.create()).toThrow('capacity exceeded');
    });

    it('should create 1000 entities', () => {
      const big = new EntityManager(1000);
      for (let i = 0; i < 1000; i++) {
        big.create();
      }
      expect(big.count()).toBe(1000);
    });
  });

  describe('destroy', () => {
    it('should destroy alive entity', () => {
      const e = em.create();
      expect(em.destroy(e)).toBe(true);
    });

    it('should return false for already-dead entity', () => {
      const e = em.create();
      em.destroy(e);
      expect(em.destroy(e)).toBe(false);
    });

    it('should decrement count on destroy', () => {
      const e1 = em.create();
      em.create();
      expect(em.count()).toBe(2);
      em.destroy(e1);
      expect(em.count()).toBe(1);
    });

    it('should NOT affect other entities', () => {
      const e1 = em.create();
      const e2 = em.create();
      em.destroy(e1);
      expect(em.isAlive(e2)).toBe(true);
    });
  });

  describe('isAlive', () => {
    it('should be true for new entity', () => {
      const e = em.create();
      expect(em.isAlive(e)).toBe(true);
    });

    it('should be false after destroy', () => {
      const e = em.create();
      em.destroy(e);
      expect(em.isAlive(e)).toBe(false);
    });

    it('should detect stale IDs (generation counter)', () => {
      const e = em.create();
      const staleId = e; // save old ID
      em.destroy(e);
      const e2 = em.create(); // reuses same slot
      // The old stale ID should no longer be alive
      expect(em.isAlive(staleId)).toBe(false);
      expect(em.isAlive(e2)).toBe(true);
    });
  });

  describe('free list reuse', () => {
    it('should reuse destroyed slots', () => {
      const e1 = em.create();
      em.destroy(e1);
      const e2 = em.create();
      // Different ID (generation incremented) but same slot
      expect(e1).not.toBe(e2);
      expect(em.isAlive(e2)).toBe(true);
      expect(em.count()).toBe(1);
    });
  });

  describe('iteration', () => {
    it('should iterate over all alive entities', () => {
      const e1 = em.create();
      const e2 = em.create();
      const e3 = em.create();
      em.destroy(e2);

      const alive = [...em];
      expect(alive.length).toBe(2);
      expect(alive).toContain(e1);
      expect(alive).toContain(e3);
      expect(alive).not.toContain(e2);
    });
  });

  describe('generation width (u32 parity)', () => {
    it('should continue incrementing generation beyond 65535', () => {
      const small = new EntityManager(1);
      let id = small.create();

      for (let i = 0; i < 70_000; i++) {
        expect(small.destroy(id)).toBe(true);
        id = small.create();
      }

      expect(small.getGeneration(0)).toBeGreaterThan(65_535);
    });

    it('should keep stale IDs invalid after many slot recyclings', () => {
      const small = new EntityManager(1);
      const stale = small.create();
      expect(small.destroy(stale)).toBe(true);

      let current = small.create();
      for (let i = 0; i < 70_000; i++) {
        expect(small.destroy(current)).toBe(true);
        current = small.create();
      }

      expect(small.isAlive(stale)).toBe(false);
      expect(small.isAlive(current)).toBe(true);
    });
  });
});

// ============= ComponentRegistry =============

describe('ComponentRegistry', () => {
  let em: EntityManager;
  let reg: ComponentRegistry;

  beforeEach(() => {
    em = new EntityManager(100);
    reg = new ComponentRegistry();
  });

  it('should add and get a component', () => {
    const e = em.create();
    reg.add(e, 'position', { x: 10, y: 20 });
    expect(reg.get(e, 'position')).toEqual({ x: 10, y: 20 });
  });

  it('should return undefined for missing component', () => {
    const e = em.create();
    expect(reg.get(e, 'position')).toBeUndefined();
  });

  it('should check has correctly', () => {
    const e = em.create();
    expect(reg.has(e, 'position')).toBe(false);
    reg.add(e, 'position', { x: 0, y: 0 });
    expect(reg.has(e, 'position')).toBe(true);
  });

  it('should remove a component', () => {
    const e = em.create();
    reg.add(e, 'velocity', { vx: 5, vy: 0 });
    expect(reg.remove(e, 'velocity')).toBe(true);
    expect(reg.has(e, 'velocity')).toBe(false);
  });

  it('should return false removing non-existent component', () => {
    const e = em.create();
    expect(reg.remove(e, 'ghost')).toBe(false);
  });

  it('should update component data', () => {
    const e = em.create();
    reg.add(e, 'health', { current: 100, max: 100 });
    reg.add(e, 'health', { current: 50, max: 100 });
    expect(reg.get(e, 'health')).toEqual({ current: 50, max: 100 });
  });

  it('should isolate components between entities', () => {
    const e1 = em.create();
    const e2 = em.create();
    reg.add(e1, 'position', { x: 1, y: 1 });
    reg.add(e2, 'position', { x: 2, y: 2 });
    expect(reg.get(e1, 'position')).toEqual({ x: 1, y: 1 });
    expect(reg.get(e2, 'position')).toEqual({ x: 2, y: 2 });
  });

  it('should support multiple component types', () => {
    const e = em.create();
    reg.add(e, 'position', { x: 5, y: 5 });
    reg.add(e, 'velocity', { vx: 1, vy: 0 });
    reg.add(e, 'health', { current: 100, max: 100 });

    expect(reg.has(e, 'position')).toBe(true);
    expect(reg.has(e, 'velocity')).toBe(true);
    expect(reg.has(e, 'health')).toBe(true);
  });

  it('should remove all components for an entity', () => {
    const e = em.create();
    reg.add(e, 'position', { x: 0, y: 0 });
    reg.add(e, 'velocity', { vx: 0, vy: 0 });
    reg.removeAll(e);
    expect(reg.has(e, 'position')).toBe(false);
    expect(reg.has(e, 'velocity')).toBe(false);
  });
});

// ============= QueryEngine =============

describe('QueryEngine', () => {
  let em: EntityManager;
  let reg: ComponentRegistry;
  let qe: QueryEngine;

  const Position = defineComponent({
    name: 'Position',
    schema: { x: Types.f32, y: Types.f32 },
  });

  const Velocity = defineComponent({
    name: 'Velocity',
    schema: { vx: Types.f32, vy: Types.f32 },
  });

  beforeEach(() => {
    em = new EntityManager(100);
    reg = new ComponentRegistry();
    qe = new QueryEngine();
  });

  it('should return all alive entities for empty query', () => {
    const e1 = em.create();
    const e2 = em.create();
    const results = qe.query([], em, reg);
    expect(results).toContain(e1);
    expect(results).toContain(e2);
  });

  it('should return entities with required components', () => {
    const e1 = em.create();
    const e2 = em.create();
    const e3 = em.create();

    reg.add(e1, 'position', {});
    reg.add(e2, 'position', {});
    reg.add(e2, 'velocity', {});
    reg.add(e3, 'velocity', {});

    const withPos = qe.query(['position'], em, reg);
    expect(withPos).toContain(e1);
    expect(withPos).toContain(e2);
    expect(withPos).not.toContain(e3);
  });

  it('should filter by multiple required components', () => {
    const e1 = em.create();
    const e2 = em.create();

    reg.add(e1, 'position', {});
    reg.add(e1, 'velocity', {});
    reg.add(e2, 'position', {});

    qe.invalidate();
    const results = qe.query(['position', 'velocity'], em, reg);
    expect(results).toContain(e1);
    expect(results).not.toContain(e2);
  });

  it('should return empty for no matches', () => {
    em.create(); // no components
    const results = qe.query(['position'], em, reg);
    expect(results).toHaveLength(0);
  });

  it('should invalidate cache on demand', () => {
    const e = em.create();
    const results1 = qe.query(['position'], em, reg);
    expect(results1).not.toContain(e);

    // Add component and invalidate
    reg.add(e, 'position', {});
    qe.invalidate();

    const results2 = qe.query(['position'], em, reg);
    expect(results2).toContain(e);
  });

  it('should cache results (same query twice)', () => {
    const e = em.create();
    reg.add(e, 'position', {});
    qe.invalidate();

    const r1 = qe.query(['position'], em, reg);
    const r2 = qe.query(['position'], em, reg); // should hit cache
    expect(r1).toBe(r2); // same array reference
  });

  it('should treat definition and name query inputs as equivalent', () => {
    const e = em.create();
    reg.add(e, Position, { x: 1, y: 2 });
    qe.invalidate();

    const byDefinition = qe.query([Position], em, reg);
    const byName = qe.query([Position.name], em, reg);
    expect(byDefinition).toEqual(byName);
    expect(byDefinition).toContain(e);
  });

  it('should canonicalize mixed order and duplicate query inputs', () => {
    const e = em.create();
    reg.add(e, Position, { x: 0, y: 0 });
    reg.add(e, Velocity, { vx: 1, vy: 0 });
    qe.invalidate();

    const r1 = qe.query([Position, Velocity.name, Position.name], em, reg);
    const r2 = qe.query([Velocity, Position], em, reg);
    expect(r1).toEqual(r2);
    expect(r1).toContain(e);
  });

  it('should reject invalid component references in query', () => {
    expect(() => qe.query([''], em, reg)).toThrow('Component type must not be an empty string');
    expect(() => qe.query([null as unknown as string], em, reg)).toThrow(
      'Invalid component type. Expected string or ComponentDefinition',
    );
  });
});
