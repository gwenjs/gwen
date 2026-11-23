/**
 * @file onContact() / _dispatchContactEvent() tests.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GwenContextError, type GwenEngine } from "@gwenjs/core";
import { createEngine } from "@gwenjs/core/node";
import { onContact as coreOnContact } from "@gwenjs/physics-core";
import {
  _dispatchContactEvent,
  onContact,
  _clearContactCallbacks,
  clearEngineContacts,
} from "../../src/composables/on-contact.js";
import type { CollisionContact } from "../../src/types.js";

/** Sample contact event for testing. */
const sampleEvent: CollisionContact = {
  entityA: 1n,
  entityB: 2n,
  started: true,
};

describe("onContact / _dispatchContactEvent", () => {
  let engine: GwenEngine;

  beforeEach(async () => {
    engine = await createEngine();
    engine.activate();
  });

  afterEach(async () => {
    engine.deactivate();
    await engine.stop();
  });

  it("dispatches to a callback registered with an explicit entity ID", () => {
    let received: CollisionContact | null = null;
    onContact((e) => {
      received = e;
    }, 1n);
    _dispatchContactEvent(sampleEvent);
    expect(received).toEqual(sampleEvent);
  });

  it("does not dispatch to a callback registered for a different entity", () => {
    let received: CollisionContact | null = null;
    onContact((e) => {
      received = e;
    }, 99n);
    _dispatchContactEvent(sampleEvent);
    expect(received).toBeNull();
  });

  it("dispatches to multiple callbacks for the same entity", () => {
    const results: number[] = [];
    const event: CollisionContact = { entityA: 5n, entityB: 6n, started: true };
    onContact(() => results.push(1), 5n);
    onContact(() => results.push(2), 5n);
    _dispatchContactEvent(event);
    expect(results).toEqual([1, 2]);
  });

  it("does not throw when dispatching to an entity with no callbacks", () => {
    expect(() => _dispatchContactEvent(sampleEvent)).not.toThrow();
  });

  it("throws CORE:OUTSIDE_ACTOR_CONTEXT when entityId is missing and no actor is current", () => {
    let caught: unknown;
    try {
      onContact(() => {});
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(GwenContextError);
    if (!(caught instanceof GwenContextError)) return;
    expect(caught.code).toBe("CORE:OUTSIDE_ACTOR_CONTEXT");
    expect(caught.composable).toBe("onContact");
  });

  it("onContact returns an unsubscribe that removes the callback", () => {
    let calls = 0;
    const off = onContact(() => {
      calls += 1;
    }, 1n);
    expect(typeof off).toBe("function");
    _dispatchContactEvent(sampleEvent);
    expect(calls).toBe(1);
    off();
    _dispatchContactEvent(sampleEvent);
    expect(calls).toBe(1);
  });

  it("a callback registered with physics-core's onContact receives the 2D plugin's contacts", () => {
    let received: CollisionContact | null = null;
    coreOnContact((event) => {
      received = event;
    }, 1n);
    _dispatchContactEvent(sampleEvent);
    expect(received).toEqual(sampleEvent);
  });

  it("a contact callback that clears its entity does not skip the next physics-core contact callback", () => {
    const seen: string[] = [];
    onContact(() => {
      seen.push("A");
      _clearContactCallbacks(1n);
    }, 1n);
    coreOnContact(() => {
      seen.push("B");
    }, 2n);
    _dispatchContactEvent({ entityA: 1n, entityB: 2n, started: true });
    expect(seen).toEqual(["A", "B"]);
  });

  it("_clearContactCallbacks removes callbacks for entity", () => {
    let called = false;
    const event: CollisionContact = { entityA: 5n, entityB: 6n, started: true };
    onContact(() => {
      called = true;
    }, 5n);
    _clearContactCallbacks(5n);
    _dispatchContactEvent(event);
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
      _dispatchContactEvent(sampleEvent);
      expect(hits).toBe(0);
      b.deactivate();
      a.activate();
      _dispatchContactEvent(sampleEvent);
      expect(hits).toBe(1);
      a.deactivate();
    } finally {
      await a.stop();
      await b.stop();
    }
  });
});
