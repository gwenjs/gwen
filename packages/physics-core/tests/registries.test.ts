/**
 * Contact and sensor callbacks stay on the engine that subscribed them.
 */

import { afterEach, describe, expect, it } from "vitest";
import { GwenContextError, type GwenEngine } from "@gwenjs/core";
import { definePlugin } from "@gwenjs/kit/plugin";
import { createEngine } from "@gwenjs/core/node";
import * as api from "../src/index.js";

const engines: GwenEngine[] = [];

afterEach(async () => {
  const pending = engines.splice(0);
  for (const engine of pending) await engine.stop();
});

function contactPair(entity: bigint): {
  entityA: bigint;
  entityB: bigint;
  started: boolean;
} {
  return { entityA: entity, entityB: entity, started: true };
}

describe("contact and sensor registries", () => {
  it("two engines are isolated", async () => {
    expect(typeof api.createContactRegistry).toBe("function");
    expect(typeof api.createSensorRegistry).toBe("function");
    expect(typeof api.onContact).toBe("function");
    expect(typeof api.onSensorEnter).toBe("function");
    const engineA = await createEngine({ maxEntities: 8 });
    const engineB = await createEngine({ maxEntities: 8 });
    engines.push(engineA, engineB);
    let aContacts = 0;
    let bContacts = 0;
    let aSensors = 0;
    let bSensors = 0;
    await engineA.run(() => {
      api.onContact(() => {
        aContacts += 1;
      });
      api.onSensorEnter(api.SENSOR_ID_FOOT, () => {
        aSensors += 1;
      });
    });
    await engineB.run(() => {
      api.onContact(() => {
        bContacts += 1;
      });
      api.onSensorEnter(api.SENSOR_ID_FOOT, () => {
        bSensors += 1;
      });
    });
    const left = engineA.createEntity();
    const right = engineB.createEntity();
    api.createContactRegistry().get(engineB).emit({ entityA: left, entityB: right, started: true });
    api.createSensorRegistry().get(engineB).emit(api.SENSOR_ID_FOOT, right, "enter");
    expect(aContacts).toBe(0);
    expect(bContacts).toBe(1);
    expect(aSensors).toBe(0);
    expect(bSensors).toBe(1);
  });

  it("stop() clears only its own engine", async () => {
    expect(typeof api.onContact).toBe("function");
    expect(typeof api.onSensorEnter).toBe("function");
    expect(typeof api.clearEngineContacts).toBe("function");
    expect(typeof api.createContactRegistry).toBe("function");
    expect(typeof api.createSensorRegistry).toBe("function");
    const engineA = await createEngine({ maxEntities: 8 });
    const engineB = await createEngine({ maxEntities: 8 });
    engines.push(engineA, engineB);
    let aContacts = 0;
    let bContacts = 0;
    let aSensors = 0;
    let bSensors = 0;
    await engineA.run(() => {
      api.onContact(() => {
        aContacts += 1;
      });
      api.onSensorEnter(api.SENSOR_ID_FOOT, () => {
        aSensors += 1;
      });
    });
    await engineB.run(() => {
      api.onContact(() => {
        bContacts += 1;
      });
      api.onSensorEnter(api.SENSOR_ID_FOOT, () => {
        bSensors += 1;
      });
    });
    const contacts = api.createContactRegistry();
    const sensors = api.createSensorRegistry();
    const contactsA = contacts.get(engineA);
    const contactsB = contacts.get(engineB);
    const sensorsA = sensors.get(engineA);
    const sensorsB = sensors.get(engineB);
    const left = engineA.createEntity();
    const right = engineB.createEntity();
    await engineA.stop();
    contactsA.emit({ entityA: left, entityB: right, started: true });
    contactsB.emit({ entityA: left, entityB: right, started: true });
    sensorsA.emit(api.SENSOR_ID_FOOT, right, "enter");
    sensorsB.emit(api.SENSOR_ID_FOOT, right, "enter");
    expect(aContacts).toBe(0);
    expect(bContacts).toBe(1);
    expect(aSensors).toBe(0);
    expect(bSensors).toBe(1);
  });

  it("unsubscribe removes exactly one callback", async () => {
    expect(typeof api.onContact).toBe("function");
    expect(typeof api.onSensorEnter).toBe("function");
    expect(typeof api.onSensorExit).toBe("function");
    expect(typeof api.createContactRegistry).toBe("function");
    expect(typeof api.createSensorRegistry).toBe("function");
    const engine = await createEngine({ maxEntities: 8 });
    engines.push(engine);
    let first = 0;
    let second = 0;
    let entered = 0;
    let exitDropped = 0;
    let exitKept = 0;
    let dropContact: () => void = () => undefined;
    let dropExit: () => void = () => undefined;
    await engine.run(() => {
      dropContact = api.onContact(() => {
        first += 1;
      });
      api.onContact(() => {
        second += 1;
      });
      api.onSensorEnter(api.SENSOR_ID_FOOT, () => {
        entered += 1;
      });
      dropExit = api.onSensorExit(api.SENSOR_ID_FOOT, () => {
        exitDropped += 1;
      });
      api.onSensorExit(api.SENSOR_ID_FOOT, () => {
        exitKept += 1;
      });
    });
    dropContact();
    dropContact();
    dropExit();
    dropExit();
    const entity = engine.createEntity();
    api.createContactRegistry().get(engine).emit({
      entityA: entity,
      entityB: entity,
      started: true,
    });
    const sensors = api.createSensorRegistry().get(engine);
    sensors.emit(api.SENSOR_ID_FOOT, entity, "enter");
    sensors.emit(api.SENSOR_ID_FOOT, entity, "exit");
    expect(first).toBe(0);
    expect(second).toBe(1);
    expect(entered).toBe(1);
    expect(exitDropped).toBe(0);
    expect(exitKept).toBe(1);
  });

  it("clearEngineContacts clears the lists through the engine seen by a plugin setup", async () => {
    expect(typeof api.clearEngineContacts).toBe("function");
    expect(typeof api.onContact).toBe("function");
    expect(typeof api.onSensorEnter).toBe("function");
    const engine = await createEngine({ maxEntities: 8 });
    engines.push(engine);
    let contacts = 0;
    let sensors = 0;
    await engine.use(
      definePlugin({}, () => ({
        name: "p58-clear-contacts",
        setup(host) {
          api.onContact(() => {
            contacts += 1;
          });
          api.onSensorEnter(api.SENSOR_ID_FOOT, () => {
            sensors += 1;
          });
          api.clearEngineContacts(host);
        },
      }))(),
    );
    const entity = engine.createEntity();
    api
      .createContactRegistry()
      .get(engine)
      .emit({ entityA: entity, entityB: entity, started: true });
    api.createSensorRegistry().get(engine).emit(api.SENSOR_ID_FOOT, entity, "enter");
    expect(contacts).toBe(0);
    expect(sensors).toBe(0);
  });

  it("onContact throws outside an engine context", () => {
    expect(typeof api.onContact).toBe("function");
    let caught: unknown;
    try {
      api.onContact(() => undefined);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(GwenContextError);
    if (!(caught instanceof GwenContextError)) return;
    expect(caught.code).toBe("CORE:OUTSIDE_ENGINE_CONTEXT");
  });

  it("a contact callback that unsubscribes itself during emit does not skip the next callback", async () => {
    expect(typeof api.onContact).toBe("function");
    const engine = await createEngine({ maxEntities: 8 });
    engines.push(engine);
    const entity = engine.createEntity();
    const registry = api.createContactRegistry().get(engine);
    registry.emit(contactPair(entity));
    expect(registry.entries.length).toBe(0);
    const order: string[] = [];
    let dropFirst: () => void = () => undefined;
    await engine.run(() => {
      dropFirst = api.onContact(() => {
        order.push("a");
        dropFirst();
      });
      api.onContact(() => {
        order.push("b");
      });
    });
    registry.emit(contactPair(entity));
    expect(order).toEqual(["a", "b"]);
    registry.emit(contactPair(entity));
    expect(order).toEqual(["a", "b", "b"]);
    api.clearEngineContacts(engine);
    let alone = 0;
    let dropAlone: () => void = () => undefined;
    await engine.run(() => {
      dropAlone = api.onContact(() => {
        alone += 1;
        dropAlone();
      });
    });
    registry.emit(contactPair(entity));
    expect(alone).toBe(1);
    expect(registry.entries.length).toBe(0);
  });

  it("a contact callback that removes the next callback during emit still lets it run for that contact", async () => {
    expect(typeof api.onContact).toBe("function");
    const engine = await createEngine({ maxEntities: 8 });
    engines.push(engine);
    const entity = engine.createEntity();
    const registry = api.createContactRegistry().get(engine);
    const order: string[] = [];
    let dropNext: () => void = () => undefined;
    await engine.run(() => {
      api.onContact(() => {
        order.push("a");
        dropNext();
      });
      dropNext = api.onContact(() => {
        order.push("b");
      });
    });
    registry.emit(contactPair(entity));
    expect(order).toEqual(["a", "b"]);
    registry.emit(contactPair(entity));
    expect(order).toEqual(["a", "b", "a"]);
  });

  it("removeEntity during a contact emit keeps the entry until the walk ends", async () => {
    expect(typeof api.createContactRegistry).toBe("function");
    const engine = await createEngine({ maxEntities: 8 });
    engines.push(engine);
    const dropped = 2n;
    const kept = 3n;
    const registry = api.createContactRegistry().get(engine);
    expect(typeof registry.removeEntity).toBe("function");
    if (typeof registry.removeEntity !== "function") return;
    registry.emit(contactPair(dropped));
    expect(registry.entries.length).toBe(0);
    let lengthDuring = -1;
    let second = 0;
    await engine.run(() => {
      api.onContact(() => {
        registry.removeEntity(dropped);
        lengthDuring = registry.entries.length;
      });
      api.onContact(() => {
        second += 1;
      }, dropped);
      api.onContact(() => undefined, kept);
    });
    registry.emit(contactPair(dropped));
    expect(lengthDuring).toBe(3);
    expect(second).toBe(1);
    expect(registry.entries.filter((entry) => entry.entityId === dropped).length).toBe(0);
    expect(registry.entries.filter((entry) => entry.entityId === kept).length).toBe(1);
    registry.emit(contactPair(dropped));
    expect(second).toBe(1);
  });

  it("a throwing contact callback still applies the queued removals", async () => {
    expect(typeof api.onContact).toBe("function");
    const engine = await createEngine({ maxEntities: 8 });
    engines.push(engine);
    const entity = engine.createEntity();
    const registry = api.createContactRegistry().get(engine);
    const order: string[] = [];
    let dropSecond: () => void = () => undefined;
    await engine.run(() => {
      api.onContact(() => {
        order.push("first");
        dropSecond();
      });
      dropSecond = api.onContact(() => {
        order.push("second");
        throw new Error("contact boom");
      });
    });
    let thrown: unknown;
    try {
      registry.emit(contactPair(entity));
    } catch (error) {
      thrown = error;
    }
    expect(order).toEqual(["first", "second"]);
    expect(thrown).toBeInstanceOf(Error);
    expect(registry.entries.length).toBe(1);
    registry.emit(contactPair(entity));
    expect(order).toEqual(["first", "second", "first"]);
  });

  it("removal outside an emit is immediate", async () => {
    expect(typeof api.onContact).toBe("function");
    const engine = await createEngine({ maxEntities: 8 });
    engines.push(engine);
    const registry = api.createContactRegistry().get(engine);
    expect(typeof registry.removeEntity).toBe("function");
    if (typeof registry.removeEntity !== "function") return;
    let calls = 0;
    let drop: () => void = () => undefined;
    await engine.run(() => {
      drop = api.onContact(() => {
        calls += 1;
      });
    });
    expect(registry.entries.length).toBe(1);
    drop();
    expect(registry.entries.length).toBe(0);
    registry.emit(contactPair(1n));
    expect(calls).toBe(0);
    const entity = 4n;
    await engine.run(() => {
      api.onContact(() => undefined, entity);
    });
    expect(registry.entries.length).toBe(1);
    registry.removeEntity(entity);
    expect(registry.entries.length).toBe(0);
    registry.removeEntity(entity);
    expect(registry.entries.length).toBe(0);
  });

  it("removal on one engine never touches another engine", async () => {
    expect(typeof api.onContact).toBe("function");
    const engineA = await createEngine({ maxEntities: 8 });
    const engineB = await createEngine({ maxEntities: 8 });
    engines.push(engineA, engineB);
    const shared = 5n;
    let aCount = 0;
    let bCount = 0;
    await engineA.run(() => {
      api.onContact(() => {
        aCount += 1;
      }, shared);
    });
    await engineB.run(() => {
      api.onContact(() => {
        bCount += 1;
      }, shared);
    });
    const registryA = api.createContactRegistry().get(engineA);
    const registryB = api.createContactRegistry().get(engineB);
    expect(typeof registryA.removeEntity).toBe("function");
    if (typeof registryA.removeEntity !== "function") return;
    registryA.removeEntity(shared);
    registryA.emit(contactPair(shared));
    registryB.emit(contactPair(shared));
    expect(aCount).toBe(0);
    expect(bCount).toBe(1);
    expect(registryB.entries.length).toBe(1);
  });

  it("a removal queued during a nested contact emit waits for the outermost emit", async () => {
    expect(typeof api.createContactRegistry).toBe("function");
    const engine = await createEngine({ maxEntities: 8 });
    engines.push(engine);
    const registry = api.createContactRegistry().get(engine);
    expect(typeof registry.removeEntity).toBe("function");
    if (typeof registry.removeEntity !== "function") return;
    const watched = engine.createEntity();
    let nested = false;
    let nextCalls = 0;
    await engine.run(() => {
      api.onContact(() => {
        if (!nested) {
          nested = true;
          registry.emit(contactPair(watched));
          return;
        }
        registry.removeEntity(watched);
      });
      api.onContact(() => {
        nextCalls += 1;
      }, watched);
    });
    registry.emit(contactPair(watched));
    expect(nextCalls).toBe(2);
    registry.emit(contactPair(watched));
    expect(nextCalls).toBe(2);
  });

  it("a removal queued during a nested sensor emit waits for the outermost emit", async () => {
    expect(typeof api.createSensorRegistry).toBe("function");
    const engine = await createEngine({ maxEntities: 8 });
    engines.push(engine);
    const registry = api.createSensorRegistry().get(engine);
    expect(typeof registry.remove).toBe("function");
    if (typeof registry.remove !== "function") return;
    const entity = engine.createEntity();
    let nested = false;
    let nextCalls = 0;
    const tracked = (entityId: bigint): void => {
      if (entityId === entity) nextCalls += 1;
    };
    await engine.run(() => {
      api.onSensorEnter(4, () => {
        if (!nested) {
          nested = true;
          registry.emit(4, entity, "enter");
          return;
        }
        registry.remove([tracked]);
      });
      api.onSensorEnter(4, tracked);
    });
    registry.emit(4, entity, "enter");
    expect(nextCalls).toBe(2);
    registry.emit(4, entity, "enter");
    expect(nextCalls).toBe(2);
  });

  it("a sensor callback that unsubscribes itself during emit does not skip the next callback", async () => {
    expect(typeof api.onSensorEnter).toBe("function");
    const engine = await createEngine({ maxEntities: 8 });
    engines.push(engine);
    const entity = engine.createEntity();
    const registry = api.createSensorRegistry().get(engine);
    registry.emit(4, entity, "enter");
    expect(registry.entries.length).toBe(0);
    const order: string[] = [];
    let dropFirst: () => void = () => undefined;
    await engine.run(() => {
      dropFirst = api.onSensorEnter(4, () => {
        order.push("a");
        dropFirst();
      });
      api.onSensorEnter(4, () => {
        order.push("b");
      });
    });
    registry.emit(4, entity, "enter");
    expect(order).toEqual(["a", "b"]);
    registry.emit(4, entity, "enter");
    expect(order).toEqual(["a", "b", "b"]);
  });

  it("remove() during a sensor emit keeps the entry until the walk ends", async () => {
    expect(typeof api.onSensorEnter).toBe("function");
    const engine = await createEngine({ maxEntities: 8 });
    engines.push(engine);
    const entity = engine.createEntity();
    const registry = api.createSensorRegistry().get(engine);
    expect(typeof registry.remove).toBe("function");
    if (typeof registry.remove !== "function") return;
    registry.emit(4, entity, "enter");
    expect(registry.entries.length).toBe(0);
    const seen: bigint[] = [];
    const tracked = (entityId: bigint): void => {
      seen.push(entityId);
    };
    let lengthDuring = -1;
    await engine.run(() => {
      api.onSensorEnter(4, () => {
        registry.remove([tracked]);
        lengthDuring = registry.entries.length;
      });
      api.onSensorEnter(4, tracked);
    });
    registry.emit(4, entity, "enter");
    expect(lengthDuring).toBe(2);
    expect(seen).toEqual([entity]);
    registry.remove([]);
    expect(registry.entries.length).toBe(1);
    registry.emit(4, entity, "enter");
    expect(seen).toEqual([entity]);
    expect(registry.entries.length).toBe(1);
  });

  it("a throwing sensor callback still applies the queued removals", async () => {
    expect(typeof api.onSensorEnter).toBe("function");
    const engine = await createEngine({ maxEntities: 8 });
    engines.push(engine);
    const entity = engine.createEntity();
    const registry = api.createSensorRegistry().get(engine);
    const order: string[] = [];
    let dropSecond: () => void = () => undefined;
    await engine.run(() => {
      api.onSensorEnter(4, () => {
        order.push("first");
        dropSecond();
      });
      dropSecond = api.onSensorEnter(4, () => {
        order.push("second");
        throw new Error("sensor boom");
      });
    });
    let thrown: unknown;
    try {
      registry.emit(4, entity, "enter");
    } catch (error) {
      thrown = error;
    }
    expect(order).toEqual(["first", "second"]);
    expect(thrown).toBeInstanceOf(Error);
    expect(registry.entries.length).toBe(1);
    registry.emit(4, entity, "enter");
    expect(order).toEqual(["first", "second", "first"]);
  });

  it("a sensor callback registered with an owner only receives that entity", async () => {
    expect(typeof api.onSensorEnter).toBe("function");
    expect(typeof api.onSensorExit).toBe("function");
    const engine = await createEngine({ maxEntities: 8 });
    engines.push(engine);
    const owner = engine.createEntity();
    const other = engine.createEntity();
    const ownedEnter: bigint[] = [];
    const ownedExit: bigint[] = [];
    const unowned: bigint[] = [];
    await engine.run(() => {
      api.onSensorEnter(
        4,
        (entityId) => {
          ownedEnter.push(entityId);
        },
        owner,
      );
      api.onSensorExit(
        4,
        (entityId) => {
          ownedExit.push(entityId);
        },
        owner,
      );
      api.onSensorEnter(4, (entityId) => {
        unowned.push(entityId);
      });
    });
    const registry = api.createSensorRegistry().get(engine);
    registry.emit(4, other, "enter");
    registry.emit(4, owner, "enter");
    expect(ownedEnter).toEqual([owner]);
    expect(unowned).toEqual([other, owner]);
    registry.emit(4, other, "exit");
    registry.emit(4, owner, "exit");
    expect(ownedExit).toEqual([owner]);
    registry.emit(4, other, "enter");
    expect(unowned).toEqual([other, owner, other]);
  });

  it("removeOwned drops the callbacks of one owner and waits for the outermost emit", async () => {
    expect(typeof api.onSensorEnter).toBe("function");
    const engine = await createEngine({ maxEntities: 8 });
    engines.push(engine);
    const owner = engine.createEntity();
    const other = engine.createEntity();
    const registry = api.createSensorRegistry().get(engine);
    const during: string[] = [];
    let otherSensor = 0;
    let unowned = 0;
    let nested = false;
    await engine.run(() => {
      api.onSensorEnter(
        4,
        () => {
          during.push("owned");
          if (!nested) {
            nested = true;
            registry.emit(4, owner, "enter");
            return;
          }
          registry.removeOwned?.(owner, 4);
        },
        owner,
      );
      api.onSensorEnter(
        4,
        () => {
          during.push("next");
        },
        owner,
      );
      api.onSensorEnter(
        9,
        () => {
          otherSensor += 1;
        },
        owner,
      );
      api.onSensorEnter(4, () => {
        unowned += 1;
      });
    });
    registry.emit(4, owner, "enter");
    expect(during).toEqual(["owned", "owned", "next", "next"]);
    registry.removeOwned?.(owner, 4);
    const seen = during.length;
    registry.emit(4, owner, "enter");
    expect(during).toHaveLength(seen);
    registry.emit(9, owner, "enter");
    expect(otherSensor).toBe(1);
    registry.removeOwned?.(owner);
    registry.emit(9, owner, "enter");
    expect(otherSensor).toBe(1);
    registry.emit(4, other, "enter");
    expect(unowned).toBe(4);
  });
});
