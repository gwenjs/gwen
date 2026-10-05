import { describe, expect, it } from "vitest";

import { defineActor, defineActorPool, definePrefab } from "../../src/actor/index.js";
import { entityIndex, type EntityId } from "../../src/index.js";
import "../../../physics2d/src/augment";
import { Physics2DStaleEntityError } from "../../../physics2d/src/index";
import { Physics2DPlugin } from "../../../physics2d/src/plugin/index";
import type { Physics2DAPI } from "../../../physics2d/src/types";
import "../../../physics3d/src/augment";
import { Physics3DStaleEntityError } from "../../../physics3d/src/index";
import { Physics3DPlugin } from "../../../physics3d/src/plugin/index";
import type { Physics3DAPI } from "../../../physics3d/src/types";
import { createRealEngine, type RealEngineHandle } from "./harness.js";

const BOX = { type: "box" as const, halfX: 0.5, halfY: 0.5, halfZ: 0.5 };

type Variant = "physics2d" | "physics3d";
type Contact = { entityA: EntityId; entityB: EntityId };

function eventCount(handle: RealEngineHandle, variant: Variant): number {
  const bridge = handle.bridge.getPhysicsBridge() as {
    physics_get_collision_event_count?: () => number;
    physics3d_get_collision_event_count?: () => number;
  };
  if (variant === "physics2d") return bridge.physics_get_collision_event_count?.() ?? 0;
  return bridge.physics3d_get_collision_event_count?.() ?? 0;
}

async function boot(variant: Variant): Promise<RealEngineHandle> {
  const handle = await createRealEngine({ variant, maxEntities: 32 });
  if (variant === "physics2d") {
    await handle.engine.use(Physics2DPlugin({ gravity: 0, gravityX: 0 }));
  } else {
    await handle.engine.use(Physics3DPlugin({ gravity: { x: 0, y: 0, z: 0 } }));
  }
  return handle;
}

function physicsOf(handle: RealEngineHandle, variant: "physics2d"): Physics2DAPI;
function physicsOf(handle: RealEngineHandle, variant: "physics3d"): Physics3DAPI;
function physicsOf(handle: RealEngineHandle, variant: Variant): Physics2DAPI | Physics3DAPI {
  return variant === "physics2d"
    ? handle.engine.inject("physics2d")
    : handle.engine.inject("physics3d");
}

function addBody(
  variant: Variant,
  physics: Physics2DAPI | Physics3DAPI,
  id: EntityId,
  x: number,
  vx: number,
  collider: boolean,
): void {
  if (variant === "physics2d") {
    const api = physics as Physics2DAPI;
    const handle = api.addRigidBody(id, "dynamic", x, 0, {
      gravityScale: 0,
      linearDamping: 0,
      initialVelocity: { vx, vy: 0 },
    });
    if (collider) api.addBoxCollider(handle, 0.5, 0.5, { isSensor: true, colliderId: 0 });
    return;
  }
  const api = physics as Physics3DAPI;
  api.createBody(id, {
    kind: "dynamic",
    gravityScale: 0,
    linearDamping: 0,
    initialPosition: { x, y: 0, z: 0 },
    initialLinearVelocity: { x: vx, y: 0, z: 0 },
    ...(collider ? { colliders: [{ shape: BOX, isSensor: true, colliderId: 0 }] } : {}),
  });
}

function readVelocity(
  variant: Variant,
  physics: Physics2DAPI | Physics3DAPI,
  id: EntityId,
): number {
  if (variant === "physics2d") {
    const velocity = (physics as Physics2DAPI).getLinearVelocity(id);
    if (velocity === null) throw new Error("expected a physics2d velocity");
    return velocity.x;
  }
  const velocity = (physics as Physics3DAPI).getLinearVelocity(id);
  if (velocity === undefined) throw new Error("expected a physics3d velocity");
  return velocity.x;
}

function staleError(
  variant: Variant,
): typeof Physics2DStaleEntityError | typeof Physics3DStaleEntityError {
  return variant === "physics2d" ? Physics2DStaleEntityError : Physics3DStaleEntityError;
}

describe.each(["physics2d", "physics3d"] as const)("p54 stale physics handles (%s)", (variant) => {
  it("(a) a recycled slot does not keep the destroyed body", async () => {
    const handle = await boot(variant);
    const physics = physicsOf(handle, variant);
    const first = handle.engine.createEntity();
    addBody(variant, physics, first, 0, 0, false);

    expect(handle.engine.destroyEntity(first)).toBe(true);
    const second = handle.engine.createEntity();
    expect(entityIndex(second)).toBe(entityIndex(first));

    if (variant === "physics2d") {
      expect((physics as Physics2DAPI).getPosition(second)).toBeNull();
      expect(() => (physics as Physics2DAPI).applyImpulse(first, 10, 0)).toThrow(
        staleError(variant),
      );
    } else {
      expect((physics as Physics3DAPI).hasBody(second)).toBe(false);
      expect(() => (physics as Physics3DAPI).applyImpulse(first, { x: 10 })).toThrow(
        staleError(variant),
      );
    }
  });

  it("(b) calls with the destroyed id do not change the new owner's velocity", async () => {
    const handle = await boot(variant);
    const physics = physicsOf(handle, variant);
    const first = handle.engine.createEntity();
    addBody(variant, physics, first, 0, 0, false);
    handle.engine.destroyEntity(first);

    const second = handle.engine.createEntity();
    expect(entityIndex(second)).toBe(entityIndex(first));
    addBody(variant, physics, second, 0, 3, false);

    if (variant === "physics2d") {
      const api = physics as Physics2DAPI;
      expect(() => api.setLinearVelocity(first, 0, 0)).toThrow(Physics2DStaleEntityError);
      expect(() => api.applyImpulse(first, 50, 0)).toThrow(Physics2DStaleEntityError);
      api.removeBody(first);
    } else {
      const api = physics as Physics3DAPI;
      expect(() => api.setLinearVelocity(first, { x: 0 })).toThrow(Physics3DStaleEntityError);
      expect(() => api.applyImpulse(first, { x: 50 })).toThrow(Physics3DStaleEntityError);
      expect(api.removeBody(first)).toBe(false);
    }

    await handle.advance(3, 1 / 60);
    expect(readVelocity(variant, physics, second)).toBeCloseTo(3, 2);
  });

  it("(c) contact ids are the ids returned by createEntity", async () => {
    const handle = await boot(variant);
    const physics = physicsOf(handle, variant);
    const left = handle.engine.createEntity();
    const right = handle.engine.createEntity();
    addBody(variant, physics, left, 0, 0, true);
    addBody(variant, physics, right, 0.2, 0, true);

    const seen: Contact[] = [];
    const hook = variant === "physics2d" ? "physics:collision" : "physics3d:collision";
    handle.engine.hooks.hook(hook, (contacts: readonly Contact[]) => {
      seen.push(...contacts);
    });

    await handle.advance(8, 1 / 60);

    expect(
      seen.some(
        (contact) =>
          (contact.entityA === left && contact.entityB === right) ||
          (contact.entityA === right && contact.entityB === left),
      ),
    ).toBe(true);
  });

  it("(d) a slot reused between step and contact dispatch is not named", async () => {
    const handle = await boot(variant);
    const physics = physicsOf(handle, variant);
    const first = handle.engine.createEntity();
    const other = handle.engine.createEntity();
    addBody(variant, physics, first, 0, 0, true);
    addBody(variant, physics, other, 0.2, 0, true);

    const seen: Contact[] = [];
    const hook = variant === "physics2d" ? "physics:collision" : "physics3d:collision";
    handle.engine.hooks.hook(hook, (contacts: readonly Contact[]) => {
      seen.push(...contacts);
    });

    let swapped = false;
    let spawned: EntityId | null = null;
    handle.engine.hooks.hook("engine:before-update", () => {
      seen.length = 0;
      if (swapped) return;
      if (eventCount(handle, variant) <= 0) return;
      swapped = true;
      handle.engine.destroyEntity(first);
      spawned = handle.engine.createEntity();
      addBody(variant, physics, spawned, 0, 0, true);
    });

    for (let frame = 0; frame < 10 && !swapped; frame += 1) {
      await handle.advance(1, 1 / 60);
    }

    expect(swapped).toBe(true);
    expect(spawned).not.toBeNull();
    expect(entityIndex(spawned!)).toBe(entityIndex(first));
    expect(seen.some((contact) => contact.entityA === spawned || contact.entityB === spawned)).toBe(
      false,
    );
  });

  it("(e) pool release then acquire keeps the same id and the body", async () => {
    const handle = await boot(variant);
    const physics = physicsOf(handle, variant);
    const Actor = defineActor(definePrefab([]), () => {});
    await handle.engine.use(Actor._plugin);
    const pool = defineActorPool(Actor, { size: 2 });
    await handle.engine.use(pool._plugin);

    const id = pool.acquire();
    addBody(variant, physics, id, 0, 1, false);
    pool.release(id);
    await handle.advance(1, 1 / 60);
    const again = pool.acquire();

    expect(again).toBe(id);
    if (variant === "physics2d") {
      expect(() => (physics as Physics2DAPI).applyImpulse(again, 0, 0)).not.toThrow();
      expect((physics as Physics2DAPI).getPosition(again)).not.toBeNull();
    } else {
      expect(() => (physics as Physics3DAPI).applyImpulse(again, { x: 0 })).not.toThrow();
      expect((physics as Physics3DAPI).hasBody(again)).toBe(true);
    }
  });
});
