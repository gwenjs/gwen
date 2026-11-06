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
});
