/**
 * `fixedRotation: true` keeps a dynamic body's angle at 0 under an off-centre hit.
 * The hit is a real body, so the contact impulse is not applied at the centre of mass.
 */
import { describe, expect, it } from "vitest";

import { defineActor, definePrefab, useEntityId } from "../../src/actor/index.js";
import { defineComponent, Types, type EntityId } from "../../src/index.js";
import { createRealEngine, type RealEngineHandle } from "./harness.js";
import "../../../physics2d/src/augment";
import { Physics2DPlugin } from "../../../physics2d/src/plugin/index";
import { useDynamicBody } from "../../../physics2d/src/composables/use-dynamic-body";
import type { Physics2DAPI } from "../../../physics2d/src/types";

declare module "@gwenjs/schema" {
  interface GwenProvides {
    physics2d: Physics2DAPI;
  }
}

const Marker = defineComponent({
  name: "FixedRotationMarker",
  schema: { v: Types.u32 },
});

const Prefab = definePrefab([{ def: Marker, defaults: { v: 1 } }]);

interface SpinHandle {
  id: EntityId;
  disable(): void;
  enable(): void;
}

function actor(fixedRotation: boolean) {
  return defineActor(Prefab, (): SpinHandle => {
    const id = useEntityId();
    const body = useDynamicBody({ fixedRotation, gravityScale: 0 });
    return {
      id,
      disable: () => {
        body.disable();
      },
      enable: () => {
        body.enable();
      },
    };
  });
}

function rotation(physics: Physics2DAPI, id: EntityId): number {
  const position = physics.getPosition(id);
  if (position === null) throw new Error("expected a physics body");
  return position.rotation;
}

/** Heavy box whose first contact is above the target centre of mass. */
function strike(engine: RealEngineHandle["engine"], physics: Physics2DAPI, id: EntityId): EntityId {
  const position = physics.getPosition(id);
  if (position === null) throw new Error("expected a physics body");
  const bullet = engine.createEntity();
  const handle = physics.addRigidBody(bullet, "dynamic", position.x + 0.95, position.y + 0.35, {
    gravityScale: 0,
    mass: 8,
    initialVelocity: { vx: -10, vy: 0 },
  });
  physics.addBoxCollider(handle, 0.2, 0.2, { friction: 0.9, restitution: 0 });
  return bullet;
}

async function openPhysics(handle: RealEngineHandle): Promise<Physics2DAPI> {
  await handle.engine.use(Physics2DPlugin({ gravity: 0, maxEntities: 32 }));
  return handle.engine.inject("physics2d");
}

describe("dynamic fixedRotation", () => {
  it("keeps a locked angle at 0 and lets an unlocked body turn after an off-centre hit", async () => {
    const handle = await createRealEngine({ variant: "physics2d", maxEntities: 32, physicsHz: 60 });
    try {
      const physics = await openPhysics(handle);
      const { engine, advance } = handle;
      const lockedActor = actor(true);
      await engine.use(lockedActor._plugin);
      const lockedId = lockedActor._plugin.spawn();
      const freeId = engine.createEntity();
      const freeHandle = physics.addRigidBody(freeId, "dynamic", 20, 0, {
        gravityScale: 0,
        mass: 1,
      });
      physics.addBoxCollider(freeHandle, 0.5, 0.5);
      const lockedBullet = strike(engine, physics, lockedId);
      const freeBullet = strike(engine, physics, freeId);
      await advance(45, 1 / 60);
      expect(Math.abs(rotation(physics, freeId))).toBeGreaterThan(0.05);
      expect(Math.abs(rotation(physics, lockedId))).toBeLessThan(1e-3);
      physics.removeBody(lockedBullet);
      physics.removeBody(freeBullet);
    } finally {
      await handle.dispose();
    }
  });

  it("does not warn when fixedRotation is true", async () => {
    const handle = await createRealEngine({ variant: "physics2d", maxEntities: 32, physicsHz: 60 });
    const previous = console.warn;
    const messages: string[] = [];
    console.warn = (...args: unknown[]) => {
      messages.push(args.map((arg) => String(arg)).join(" "));
    };
    try {
      await openPhysics(handle);
      const lockedActor = actor(true);
      await handle.engine.use(lockedActor._plugin);
      lockedActor._plugin.spawn();
      expect(messages.join("\n")).not.toContain("fixedRotation");
    } finally {
      console.warn = previous;
      await handle.dispose();
    }
  });

  it("keeps the lock when the body is disabled and enabled again", async () => {
    const handle = await createRealEngine({ variant: "physics2d", maxEntities: 32, physicsHz: 60 });
    try {
      const physics = await openPhysics(handle);
      const { engine, advance } = handle;
      const lockedActor = actor(true);
      await engine.use(lockedActor._plugin);
      const id = lockedActor._plugin.spawn();
      const body = lockedActor._instances.get(id)?.api;
      if (body === undefined) throw new Error("expected the actor instance");
      const first = strike(engine, physics, id);
      await advance(45, 1 / 60);
      expect(Math.abs(rotation(physics, id))).toBeLessThan(1e-3);
      physics.removeBody(first);
      body.disable();
      body.enable();
      const second = strike(engine, physics, id);
      await advance(45, 1 / 60);
      expect(Math.abs(rotation(physics, id))).toBeLessThan(1e-3);
      physics.removeBody(second);
    } finally {
      await handle.dispose();
    }
  });

  it("rotates again after removeBody and addRigidBody without fixedRotation", async () => {
    const handle = await createRealEngine({ variant: "physics2d", maxEntities: 32, physicsHz: 60 });
    try {
      const physics = await openPhysics(handle);
      const { engine, advance } = handle;
      const lockedActor = actor(true);
      await engine.use(lockedActor._plugin);
      const id = lockedActor._plugin.spawn();
      const body = lockedActor._instances.get(id)?.api;
      if (body === undefined) throw new Error("expected the actor instance");
      const first = strike(engine, physics, id);
      await advance(45, 1 / 60);
      expect(Math.abs(rotation(physics, id))).toBeLessThan(1e-3);
      physics.removeBody(first);
      body.disable();
      const again = physics.addRigidBody(id, "dynamic", 0, 0, { gravityScale: 0, mass: 1 });
      physics.addBoxCollider(again, 0.5, 0.5);
      const second = strike(engine, physics, id);
      await advance(45, 1 / 60);
      expect(Math.abs(rotation(physics, id))).toBeGreaterThan(0.05);
      physics.removeBody(second);
    } finally {
      await handle.dispose();
    }
  });
});
