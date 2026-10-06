import { describe, expect, it } from "vitest";

import type { EntityId } from "../../src/index.js";
import { createRealEngine, type RealEngineHandle } from "./harness.js";
import "../../../physics3d/src/augment";
import { Physics3DPlugin } from "../../../physics3d/src/plugin/index";
import { onContact as onContact3d } from "../../../physics3d/src/composables/on-contact.js";
import type { Physics3DAPI, Physics3DColliderOptions } from "../../../physics3d/src/types";
import type { Physics2DAPI } from "../../../physics2d/src/types";
import "../../../physics2d/src/augment";
import { Physics2DPlugin } from "../../../physics2d/src/plugin/index";
import { onContact as onContact2d } from "../../../physics2d/src/composables/on-contact.js";
import { useEngine } from "../../src/index.js";

declare module "../../src/engine/gwen-engine.js" {
  interface GwenProvides {
    physics2d: Physics2DAPI;
    physics3d: Physics3DAPI;
  }
}

const OVERLAP_BOX: Physics3DColliderOptions = {
  shape: { type: "box", halfX: 0.5, halfY: 0.5, halfZ: 0.5 },
  colliderId: 0,
};

function assertNoDom(): void {
  expect(typeof window).toBe("undefined");
  expect(typeof document).toBe("undefined");
}

async function instantiate3d(
  engine: RealEngineHandle["engine"],
  entityId: EntityId,
  position: { x: number; y: number; z: number },
): Promise<void> {
  await engine.hooks.callHook("prefab:instantiate", entityId, {
    physics3d: {
      body: {
        kind: "dynamic",
        initialPosition: position,
        colliders: [OVERLAP_BOX],
      },
    },
  });
}

describe("p59 two engines", () => {
  it("isolates physics2d contacts and leaves B alive after A stops", async () => {
    assertNoDom();
    const handleA = await createRealEngine({ variant: "physics2d", maxEntities: 64 });
    const handleB = await createRealEngine({ variant: "physics2d", maxEntities: 64 });
    try {
      const { engine: a, advance: advanceA } = handleA;
      const { engine: b, advance: advanceB } = handleB;
      await a.use(Physics2DPlugin({ gravity: 0 }));
      await b.use(Physics2DPlugin({ gravity: 0 }));
      const physicsA = a.inject("physics2d");
      const physicsB = b.inject("physics2d");

      let contactsA = 0;
      let contactsB = 0;
      let hookEngineA = 0;
      let hookEngineB = 0;
      const leftA = a.createEntity();
      const rightA = a.createEntity();
      a.run(() => {
        onContact2d(() => {
          contactsA += 1;
          if (useEngine() === a) hookEngineA += 1;
        }, leftA);
      });
      a.hooks.hook("physics:collision", () => {
        if (useEngine() === a) hookEngineA += 1;
      });
      const leftB = b.createEntity();
      const rightB = b.createEntity();
      b.run(() => {
        onContact2d(() => {
          contactsB += 1;
          if (useEngine() === b) hookEngineB += 1;
        }, leftB);
      });
      b.hooks.hook("physics:collision", () => {
        if (useEngine() === b) hookEngineB += 1;
      });

      physicsA.addBoxCollider(physicsA.addRigidBody(leftA, "dynamic", 0, 0), 0.5, 0.5);
      physicsA.addBoxCollider(physicsA.addRigidBody(rightA, "dynamic", 0.2, 0), 0.5, 0.5);
      physicsB.addBoxCollider(physicsB.addRigidBody(leftB, "dynamic", 0, 0), 0.5, 0.5);
      physicsB.addBoxCollider(physicsB.addRigidBody(rightB, "dynamic", 50, 0), 0.5, 0.5);

      await Promise.all([advanceA(5, 1 / 60), advanceB(5, 1 / 60)]);

      expect(contactsA).toBeGreaterThan(0);
      expect(hookEngineA).toBeGreaterThan(0);
      expect(contactsB).toBe(0);
      expect(hookEngineB).toBe(0);

      await handleA.dispose();

      const nearB = b.createEntity();
      const nearRight = b.createEntity();
      physicsB.addBoxCollider(physicsB.addRigidBody(nearB, "dynamic", 0, 0), 0.5, 0.5);
      physicsB.addBoxCollider(physicsB.addRigidBody(nearRight, "dynamic", 0.2, 0), 0.5, 0.5);
      b.run(() => {
        onContact2d(() => {
          contactsB += 1;
        }, nearB);
      });
      await advanceB(5, 1 / 60);
      expect(contactsB).toBeGreaterThan(0);
      expect(b.state).not.toBe("faulted");
    } finally {
      await handleA.dispose();
      await handleB.dispose();
    }
  });

  it("isolates physics3d contacts and leaves B alive after A stops", async () => {
    assertNoDom();
    const handleA = await createRealEngine({ variant: "physics3d", maxEntities: 64 });
    const handleB = await createRealEngine({ variant: "physics3d", maxEntities: 64 });
    try {
      const { engine: a, advance: advanceA } = handleA;
      const { engine: b, advance: advanceB } = handleB;
      await a.use(Physics3DPlugin({ gravity: { x: 0, y: 0, z: 0 } }));
      await b.use(Physics3DPlugin({ gravity: { x: 0, y: 0, z: 0 } }));

      let contactsA = 0;
      let contactsB = 0;
      a.run(() => {
        onContact3d(() => {
          contactsA += 1;
          expect(useEngine()).toBe(a);
        });
      });
      b.run(() => {
        onContact3d(() => {
          contactsB += 1;
          expect(useEngine()).toBe(b);
        });
      });
      a.hooks.hook("physics3d:collision", () => {
        expect(useEngine()).toBe(a);
      });
      b.hooks.hook("physics3d:collision", () => {
        contactsB += 1;
        expect(useEngine()).toBe(b);
      });

      const leftA = a.createEntity();
      const rightA = a.createEntity();
      await instantiate3d(a, leftA, { x: 0, y: 0, z: 0 });
      await instantiate3d(a, rightA, { x: 0.2, y: 0, z: 0 });
      const leftB = b.createEntity();
      const rightB = b.createEntity();
      await instantiate3d(b, leftB, { x: 0, y: 0, z: 0 });
      await instantiate3d(b, rightB, { x: 50, y: 0, z: 0 });

      await Promise.all([advanceA(5, 1 / 60), advanceB(5, 1 / 60)]);

      expect(contactsA).toBeGreaterThan(0);
      expect(contactsB).toBe(0);

      await handleA.dispose();

      const nearB = b.createEntity();
      const nearRight = b.createEntity();
      await instantiate3d(b, nearB, { x: 0, y: 0, z: 0 });
      await instantiate3d(b, nearRight, { x: 0.2, y: 0, z: 0 });
      await advanceB(5, 1 / 60);
      expect(contactsB).toBeGreaterThan(0);
      expect(b.state).not.toBe("faulted");
    } finally {
      await handleA.dispose();
      await handleB.dispose();
    }
  });
});
