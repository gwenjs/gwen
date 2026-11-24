import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createEngine } from "@gwenjs/core/node";
import { GwenContextError, type GwenEngine } from "@gwenjs/core";
import { createContactRegistry } from "@gwenjs/physics-core";
import {
  onContact,
  _dispatchContactEvent,
  _clearContactCallbacks,
  clearEngineContacts,
} from "../../src/composables/on-contact.js";
import type { CollisionContact } from "../../src/types.js";
import type { EntityId } from "@gwenjs/core";

const sampleContact: CollisionContact = {
  entityA: 1n as unknown as EntityId,
  entityB: 2n as unknown as EntityId,
  aColliderId: 10,
  bColliderId: 20,
  started: true,
};

describe("onContact / _dispatchContactEvent", () => {
  let engine: GwenEngine;

  beforeEach(async () => {
    engine = await createEngine();
    engine.activate();
    _clearContactCallbacks();
  });

  afterEach(async () => {
    engine.deactivate();
    await engine.stop();
  });

  it("registered callback is invoked on dispatch", () => {
    const received: CollisionContact[] = [];
    onContact((e) => received.push(e));
    _dispatchContactEvent(sampleContact);
    expect(received).toHaveLength(1);
    expect(received[0]).toBe(sampleContact);
  });

  it("multiple callbacks are all invoked", () => {
    let count = 0;
    onContact(() => count++);
    onContact(() => count++);
    onContact(() => count++);
    _dispatchContactEvent(sampleContact);
    expect(count).toBe(3);
  });

  it("callback receives contact with started: true", () => {
    let receivedStarted: boolean | undefined;
    onContact((e) => {
      receivedStarted = e.started;
    });
    _dispatchContactEvent(sampleContact);
    expect(receivedStarted).toBe(true);
  });

  it("callback receives contact with correct collider IDs", () => {
    let receivedAColliderId: number | undefined;
    onContact((e) => {
      receivedAColliderId = e.aColliderId;
    });
    _dispatchContactEvent(sampleContact);
    expect(receivedAColliderId).toBe(10);
  });

  it("no callbacks invoked after _clearContactCallbacks()", () => {
    let invoked = false;
    onContact(() => {
      invoked = true;
    });
    _clearContactCallbacks();
    _dispatchContactEvent(sampleContact);
    expect(invoked).toBe(false);
  });

  it("dispatch with no callbacks does not throw", () => {
    expect(() => _dispatchContactEvent(sampleContact)).not.toThrow();
  });

  it("callback receives ended contact (started: false)", () => {
    let receivedStarted: boolean | undefined;
    onContact((e) => {
      receivedStarted = e.started;
    });
    _dispatchContactEvent({ ...sampleContact, started: false });
    expect(receivedStarted).toBe(false);
  });

  it("returned unregister function removes the callback", () => {
    let count = 0;
    const unregister = onContact(() => count++);
    _dispatchContactEvent(sampleContact);
    expect(count).toBe(1);
    unregister();
    _dispatchContactEvent(sampleContact);
    expect(count).toBe(1); // no additional invocation
  });

  it("calling unregister twice does not throw", () => {
    const unregister = onContact(() => {});
    unregister();
    expect(() => unregister()).not.toThrow();
  });

  it("onContact receives a contact emitted through the physics-core registry", () => {
    const entityA = engine.createEntity();
    const entityB = engine.createEntity();
    const contact: CollisionContact = {
      entityA,
      entityB,
      aColliderId: 10,
      bColliderId: 20,
      started: true,
    };
    const received: CollisionContact[] = [];
    onContact((event) => {
      received.push(event);
    });
    createContactRegistry().get(engine).emit(contact);
    expect(received).toHaveLength(1);
    expect(received[0]).toBe(contact);
  });

  it("a callback that unsubscribes itself during dispatch does not skip the next callback", () => {
    const order: string[] = [];
    let dropA: () => void = () => undefined;
    dropA = onContact(() => {
      order.push("A");
      dropA();
    });
    onContact(() => {
      order.push("B");
    });
    _dispatchContactEvent(sampleContact);
    expect(order).toEqual(["A", "B"]);
    _dispatchContactEvent(sampleContact);
    expect(order).toEqual(["A", "B", "B"]);
  });

  it("a callback removed by an earlier callback still receives the current contact", () => {
    const seen: string[] = [];
    let dropB: () => void = () => undefined;
    onContact(() => {
      seen.push("A");
      dropB();
    });
    dropB = onContact(() => {
      seen.push("B");
    });
    _dispatchContactEvent(sampleContact);
    expect(seen).toEqual(["A", "B"]);
    _dispatchContactEvent(sampleContact);
    expect(seen).toEqual(["A", "B", "A"]);
  });
});

describe("onContact engine isolation", () => {
  it("throws OUTSIDE_ENGINE when no engine is current", () => {
    expect(() => onContact(() => {})).toThrow(GwenContextError);
  });

  it("clears callbacks on one engine only", async () => {
    const a = await createEngine();
    const b = await createEngine();
    try {
      let hits = 0;
      a.activate();
      onContact(() => {
        hits += 1;
      });
      a.deactivate();
      b.activate();
      onContact(() => {
        hits += 100;
      });
      clearEngineContacts(b);
      _dispatchContactEvent(sampleContact);
      expect(hits).toBe(0);
      b.deactivate();
      a.activate();
      _dispatchContactEvent(sampleContact);
      expect(hits).toBe(1);
      a.deactivate();
    } finally {
      await a.stop();
      await b.stop();
    }
  });
});
