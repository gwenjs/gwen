/**
 * EngineEntities without an engine.
 * Each test builds a real entity map and reads the value back.
 */

import { describe, expect, it } from "vitest";
import { GwenError } from "@gwenjs/schema";
import { Types, defineComponent } from "../../src/schema";
import { createEntityId } from "../../src/types/entity";
import { EngineEntities, type EngineEntitiesDeps } from "../../src/engine/engine-entities";

const Position = defineComponent({
  name: "Position",
  schema: { x: Types.f32, y: Types.f32 },
  defaults: { x: 0, y: 0 },
});

function open(patch: Partial<EngineEntitiesDeps> = {}) {
  const registered: string[] = [];
  const destroyed: bigint[] = [];
  const calls: string[] = [];
  const entities = new EngineEntities({
    maxEntities: 8,
    queryCacheSize: 4,
    registerComponent(type) {
      registered.push(type);
      return registered.length;
    },
    ...patch,
    assertState(method) {
      calls.push(method);
      patch.assertState?.(method);
    },
    emitDestroy(id) {
      expect(entities.isAlive(id)).toBe(false);
      expect(entities.getComponent(id, Position)).toBeUndefined();
      destroyed.push(id);
    },
  });
  return { entities, registered, destroyed, calls };
}

function idsOf(query: Iterable<{ id: bigint }>): bigint[] {
  const ids: bigint[] = [];
  for (const entity of query) ids.push(entity.id);
  return ids;
}

describe("EngineEntities", () => {
  it("constructs without createEngine and createEntity then isAlive is true", () => {
    const { entities, calls } = open();

    const id = entities.createEntity();

    expect(entities.isAlive(id)).toBe(true);
    expect(entities.count()).toBe(1);
    expect(calls).toEqual(["createEntity"]);
  });

  it("constructs without createEngine and a second createEntity returns another id", () => {
    const { entities } = open();
    const first = entities.createEntity();

    const second = entities.createEntity();

    expect(second).not.toBe(first);
    expect(entities.count()).toBe(2);
    expect(entities.isAlive(first)).toBe(true);
    expect(entities.isAlive(second)).toBe(true);
  });

  it("constructs without createEngine and an empty container stores nothing", () => {
    const { entities } = open();

    expect(entities.count()).toBe(0);
    expect(entities.canSpawn(0)).toBe(true);
    expect(entities.canSpawn(1)).toBe(true);
    const absent = createEntityId(0, 0);
    expect(entities.isAlive(absent)).toBe(false);
    expect(entities.getComponent(absent, Position)).toBeUndefined();
    expect(entities.hasComponent(absent, Position)).toBe(false);
    expect(idsOf(entities.createLiveQuery([Position]))).toEqual([]);
  });

  it("constructs without createEngine and canSpawn is false at max plus one", () => {
    const { entities } = open({ maxEntities: 1 });
    entities.createEntity();

    expect(entities.canSpawn(0)).toBe(true);
    expect(entities.canSpawn(1)).toBe(false);
    expect(entities.count()).toBe(1);
  });

  it("constructs without createEngine and createEntity at the limit throws entity capacity exceeded", () => {
    const { entities } = open({ maxEntities: 1 });
    entities.createEntity();
    let caught: unknown;
    try {
      entities.createEntity();
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(GwenError);
    if (!(caught instanceof GwenError)) throw caught;
    expect(caught.code).toBe("CORE:ENTITY_LIMIT_REACHED");
    expect(caught.message).toBe("[ECS] Entity capacity exceeded (max: 1)");
    expect(entities.count()).toBe(1);
  });

  it("constructs without createEngine and destroyEntity removes the id and reports it once", () => {
    const { entities, destroyed, calls } = open();
    const id = entities.createEntity();
    entities.addComponent(id, Position, { x: 1, y: 2 });

    expect(entities.destroyEntity(id)).toBe(true);

    expect(calls).toEqual(["createEntity", "addComponent", "destroyEntity"]);
    expect(destroyed).toEqual([id]);
    expect(entities.isAlive(id)).toBe(false);
    expect(entities.count()).toBe(0);
    expect(entities.getComponent(id, Position)).toBeUndefined();
    expect(entities.setDormant(id, true)).toBe(false);
    expect(entities.destroyEntity(id)).toBe(false);
    expect(destroyed).toEqual([id]);
    expect(calls).toEqual(["createEntity", "addComponent", "destroyEntity", "destroyEntity"]);
  });

  it("constructs without createEngine and addComponent then getComponent returns the merged value", () => {
    const { entities, registered, calls } = open();
    const id = entities.createEntity();

    entities.addComponent(id, Position, { x: 3, y: 4 });

    expect(entities.getComponent(id, Position)).toEqual({ x: 3, y: 4 });
    expect(entities.hasComponent(id, Position)).toBe(true);
    expect(registered).toEqual(["Position"]);
    expect(calls).toEqual(["createEntity", "addComponent"]);
  });

  it("constructs without createEngine and a second addComponent replaces the field", () => {
    const { entities, registered } = open();
    const id = entities.createEntity();
    entities.addComponent(id, Position, { x: 1, y: 2 });

    entities.addComponent(id, Position, { x: 5 });

    expect(entities.getComponent(id, Position)).toEqual({ x: 5, y: 2 });
    expect(registered).toEqual(["Position"]);
  });

  it("constructs without createEngine and removeComponent drops the value", () => {
    const { entities, calls } = open();
    const id = entities.createEntity();
    entities.addComponent(id, Position, { x: 1, y: 2 });

    expect(entities.removeComponent(id, Position)).toBe(true);

    expect(entities.getComponent(id, Position)).toBeUndefined();
    expect(entities.hasComponent(id, Position)).toBe(false);
    expect(entities.removeComponent(id, Position)).toBe(false);
    expect(calls).toEqual(["createEntity", "addComponent", "removeComponent", "removeComponent"]);
  });

  it("constructs without createEngine and createLiveQuery returns the component", () => {
    const { entities } = open();
    const id = entities.createEntity();
    entities.addComponent(id, Position, { x: 8, y: 9 });
    const query = entities.createLiveQuery([Position]);

    const seen: Array<{ id: bigint; x: number; y: number }> = [];
    for (const entity of query) {
      const pos = entity.get(Position);
      seen.push({ id: entity.id, x: pos.x, y: pos.y });
    }

    expect(seen).toEqual([{ id, x: 8, y: 9 }]);
  });

  it("constructs without createEngine and a dormant entity stays out of the live query", () => {
    const { entities } = open();
    const id = entities.createEntity();
    entities.addComponent(id, Position, { x: 1, y: 1 });

    expect(entities.setDormant(id, true)).toBe(true);

    expect(idsOf(entities.createLiveQuery([Position]))).toEqual([]);
    expect(entities.resolveIds([Position])).toEqual([id]);
    expect(entities.isAlive(id)).toBe(true);
  });

  it("constructs without createEngine and a second container does not see the first id", () => {
    const first = open();
    const second = open();
    const id = first.entities.createEntity();

    expect(second.entities.isAlive(id)).toBe(false);
    expect(second.entities.count()).toBe(0);
    expect(second.entities.getComponent(id, Position)).toBeUndefined();
  });

  it("constructs without createEngine and createEntity while faulted does not store an entity", () => {
    const gate = new GwenError(
      "CORE:INVALID_STATE_TRANSITION",
      "[GwenEngine] createEntity() is not allowed while the engine is faulted.",
    );
    const { entities, calls } = open({
      assertState() {
        throw gate;
      },
    });
    let caught: unknown;
    try {
      entities.createEntity();
    } catch (error) {
      caught = error;
    }

    expect(caught).toBe(gate);
    expect(entities.count()).toBe(0);
    expect(calls).toEqual(["createEntity"]);
  });

  it("constructs without createEngine and addComponent while faulted does not store the component", () => {
    const gate = new GwenError(
      "CORE:INVALID_STATE_TRANSITION",
      "[GwenEngine] addComponent() is not allowed while the engine is faulted.",
    );
    let armed = false;
    const { entities, registered } = open({
      assertState() {
        if (armed) throw gate;
      },
    });
    const id = entities.createEntity();
    armed = true;
    let caught: unknown;
    try {
      entities.addComponent(id, Position, { x: 1, y: 2 });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBe(gate);
    expect(entities.getComponent(id, Position)).toBeUndefined();
    expect(registered).toEqual([]);
  });

  it("constructs without createEngine and destroyEntity while faulted leaves the entity alive", () => {
    const gate = new GwenError(
      "CORE:INVALID_STATE_TRANSITION",
      "[GwenEngine] destroyEntity() is not allowed while the engine is faulted.",
    );
    let armed = false;
    const { entities, destroyed } = open({
      assertState() {
        if (armed) throw gate;
      },
    });
    const id = entities.createEntity();
    armed = true;
    let caught: unknown;
    try {
      entities.destroyEntity(id);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBe(gate);
    expect(entities.isAlive(id)).toBe(true);
    expect(destroyed).toEqual([]);
  });

  it("constructs without createEngine and removeComponent while faulted leaves the component", () => {
    const gate = new GwenError(
      "CORE:INVALID_STATE_TRANSITION",
      "[GwenEngine] removeComponent() is not allowed while the engine is faulted.",
    );
    let armed = false;
    const { entities } = open({
      assertState() {
        if (armed) throw gate;
      },
    });
    const id = entities.createEntity();
    entities.addComponent(id, Position, { x: 1, y: 2 });
    armed = true;
    let caught: unknown;
    try {
      entities.removeComponent(id, Position);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBe(gate);
    expect(entities.getComponent(id, Position)).toEqual({ x: 1, y: 2 });
  });

  it("constructs without createEngine and canSpawn while faulted still reports capacity", () => {
    const gate = new GwenError(
      "CORE:INVALID_STATE_TRANSITION",
      "[GwenEngine] canSpawn() is not allowed while the engine is faulted.",
    );
    const { entities, calls } = open({
      maxEntities: 1,
      assertState() {
        throw gate;
      },
    });

    expect(entities.canSpawn(1)).toBe(true);
    expect(entities.count()).toBe(0);
    expect(calls).toEqual([]);
  });
});
