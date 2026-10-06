/**
 * @file onContact() / _dispatchContactEvent() tests.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createEngine, GwenContextError, type GwenEngine } from "@gwenjs/core";
import {
  _dispatchContactEvent,
  onContact,
  _setCurrentContactEntityId,
  _clearContactCallbacks,
  clearEngineContacts,
} from "../../src/composables/on-contact.js";
import type { ContactEvent } from "../../src/types.js";

/** Sample contact event for testing. */
const sampleEvent: ContactEvent = {
  entityA: 1n,
  entityB: 2n,
  contactX: 1,
  contactY: 2,
  normalX: 0,
  normalY: 1,
  relativeVelocity: 5,
};

describe("onContact / _dispatchContactEvent", () => {
  let engine: GwenEngine;

  beforeEach(async () => {
    engine = await createEngine();
    engine.activate();
    _setCurrentContactEntityId(null);
  });

  afterEach(async () => {
    engine.deactivate();
    await engine.stop();
  });

  it("dispatches to a callback registered with an explicit entity ID", () => {
    let received: ContactEvent | null = null;
    onContact((e) => {
      received = e;
    }, 1n);
    _dispatchContactEvent(1n, sampleEvent);
    expect(received).toEqual(sampleEvent);
  });

  it("does not dispatch to a callback registered for a different entity", () => {
    let received: ContactEvent | null = null;
    onContact((e) => {
      received = e;
    }, 99n);
    _dispatchContactEvent(1n, sampleEvent);
    expect(received).toBeNull();
  });

  it("dispatches to multiple callbacks for the same entity", () => {
    const results: number[] = [];
    onContact(() => results.push(1), 5n);
    onContact(() => results.push(2), 5n);
    _dispatchContactEvent(5n, sampleEvent);
    expect(results).toEqual([1, 2]);
  });

  it("does not throw when dispatching to an entity with no callbacks", () => {
    expect(() => _dispatchContactEvent(999n, sampleEvent)).not.toThrow();
  });

  it("throws ACTOR_SETUP_ONLY when entityId is missing and no actor is current", () => {
    _setCurrentContactEntityId(null);
    expect(() => onContact(() => {})).toThrow(GwenContextError);
  });

  it("registers callback using context entity ID set via _setCurrentContactEntityId", () => {
    _setCurrentContactEntityId(77n);
    let received: ContactEvent | null = null;
    onContact((e) => {
      received = e;
    }); // uses context ID
    _dispatchContactEvent(77n, sampleEvent);
    expect(received).toEqual(sampleEvent);
  });

  it("explicit entityId takes precedence over context entity ID", () => {
    _setCurrentContactEntityId(10n);
    let received: ContactEvent | null = null;
    onContact((e) => {
      received = e;
    }, 20n); // explicit ID = 20
    _dispatchContactEvent(20n, sampleEvent);
    expect(received).toEqual(sampleEvent);
    // Should not receive for entity 10
    let receivedFromContext: ContactEvent | null = null;
    onContact((e) => {
      receivedFromContext = e;
    }); // registers for 10
    _dispatchContactEvent(10n, sampleEvent);
    expect(receivedFromContext).toEqual(sampleEvent);
  });

  it("_clearContactCallbacks removes callbacks for entity", () => {
    let called = false;
    onContact(() => {
      called = true;
    }, 5n);
    _clearContactCallbacks(5n);
    _dispatchContactEvent(5n, sampleEvent);
    expect(called).toBe(false);
  });
});

describe("onContact engine isolation", () => {
  it("throws OUTSIDE_ENGINE when no engine is current", () => {
    expect(() => onContact(() => {}, 1n)).toThrow(GwenContextError);
  });

  it("keeps engine A callbacks when engine B is cleared", async () => {
    const a = await createEngine();
    const b = await createEngine();
    try {
      let hits = 0;
      a.activate();
      onContact(() => {
        hits += 1;
      }, 1n);
      a.deactivate();
      b.activate();
      onContact(() => {
        hits += 100;
      }, 1n);
      clearEngineContacts(b);
      _dispatchContactEvent(1n, sampleEvent);
      expect(hits).toBe(0);
      b.deactivate();
      a.activate();
      _dispatchContactEvent(1n, sampleEvent);
      expect(hits).toBe(1);
      a.deactivate();
    } finally {
      await a.stop();
      await b.stop();
    }
  });
});
