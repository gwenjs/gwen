import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createEngine,
  defineComponent,
  GwenContextError,
  Types,
  type GwenEngine,
} from "@gwenjs/core";
import { defineActor, definePrefab } from "@gwenjs/core/actor";
import { createRealEngine } from "../../../core/src/testing/create-real-engine.ts";
import { Physics3DPlugin } from "../../src/plugin/index";
import "../../src/augment";
import {
  onSensorEnter,
  onSensorExit,
  _dispatchSensorEnter,
  _dispatchSensorExit,
  _clearSensorCallbacks,
  clearEngineSensors,
} from "../../src/composables/on-sensor.js";

describe("onSensorEnter / onSensorExit", () => {
  let engine: GwenEngine;

  beforeEach(async () => {
    engine = await createEngine();
    engine.activate();
    clearEngineSensors(engine);
  });

  afterEach(async () => {
    engine.deactivate();
    await engine.stop();
  });

  it("onSensorEnter callback triggered by _dispatchSensorEnter with matching sensorId", () => {
    const received: bigint[] = [];
    onSensorEnter(10, (id) => received.push(id));
    _dispatchSensorEnter(10, 42n);
    expect(received).toEqual([42n]);
  });

  it("onSensorExit callback triggered by _dispatchSensorExit with matching sensorId", () => {
    const received: bigint[] = [];
    onSensorExit(20, (id) => received.push(id));
    _dispatchSensorExit(20, 99n);
    expect(received).toEqual([99n]);
  });

  it("enter callbacks only triggered for matching sensorId", () => {
    let triggeredA = false;
    let triggeredB = false;
    onSensorEnter(1, () => {
      triggeredA = true;
    });
    onSensorEnter(2, () => {
      triggeredB = true;
    });
    _dispatchSensorEnter(1, 0n);
    expect(triggeredA).toBe(true);
    expect(triggeredB).toBe(false);
  });

  it("exit callbacks only triggered for matching sensorId", () => {
    let triggeredA = false;
    let triggeredB = false;
    onSensorExit(100, () => {
      triggeredA = true;
    });
    onSensorExit(200, () => {
      triggeredB = true;
    });
    _dispatchSensorExit(200, 0n);
    expect(triggeredA).toBe(false);
    expect(triggeredB).toBe(true);
  });

  it("multiple enter callbacks for the same sensor are all invoked", () => {
    let count = 0;
    onSensorEnter(5, () => count++);
    onSensorEnter(5, () => count++);
    _dispatchSensorEnter(5, 0n);
    expect(count).toBe(2);
  });

  it("multiple exit callbacks for the same sensor are all invoked", () => {
    let count = 0;
    onSensorExit(7, () => count++);
    onSensorExit(7, () => count++);
    _dispatchSensorExit(7, 0n);
    expect(count).toBe(2);
  });

  it("dispatch on unregistered sensorId does not throw", () => {
    expect(() => _dispatchSensorEnter(999, 0n)).not.toThrow();
    expect(() => _dispatchSensorExit(999, 0n)).not.toThrow();
  });

  it("callbacks removed after _clearSensorCallbacks()", () => {
    let invoked = false;
    onSensorEnter(1, () => {
      invoked = true;
    });
    _clearSensorCallbacks(1);
    _dispatchSensorEnter(1, 0n);
    expect(invoked).toBe(false);
  });

  it("entityId is passed as bigint to enter callback", () => {
    let received: bigint | undefined;
    onSensorEnter(3, (id) => {
      received = id;
    });
    _dispatchSensorEnter(3, 1234n);
    expect(received).toBe(1234n);
    expect(typeof received).toBe("bigint");
  });

  it("onSensorEnter returns an unregister function that removes the callback", () => {
    let count = 0;
    const unregister = onSensorEnter(10, () => count++);
    _dispatchSensorEnter(10, 1n);
    expect(count).toBe(1);
    unregister();
    _dispatchSensorEnter(10, 1n);
    expect(count).toBe(1); // no additional invocation
  });

  it("onSensorExit returns an unregister function that removes the callback", () => {
    let count = 0;
    const unregister = onSensorExit(20, () => count++);
    _dispatchSensorExit(20, 1n);
    expect(count).toBe(1);
    unregister();
    _dispatchSensorExit(20, 1n);
    expect(count).toBe(1); // no additional invocation
  });

  it("calling enter unregister twice does not throw", () => {
    const unregister = onSensorEnter(99, () => {});
    unregister();
    expect(() => unregister()).not.toThrow();
  });

  it("calling exit unregister twice does not throw", () => {
    const unregister = onSensorExit(99, () => {});
    unregister();
    expect(() => unregister()).not.toThrow();
  });
});

describe("onSensor engine isolation", () => {
  it("throws OUTSIDE_ENGINE when no engine is current", () => {
    expect(() => onSensorEnter(1, () => {})).toThrow(GwenContextError);
  });

  it("clears sensors on one engine only", async () => {
    const a = await createEngine();
    const b = await createEngine();
    try {
      let hits = 0;
      a.activate();
      onSensorEnter(4, () => {
        hits += 1;
      });
      a.deactivate();
      b.activate();
      onSensorEnter(4, () => {
        hits += 100;
      });
      clearEngineSensors(b);
      _dispatchSensorEnter(4, 1n);
      expect(hits).toBe(0);
      b.deactivate();
      a.activate();
      _dispatchSensorEnter(4, 1n);
      expect(hits).toBe(1);
      a.deactivate();
    } finally {
      await a.stop();
      await b.stop();
    }
  });

  it("drops destroyed entity sensors on A and keeps the same id on B", async () => {
    const handleA = await createRealEngine({ variant: "physics3d", maxEntities: 32 });
    const handleB = await createRealEngine({ variant: "physics3d", maxEntities: 32 });
    const a = handleA.engine;
    const b = handleB.engine;
    try {
      await a.use(Physics3DPlugin());
      await b.use(Physics3DPlugin());
      let hitsA = 0;
      let hitsB = 0;
      const Tag = defineComponent({ name: "P3SensorOwner", schema: { x: Types.f32 } });
      const Prefab = definePrefab([{ def: Tag, defaults: { x: 0 } }]);
      const Actor = defineActor(Prefab, () => {
        onSensorEnter(7, () => {
          hitsA += 1;
        });
        onSensorExit(7, () => {
          hitsA += 1;
        });
      });
      await a.use(Actor._plugin);
      const id = a.run(() => Actor._plugin.spawn());
      a.run(() => {
        const physics = a.inject("physics3d");
        physics.createBody(id, {
          kind: "static",
          colliders: [
            {
              shape: { type: "box", halfX: 0.5, halfY: 0.5, halfZ: 0.5 },
              isSensor: true,
              colliderId: 7,
            },
          ],
        });
      });
      b.run(() => {
        onSensorEnter(7, () => {
          hitsB += 1;
        });
        onSensorExit(7, () => {
          hitsB += 1;
        });
      });
      a.destroyEntity(id);
      a.run(() => {
        _dispatchSensorEnter(7, 1n);
        _dispatchSensorExit(7, 1n);
      });
      b.run(() => {
        _dispatchSensorEnter(7, 1n);
        _dispatchSensorExit(7, 1n);
      });
      expect(hitsA).toBe(0);
      expect(hitsB).toBe(2);
    } finally {
      await handleA.dispose();
      await handleB.dispose();
    }
  });
});
