/**
 * EngineEntities on a real light bridge, beside the engine facade.
 */

import { afterEach, describe, expect, it } from "vitest";
import { GwenError } from "@gwenjs/schema";
import { Types, defineComponent } from "../../src/schema";
import { createEntityId } from "../../src/types/entity";
import { createEngine } from "../../src/engine/engine-factory";
import type { GwenEngine } from "../../src/engine/engine-types";
import { EngineEntities, type EngineEntitiesDeps } from "../../src/engine/engine-entities";

const Position = defineComponent({
  name: "Position",
  schema: { x: Types.f32, y: Types.f32 },
  defaults: { x: 0, y: 0 },
});

const engines: GwenEngine[] = [];

afterEach(async () => {
  const pending = engines.splice(0);
  for (const engine of pending) await engine.stop();
});

async function open(patch: Partial<Pick<EngineEntitiesDeps, "maxEntities" | "assertState">> = {}) {
  const maxEntities = patch.maxEntities ?? 8;
  const engine = await createEngine({ maxEntities });
  engines.push(engine);
  const destroyed: bigint[] = [];
  const calls: string[] = [];
  const entities = new EngineEntities({
    maxEntities,
    engine,
    bridge: engine.inject("wasm:bridge"),
    assertState(method) {
      calls.push(method);
      patch.assertState?.(method);
    },
    emitDestroy(id) {
      expect(entities.isAlive(id)).toBe(false);
      expect(entities.getComponent(id, Position)).toBeUndefined();
      destroyed.push(id);
    },
    reportInconsistent(error) {
      throw error;
    },
  });
  return { entities, destroyed, calls };
}

function idsOf(query: Iterable<{ id: bigint }>): bigint[] {
  const ids: bigint[] = [];
  for (const entity of query) ids.push(entity.id);
  return ids;
}

describe("EngineEntities", async () => {
  it("constructs without createEngine and createEntity then isAlive is true", async () => {
    const { entities, calls } = await open();

    const id = entities.createEntity();

    expect(entities.isAlive(id)).toBe(true);
    expect(entities.count()).toBe(1);
    expect(calls).toEqual(["createEntity"]);
  });

  it("constructs without createEngine and a second createEntity returns another id", async () => {
    const { entities } = await open();
    const first = entities.createEntity();

    const second = entities.createEntity();

    expect(second).not.toBe(first);
    expect(entities.count()).toBe(2);
    expect(entities.isAlive(first)).toBe(true);
    expect(entities.isAlive(second)).toBe(true);
  });

  it("constructs without createEngine and an empty container stores nothing", async () => {
    const { entities } = await open();

    expect(entities.count()).toBe(0);
    expect(entities.canSpawn(0)).toBe(true);
    expect(entities.canSpawn(1)).toBe(true);
    const absent = createEntityId(0, 0);
    expect(entities.isAlive(absent)).toBe(false);
    expect(entities.getComponent(absent, Position)).toBeUndefined();
    expect(entities.hasComponent(absent, Position)).toBe(false);
    expect(idsOf(entities.createLiveQuery([Position]))).toEqual([]);
  });

  it("constructs without createEngine and canSpawn is false at max plus one", async () => {
    const { entities } = await open({ maxEntities: 1 });
    entities.createEntity();

    expect(entities.canSpawn(0)).toBe(true);
    expect(entities.canSpawn(1)).toBe(false);
    expect(entities.count()).toBe(1);
  });

  it("constructs without createEngine and createEntity at the limit throws entity capacity exceeded", async () => {
    const { entities } = await open({ maxEntities: 1 });
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
    expect(caught.message).toContain("1");
    expect(entities.count()).toBe(1);
  });

  it("constructs without createEngine and destroyEntity removes the id and reports it once", async () => {
    const { entities, destroyed, calls } = await open();
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

  it("constructs without createEngine and addComponent then getComponent returns the merged value", async () => {
    const { entities, calls } = await open();
    const id = entities.createEntity();

    entities.addComponent(id, Position, { x: 3, y: 4 });

    expect(entities.getComponent(id, Position)).toEqual({ x: 3, y: 4 });
    expect(entities.hasComponent(id, Position)).toBe(true);
    expect(calls).toEqual(["createEntity", "addComponent"]);
  });

  it("constructs without createEngine and a second addComponent replaces the field", async () => {
    const { entities } = await open();
    const id = entities.createEntity();
    entities.addComponent(id, Position, { x: 1, y: 2 });

    entities.addComponent(id, Position, { x: 5 });

    expect(entities.getComponent(id, Position)).toEqual({ x: 5, y: 2 });
  });

  it("constructs without createEngine and removeComponent drops the value", async () => {
    const { entities, calls } = await open();
    const id = entities.createEntity();
    entities.addComponent(id, Position, { x: 1, y: 2 });

    expect(entities.removeComponent(id, Position)).toBe(true);

    expect(entities.getComponent(id, Position)).toBeUndefined();
    expect(entities.hasComponent(id, Position)).toBe(false);
    expect(entities.removeComponent(id, Position)).toBe(false);
    expect(calls).toEqual(["createEntity", "addComponent", "removeComponent", "removeComponent"]);
  });

  it("constructs without createEngine and createLiveQuery returns the component", async () => {
    const { entities } = await open();
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

  it("constructs without createEngine and a dormant entity stays out of the live query", async () => {
    const { entities } = await open();
    const id = entities.createEntity();
    entities.addComponent(id, Position, { x: 1, y: 1 });

    expect(entities.setDormant(id, true)).toBe(true);

    expect(idsOf(entities.createLiveQuery([Position]))).toEqual([]);
    // A component query is the awake chunk list, so the dormant id is absent.
    expect(entities.resolveIds([Position])).toEqual([]);
    expect(entities.isAlive(id)).toBe(true);
  });

  it("constructs without createEngine and a second container does not see the first id", async () => {
    const first = await open();
    const second = await open();
    const id = first.entities.createEntity();

    expect(second.entities.isAlive(id)).toBe(false);
    expect(second.entities.count()).toBe(0);
    expect(second.entities.getComponent(id, Position)).toBeUndefined();
  });

  it("constructs without createEngine and createEntity while faulted does not store an entity", async () => {
    const gate = new GwenError(
      "CORE:INVALID_STATE_TRANSITION",
      "[GwenEngine] createEntity() is not allowed while the engine is faulted.",
    );
    const { entities, calls } = await open({
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

  it("constructs without createEngine and addComponent while faulted does not store the component", async () => {
    const gate = new GwenError(
      "CORE:INVALID_STATE_TRANSITION",
      "[GwenEngine] addComponent() is not allowed while the engine is faulted.",
    );
    let armed = false;
    const { entities } = await open({
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
  });

  it("constructs without createEngine and destroyEntity while faulted leaves the entity alive", async () => {
    const gate = new GwenError(
      "CORE:INVALID_STATE_TRANSITION",
      "[GwenEngine] destroyEntity() is not allowed while the engine is faulted.",
    );
    let armed = false;
    const { entities, destroyed } = await open({
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

  it("constructs without createEngine and removeComponent while faulted leaves the component", async () => {
    const gate = new GwenError(
      "CORE:INVALID_STATE_TRANSITION",
      "[GwenEngine] removeComponent() is not allowed while the engine is faulted.",
    );
    let armed = false;
    const { entities } = await open({
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

  it("constructs without createEngine and canSpawn while faulted still reports capacity", async () => {
    const gate = new GwenError(
      "CORE:INVALID_STATE_TRANSITION",
      "[GwenEngine] canSpawn() is not allowed while the engine is faulted.",
    );
    const { entities, calls } = await open({
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
