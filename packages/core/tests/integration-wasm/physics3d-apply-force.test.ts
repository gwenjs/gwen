/**
 * applyForce over one frame matches applyImpulse of force×dt on a real physics3d engine.
 * Twin dynamic actors, zero gravity, no colliders so contact impulses stay out of the velocity.
 */
import { describe, expect, it } from "vitest";

import { defineActor, definePrefab, useEntityId } from "../../src/actor/index.js";
import { defineComponent, Types, type EntityId } from "../../src/index.js";
import { createRealEngine } from "./harness.js";
import "../../../physics3d/src/augment";
import { Physics3DPlugin } from "../../../physics3d/src/plugin/index";
import { useDynamicBody } from "../../../physics3d/src/composables/use-dynamic-body";
import type { Physics3DAPI } from "../../../physics3d/src/types";

declare module "@gwenjs/schema" {
  interface GwenProvides {
    physics3d: Physics3DAPI;
  }
}

const Marker = defineComponent({
  name: "Physics3dApplyForceMarker",
  schema: { v: Types.u32 },
});

const Prefab = definePrefab([{ def: Marker, defaults: { v: 1 } }]);

/** 60 N over a 1/60 s frame is 1 N·s. On the base, applyForce sends the raw 60 N·s. */
const DT = 1 / 60;
const FORCE_X = 60;

interface Mover {
  id: EntityId;
  applyForce(fx: number, fy: number, fz: number): void;
  applyImpulse(ix: number, iy: number, iz: number): void;
}

const MoverActor = defineActor(Prefab, (props: { x: number }): Mover => {
  const id = useEntityId();
  const body = useDynamicBody({
    mass: 1,
    gravityScale: 0,
    linearDamping: 0,
    initialPosition: { x: props.x, y: 2, z: 0 },
  });
  return {
    id,
    applyForce: (fx, fy, fz) => {
      body.applyForce(fx, fy, fz);
    },
    applyImpulse: (ix, iy, iz) => {
      body.applyImpulse(ix, iy, iz);
    },
  };
});

function velocityX(physics: Physics3DAPI, id: EntityId): number {
  const state = physics.getBodyState(id);
  if (state === undefined) throw new Error("expected a physics body");
  return state.linearVelocity.x;
}

describe("physics3d applyForce", () => {
  it("applyForce over one frame equals applyImpulse of force×dt", async () => {
    const handle = await createRealEngine({ variant: "physics3d", maxEntities: 32 });
    try {
      const { engine, advance } = handle;
      await engine.use(Physics3DPlugin({ gravity: { x: 0, y: 0, z: 0 } }));
      await engine.use(MoverActor._plugin);
      const forcedId = MoverActor._plugin.spawn({ x: 0 });
      const impulsedId = MoverActor._plugin.spawn({ x: 8 });
      const forced = MoverActor._instances.get(forcedId)?.api;
      const impulsed = MoverActor._instances.get(impulsedId)?.api;
      if (forced === undefined || impulsed === undefined) {
        throw new Error("expected both actor instances");
      }
      // Rapier ignores an impulse until the first step has computed mass.
      // That warmup step runs before either call. The next frame is the one under test:
      // the plugin step is registered before the actor flush, so the flush can land
      // after the step and still be visible on getBodyState.
      await advance(1, DT);
      forced.applyForce(FORCE_X, 0, 0);
      impulsed.applyImpulse(FORCE_X * DT, 0, 0);
      await advance(1, DT);
      const physics = engine.inject("physics3d");
      const forcedVx = velocityX(physics, forced.id);
      const impulsedVx = velocityX(physics, impulsed.id);
      expect(impulsedVx).toBeGreaterThan(0.5);
      expect(forcedVx).toBeCloseTo(impulsedVx, 1);
    } finally {
      await handle.dispose();
    }
  });
});
