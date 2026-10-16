/**
 * Entity, component, and query behaviour through the engine public API.
 * Generation checks from #54 read the packed id. Dormancy uses the WASM row flag.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GwenError } from "@gwenjs/schema";
import { normalizeComponentTypesForQuery } from "../src/core/component-type-normalizer";
import { createEngine } from "../src/engine/engine-factory";
import { CoreErrorCodes } from "../src/engine/engine-errors";
import { readLiveQueryIds, setEntityDormant } from "../src/engine/engine-internals";
import type { GwenEngine } from "../src/engine/engine-types";
import { defineComponent, Types } from "../src/schema";
import { entityGeneration, entityIndex, unpackEntityId, type EntityId } from "../src/types/entity";

const Position = defineComponent({
  name: "Position",
  schema: { x: Types.f32, y: Types.f32 },
  defaults: { x: 0, y: 0 },
});

const Velocity = defineComponent({
  name: "Velocity",
  schema: { vx: Types.f32, vy: Types.f32 },
  defaults: { vx: 0, vy: 0 },
});

const Health = defineComponent({
  name: "Health",
  schema: { current: Types.f32, max: Types.f32 },
  defaults: { current: 0, max: 0 },
});

const Hp = defineComponent({
  name: "Hp",
  schema: { value: Types.f32 },
  defaults: { value: 0 },
});

const Ghost = defineComponent({
  name: "Ghost",
  schema: { n: Types.u32 },
  defaults: { n: 0 },
});

const engines: GwenEngine[] = [];

afterEach(async () => {
  const pending = engines.splice(0);
  for (const engine of pending) await engine.stop();
});

async function open(maxEntities = 100): Promise<GwenEngine> {
  const engine = await createEngine({ maxEntities });
  engines.push(engine);
  return engine;
}

function isDormant(engine: GwenEngine, id: EntityId): boolean {
  const parts = unpackEntityId(id);
  return engine.inject("wasm:bridge").isEntityDormant(parts.index, parts.generation);
}

describe("EntityManager", () => {
  let engine: GwenEngine;

  beforeEach(async () => {
    engine = await open();
  });

  describe("create", () => {
    it("should create entities with unique IDs", () => {
      const e1 = engine.createEntity();
      const e2 = engine.createEntity();
      const e3 = engine.createEntity();
      expect(e1).not.toBe(e2);
      expect(e2).not.toBe(e3);
    });

    it("should increment entity count", () => {
      expect(engine.getStats().entityCount).toBe(0);
      engine.createEntity();
      expect(engine.getStats().entityCount).toBe(1);
      engine.createEntity();
      expect(engine.getStats().entityCount).toBe(2);
    });

    it("should throw when capacity is exceeded", async () => {
      const small = await open(3);
      small.createEntity();
      small.createEntity();
      small.createEntity();
      let caught: unknown;
      try {
        small.createEntity();
      } catch (error: unknown) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(GwenError);
      expect(caught).toMatchObject({ code: CoreErrorCodes.ENTITY_LIMIT_REACHED });
      expect((caught as GwenError).message).toContain("3");
    });

    it("should create 1000 entities", async () => {
      const big = await open(1000);
      for (let i = 0; i < 1000; i++) {
        big.createEntity();
      }
      expect(big.getStats().entityCount).toBe(1000);
    });
  });

  describe("destroy", () => {
    it("should destroy alive entity", () => {
      const e = engine.createEntity();
      expect(engine.destroyEntity(e)).toBe(true);
    });

    it("should return false for already-dead entity", () => {
      const e = engine.createEntity();
      engine.destroyEntity(e);
      expect(engine.destroyEntity(e)).toBe(false);
    });

    it("should decrement count on destroy", () => {
      const e1 = engine.createEntity();
      engine.createEntity();
      expect(engine.getStats().entityCount).toBe(2);
      engine.destroyEntity(e1);
      expect(engine.getStats().entityCount).toBe(1);
    });

    it("should NOT affect other entities", () => {
      const e1 = engine.createEntity();
      const e2 = engine.createEntity();
      engine.destroyEntity(e1);
      expect(engine.isAlive(e2)).toBe(true);
    });
  });

  describe("isAlive", () => {
    it("should be true for new entity", () => {
      const e = engine.createEntity();
      expect(engine.isAlive(e)).toBe(true);
    });

    it("should be false after destroy", () => {
      const e = engine.createEntity();
      engine.destroyEntity(e);
      expect(engine.isAlive(e)).toBe(false);
    });

    it("should detect stale IDs (generation counter)", () => {
      const e = engine.createEntity();
      const staleId = e;
      engine.destroyEntity(e);
      const e2 = engine.createEntity();
      expect(engine.isAlive(staleId)).toBe(false);
      expect(engine.destroyEntity(staleId)).toBe(false);
      expect(engine.isAlive(e2)).toBe(true);
      expect(entityIndex(e)).toBe(entityIndex(e2));
      expect(entityGeneration(e2)).not.toBe(entityGeneration(staleId));
    });
  });

  describe("free list reuse", () => {
    it("should reuse destroyed slots", () => {
      const e1 = engine.createEntity();
      engine.destroyEntity(e1);
      const e2 = engine.createEntity();
      expect(e1).not.toBe(e2);
      expect(entityIndex(e1)).toBe(entityIndex(e2));
      expect(entityGeneration(e2)).toBe(entityGeneration(e1) + 1);
      expect(engine.isAlive(e2)).toBe(true);
      expect(engine.getStats().entityCount).toBe(1);
    });
  });

  describe("iteration", () => {
    it("should iterate over all alive entities", () => {
      const e1 = engine.createEntity();
      const e2 = engine.createEntity();
      const e3 = engine.createEntity();
      engine.destroyEntity(e2);

      const alive = [...readLiveQueryIds(engine, [])];
      expect(alive.length).toBe(2);
      expect(alive).toContain(e1);
      expect(alive).toContain(e3);
      expect(alive).not.toContain(e2);
    });
  });

  describe("generation width (u32 parity)", () => {
    it("should continue incrementing generation beyond 65535", async () => {
      const small = await open(1);
      let id = small.createEntity();

      for (let i = 0; i < 70_000; i++) {
        expect(small.destroyEntity(id)).toBe(true);
        id = small.createEntity();
      }

      expect(entityGeneration(id)).toBeGreaterThan(65_535);
    });

    it("should keep stale IDs invalid after many slot recyclings", async () => {
      const small = await open(1);
      const stale = small.createEntity();
      expect(small.destroyEntity(stale)).toBe(true);

      let current = small.createEntity();
      for (let i = 0; i < 70_000; i++) {
        expect(small.destroyEntity(current)).toBe(true);
        current = small.createEntity();
      }

      expect(small.isAlive(stale)).toBe(false);
      expect(small.destroyEntity(stale)).toBe(false);
      expect(small.isAlive(current)).toBe(true);
    });
  });
});

describe("ComponentRegistry", () => {
  let engine: GwenEngine;

  beforeEach(async () => {
    engine = await open();
  });

  it("should add and get a component", () => {
    const e = engine.createEntity();
    engine.addComponent(e, Position, { x: 10, y: 20 });
    expect(engine.getComponent(e, Position)).toEqual({ x: 10, y: 20 });
  });

  it("should return undefined for missing component", () => {
    const e = engine.createEntity();
    expect(engine.getComponent(e, Position)).toBeUndefined();
  });

  it("should check has correctly", () => {
    const e = engine.createEntity();
    expect(engine.hasComponent(e, Position)).toBe(false);
    engine.addComponent(e, Position, { x: 0, y: 0 });
    expect(engine.hasComponent(e, Position)).toBe(true);
  });

  it("should remove a component", () => {
    const e = engine.createEntity();
    engine.addComponent(e, Velocity, { vx: 5, vy: 0 });
    expect(engine.removeComponent(e, Velocity)).toBe(true);
    expect(engine.hasComponent(e, Velocity)).toBe(false);
  });

  it("should return false removing non-existent component", () => {
    const e = engine.createEntity();
    expect(engine.removeComponent(e, Ghost)).toBe(false);
  });

  it("should update component data", () => {
    const e = engine.createEntity();
    engine.addComponent(e, Health, { current: 100, max: 100 });
    engine.addComponent(e, Health, { current: 50, max: 100 });
    expect(engine.getComponent(e, Health)).toEqual({ current: 50, max: 100 });
  });

  it("should isolate components between entities", () => {
    const e1 = engine.createEntity();
    const e2 = engine.createEntity();
    engine.addComponent(e1, Position, { x: 1, y: 1 });
    engine.addComponent(e2, Position, { x: 2, y: 2 });
    expect(engine.getComponent(e1, Position)).toEqual({ x: 1, y: 1 });
    expect(engine.getComponent(e2, Position)).toEqual({ x: 2, y: 2 });
  });

  it("should support multiple component types", () => {
    const e = engine.createEntity();
    engine.addComponent(e, Position, { x: 5, y: 5 });
    engine.addComponent(e, Velocity, { vx: 1, vy: 0 });
    engine.addComponent(e, Health, { current: 100, max: 100 });

    expect(engine.hasComponent(e, Position)).toBe(true);
    expect(engine.hasComponent(e, Velocity)).toBe(true);
    expect(engine.hasComponent(e, Health)).toBe(true);
  });

  it("should remove all components for an entity", () => {
    const e = engine.createEntity();
    engine.addComponent(e, Position, { x: 0, y: 0 });
    engine.addComponent(e, Velocity, { vx: 0, vy: 0 });
    expect(engine.removeComponent(e, Position)).toBe(true);
    expect(engine.removeComponent(e, Velocity)).toBe(true);
    expect(engine.hasComponent(e, Position)).toBe(false);
    expect(engine.hasComponent(e, Velocity)).toBe(false);
  });
});

describe("QueryEngine", () => {
  let engine: GwenEngine;

  beforeEach(async () => {
    engine = await open();
  });

  it("should return all alive entities for empty query", () => {
    const e1 = engine.createEntity();
    const e2 = engine.createEntity();
    const results = readLiveQueryIds(engine, []);
    expect(results).toContain(e1);
    expect(results).toContain(e2);
  });

  it("should return entities with required components", () => {
    const e1 = engine.createEntity();
    const e2 = engine.createEntity();
    const e3 = engine.createEntity();

    engine.addComponent(e1, Position, {});
    engine.addComponent(e2, Position, {});
    engine.addComponent(e2, Velocity, {});
    engine.addComponent(e3, Velocity, {});

    const withPos = readLiveQueryIds(engine, [Position]);
    expect(withPos).toContain(e1);
    expect(withPos).toContain(e2);
    expect(withPos).not.toContain(e3);
  });

  it("should filter by multiple required components", () => {
    const e1 = engine.createEntity();
    const e2 = engine.createEntity();

    engine.addComponent(e1, Position, {});
    engine.addComponent(e1, Velocity, {});
    engine.addComponent(e2, Position, {});

    const results = readLiveQueryIds(engine, [Position, Velocity]);
    expect(results).toContain(e1);
    expect(results).not.toContain(e2);
  });

  it("should return empty for no matches", () => {
    engine.createEntity();
    const results = readLiveQueryIds(engine, [Position]);
    expect(results).toHaveLength(0);
  });

  it("should invalidate cache on demand", () => {
    const e = engine.createEntity();
    const results1 = readLiveQueryIds(engine, [Position]);
    expect(results1).not.toContain(e);

    engine.addComponent(e, Position, {});

    const results2 = readLiveQueryIds(engine, [Position]);
    expect(results2).toContain(e);
  });

  it("should cache results (same query twice)", () => {
    const e = engine.createEntity();
    engine.addComponent(e, Position, {});

    const r1 = readLiveQueryIds(engine, [Position]);
    const r2 = readLiveQueryIds(engine, [Position]);
    expect(r1).toBe(r2);
  });

  it("refills the same id array when a second entity is added", () => {
    const firstId = engine.createEntity();
    engine.addComponent(firstId, Position, { x: 1, y: 2 });
    const first = readLiveQueryIds(engine, [Position]);
    const secondId = engine.createEntity();
    engine.addComponent(secondId, Position, { x: 3, y: 4 });
    const again = readLiveQueryIds(engine, [Position]);
    expect(again).toBe(first);
    expect(again).toContain(secondId);
  });

  it("should treat definition and name query inputs as equivalent", () => {
    const e = engine.createEntity();
    engine.addComponent(e, Position, { x: 1, y: 2 });

    expect(normalizeComponentTypesForQuery([Position])).toEqual(
      normalizeComponentTypesForQuery([Position.name]),
    );
    expect(readLiveQueryIds(engine, [Position])).toContain(e);
  });

  it("should canonicalize mixed order and duplicate query inputs", () => {
    const e = engine.createEntity();
    engine.addComponent(e, Position, { x: 0, y: 0 });
    engine.addComponent(e, Velocity, { vx: 1, vy: 0 });

    expect(normalizeComponentTypesForQuery([Position, Velocity.name, Position.name])).toEqual(
      normalizeComponentTypesForQuery([Velocity, Position]),
    );
    const r1 = readLiveQueryIds(engine, [Position, Velocity]);
    const r2 = readLiveQueryIds(engine, [Velocity, Position]);
    expect(r1).toEqual(r2);
    expect(r1).toContain(e);
  });

  it("should reject invalid component references in query", () => {
    expect(() => normalizeComponentTypesForQuery([""])).toThrow(
      "Component type must not be an empty string",
    );
    expect(() => normalizeComponentTypesForQuery([null])).toThrow(
      "Invalid component type. Expected string or ComponentDefinition",
    );
  });

  it("should use precomputedKey when provided", () => {
    const e = engine.createEntity();
    engine.addComponent(e, Position, { x: 1, y: 2 });
    engine.addComponent(e, Velocity, { vx: 1, vy: 0 });

    const precomputedKey = "Position|Velocity";
    const seen: EntityId[] = [];
    for (const entity of engine.createLiveQuery([Position, Velocity], precomputedKey)) {
      seen.push(entity.id);
    }
    expect(seen).toContain(e);
  });

  it("precomputedKey should hit cache on subsequent calls", () => {
    const e = engine.createEntity();
    engine.addComponent(e, Position, { x: 1, y: 2 });

    const precomputedKey = "Position";
    engine.createLiveQuery([Position], precomputedKey);
    const r1 = readLiveQueryIds(engine, [Position]);
    const r2 = readLiveQueryIds(engine, [Position]);
    expect(r1).toBe(r2);
    expect(r1).toContain(e);
  });

  it("precomputedKey should work with different component orders", () => {
    const e = engine.createEntity();
    engine.addComponent(e, Position, { x: 1, y: 2 });
    engine.addComponent(e, Velocity, { vx: 1, vy: 0 });

    const precomputedKey = "Position|Velocity";
    const seen: EntityId[] = [];
    for (const entity of engine.createLiveQuery([Velocity, Position], precomputedKey)) {
      seen.push(entity.id);
    }
    expect(seen).toContain(e);
  });
});

describe("dormant slot byte (#56)", () => {
  it("sets and clears the dormant byte", async () => {
    const engine = await open(8);
    const id = engine.createEntity();
    engine.addComponent(id, Position, { x: 1, y: 1 });
    expect(isDormant(engine, id)).toBe(false);
    expect(setEntityDormant(engine, id, true)).toBe(true);
    expect(isDormant(engine, id)).toBe(true);
    expect(engine.isAlive(id)).toBe(true);
    expect(setEntityDormant(engine, id, false)).toBe(true);
    expect(isDormant(engine, id)).toBe(false);
  });

  it("resets the dormant byte on destroy and on the recycled create", async () => {
    const engine = await open(4);
    const id = engine.createEntity();
    engine.addComponent(id, Position, { x: 1, y: 1 });
    expect(setEntityDormant(engine, id, true)).toBe(true);
    expect(engine.destroyEntity(id)).toBe(true);
    expect(isDormant(engine, id)).toBe(false);
    expect(setEntityDormant(engine, id, true)).toBe(false);
    const recycled = engine.createEntity();
    expect(isDormant(engine, recycled)).toBe(false);
    expect(entityIndex(recycled)).toBe(entityIndex(id));
  });

  it("keeps the cached query array across a dormancy toggle and an in-place write", async () => {
    const engine = await open(4);
    const id = engine.createEntity();
    engine.addComponent(id, Hp, { value: 1 });
    const first = readLiveQueryIds(engine, [Hp]);

    expect(setEntityDormant(engine, id, true)).toBe(true);
    expect(readLiveQueryIds(engine, [Hp])).toBe(first);
    expect([...engine.createLiveQuery([Hp])]).toEqual([]);
    expect(setEntityDormant(engine, id, false)).toBe(true);

    engine.addComponent(id, Hp, { value: 4 });
    expect(readLiveQueryIds(engine, [Hp])).toBe(first);
    expect(engine.getComponent(id, Hp)).toEqual({ value: 4 });
  });
});
