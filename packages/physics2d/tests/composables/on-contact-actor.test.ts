/**
 * onContact() inside a real defineActor factory, with no entityId argument.
 */
import { describe, it, expect } from "vitest";
import { createEngine, defineComponent, Types } from "@gwenjs/core";
import { defineActor, definePrefab } from "@gwenjs/core/actor";
import { onContact, _dispatchContactEvent } from "../../src/composables/on-contact.js";
import type { ContactEvent } from "../../src/types.js";

const Position = defineComponent({
  name: "OnContactActorPos",
  schema: { x: Types.f32 },
});
const Prefab = definePrefab([{ def: Position, defaults: { x: 0 } }]);

describe("onContact inside defineActor", () => {
  it("delivers the contact to the spawned actor", async () => {
    const engine = await createEngine();
    let received: bigint | null = null;
    const Actor = defineActor(Prefab, () => {
      try {
        onContact((event) => {
          received = event.entityA;
        });
      } catch {
        received = null;
      }
    });
    try {
      await engine.use(Actor._plugin);
      const id = engine.run(() => Actor._plugin.spawn());
      const event: ContactEvent = {
        entityA: id,
        entityB: id + 1n,
        contactX: 3,
        contactY: 4,
        normalX: 1,
        normalY: 0,
        relativeVelocity: 2,
      };
      engine.run(() => {
        _dispatchContactEvent(id, event);
      });
      expect(received).toBe(id);
    } finally {
      await engine.stop();
    }
  });
});
