/**
 * @file onSensorEnter() / onSensorExit() composable tests.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createEngine, GwenContextError, type GwenEngine } from "@gwenjs/core";
import {
  _dispatchSensorEnter,
  _dispatchSensorExit,
  onSensorEnter,
  onSensorExit,
  _clearSensorCallbacks,
  clearEngineSensors,
} from "../../src/composables/on-sensor.js";

describe("onSensorEnter / _dispatchSensorEnter", () => {
  let engine: GwenEngine;

  beforeEach(async () => {
    engine = await createEngine();
    engine.activate();
  });

  afterEach(async () => {
    engine.deactivate();
    await engine.stop();
  });
  it("fires the callback when the correct sensor ID is dispatched", () => {
    let received: bigint | null = null;
    onSensorEnter(5, (id) => {
      received = id;
    });
    _dispatchSensorEnter(5, 42n);
    expect(received).toBe(42n);
  });

  it("does not fire for a different sensor ID", () => {
    let received: bigint | null = null;
    onSensorEnter(5, (id) => {
      received = id;
    });
    _dispatchSensorEnter(9, 42n);
    expect(received).toBeNull();
  });

  it("supports multiple callbacks for the same sensor ID", () => {
    const results: bigint[] = [];
    onSensorEnter(3, (id) => results.push(id));
    onSensorEnter(3, (id) => results.push(id * 2n));
    _dispatchSensorEnter(3, 10n);
    expect(results).toEqual([10n, 20n]);
  });

  it("does not throw when dispatching to a sensor with no callbacks", () => {
    expect(() => _dispatchSensorEnter(999, 1n)).not.toThrow();
  });
});

describe("onSensorExit / _dispatchSensorExit", () => {
  let engine: GwenEngine;

  beforeEach(async () => {
    engine = await createEngine();
    engine.activate();
  });

  afterEach(async () => {
    engine.deactivate();
    await engine.stop();
  });

  it("fires the exit callback when dispatched", () => {
    let received: bigint | null = null;
    onSensorExit(7, (id) => {
      received = id;
    });
    _dispatchSensorExit(7, 33n);
    expect(received).toBe(33n);
  });

  it("does not fire for a different sensor ID", () => {
    let received: bigint | null = null;
    onSensorExit(7, (id) => {
      received = id;
    });
    _dispatchSensorExit(8, 33n);
    expect(received).toBeNull();
  });

  it("does not throw when dispatching to a sensor with no exit callbacks", () => {
    expect(() => _dispatchSensorExit(888, 1n)).not.toThrow();
  });
});

describe("onSensorEnter and onSensorExit independence", () => {
  let engine: GwenEngine;

  beforeEach(async () => {
    engine = await createEngine();
    engine.activate();
  });

  afterEach(async () => {
    engine.deactivate();
    await engine.stop();
  });

  it("enter dispatch does not trigger exit callbacks", () => {
    let exitFired = false;
    onSensorExit(1, () => {
      exitFired = true;
    });
    _dispatchSensorEnter(1, 1n);
    expect(exitFired).toBe(false);
  });

  it("exit dispatch does not trigger enter callbacks", () => {
    let enterFired = false;
    onSensorEnter(2, () => {
      enterFired = true;
    });
    _dispatchSensorExit(2, 1n);
    expect(enterFired).toBe(false);
  });

  it("returns an unsubscribe that removes only that enter callback", () => {
    const hits: string[] = [];
    const off = onSensorEnter(11, () => hits.push("first"));
    onSensorEnter(11, () => hits.push("second"));
    expect(typeof off).toBe("function");
    off();
    off();
    _dispatchSensorEnter(11, 1n);
    expect(hits).toEqual(["second"]);
  });

  it("returns an unsubscribe that removes only that exit callback", () => {
    const hits: string[] = [];
    const off = onSensorExit(12, () => hits.push("first"));
    onSensorExit(12, () => hits.push("second"));
    expect(typeof off).toBe("function");
    off();
    _dispatchSensorExit(12, 1n);
    expect(hits).toEqual(["second"]);
  });

  it("_clearSensorCallbacks removes enter/exit callbacks", () => {
    let enterCalled = false;
    onSensorEnter(10, () => {
      enterCalled = true;
    });
    _clearSensorCallbacks(10);
    _dispatchSensorEnter(10, 1n);
    expect(enterCalled).toBe(false);
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
});
