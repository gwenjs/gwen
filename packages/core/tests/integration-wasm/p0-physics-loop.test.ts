import { describe, expect, it } from "vitest";

import { defineComponent, Types, type EntityId } from "../../src/index.js";
import { createRealEngine } from "./harness.js";
import "../../../physics3d/src/augment";
import { Physics3DPlugin } from "../../../physics3d/src/plugin/index";
import { createPhysicsKinematicSyncSystem as createKinematicSync3D } from "../../../physics3d/src/systems";
import type { Physics3DBodyState, Physics3DColliderOptions } from "../../../physics3d/src/types";
import "../../../physics2d/src/augment";
import { Physics2DPlugin } from "../../../physics2d/src/plugin/index";
import { createPhysicsKinematicSyncSystem as createKinematicSync2D } from "../../../physics2d/src/systems";

const OVERLAP_BOX: Physics3DColliderOptions = {
  shape: { type: "box", halfX: 0.5, halfY: 0.5, halfZ: 0.5 },
  colliderId: 0,
};

const Transform3D = defineComponent({
  name: "transform3d",
  schema: { x: Types.f32, y: Types.f32, z: Types.f32 },
});

const Position2D = defineComponent({
  name: "position",
  schema: { x: Types.f32, y: Types.f32 },
});

function requireState(state: Physics3DBodyState | undefined): Physics3DBodyState {
  if (state === undefined) {
    throw new Error("expected a physics3d body state");
  }
  return state;
}

describe("P0 physics loop", () => {
  it("D1 physics3d steps: a dynamic body falls during engine frames", async () => {
    const handle = await createRealEngine({
      variant: "physics3d",
      maxEntities: 64,
    });
    try {
      const { engine, advance } = handle;
      await engine.use(Physics3DPlugin({ gravity: { x: 0, y: -10, z: 0 } }));
      const physics = engine.inject("physics3d");
      const body = engine.createEntity();
      const startY = 5;
      physics.createBody(body, {
        kind: "dynamic",
        initialPosition: { x: 0, y: startY, z: 0 },
        initialLinearVelocity: { x: 0, y: 0, z: 0 },
      });

      await advance(10, 1 / 60);

      expect(requireState(physics.getBodyState(body)).position.y).toBeLessThan(startY);
    } finally {
      await handle.dispose();
    }
  });

  it("D1 collision: overlapping bodies notify the prefab callback", async () => {
    const handle = await createRealEngine({
      variant: "physics3d",
      maxEntities: 64,
    });
    try {
      const { engine, advance } = handle;
      await engine.use(Physics3DPlugin({ gravity: { x: 0, y: 0, z: 0 } }));
      let hits = 0;
      const left = engine.createEntity();
      const right = engine.createEntity();
      await instantiate(engine, left, {
        body: {
          kind: "dynamic",
          initialPosition: { x: 0, y: 0, z: 0 },
          colliders: [OVERLAP_BOX],
        },
        onCollision: () => {
          hits += 1;
        },
      });
      await instantiate(engine, right, {
        body: {
          kind: "dynamic",
          initialPosition: { x: 0.2, y: 0, z: 0 },
          colliders: [OVERLAP_BOX],
        },
      });
      const physics = engine.inject("physics3d");
      expect(physics.hasBody(left)).toBe(true);
      expect(physics.hasBody(right)).toBe(true);

      await advance(10, 1 / 60);

      expect(hits).toBeGreaterThan(0);
    } finally {
      await handle.dispose();
    }
  });

  it("D2 kinematic sync 3D: an ECS move reaches the kinematic body", async () => {
    const handle = await createRealEngine({
      variant: "physics3d",
      maxEntities: 64,
    });
    try {
      const { engine, advance } = handle;
      await engine.use(Physics3DPlugin({ gravity: { x: 0, y: 0, z: 0 } }));
      await engine.use(createKinematicSync3D({ positionComponent: Transform3D })());
      const physics = engine.inject("physics3d");
      const body = engine.createEntity();
      engine.addComponent(body, Transform3D, { x: 0, y: 0, z: 0 });
      physics.createBody(body, {
        kind: "kinematic",
        initialPosition: { x: 0, y: 0, z: 0 },
      });
      engine.addComponent(body, Transform3D, { x: 4, y: 0, z: 0 });

      await advance(10, 1 / 60);

      expect(requireState(physics.getBodyState(body)).position.x).toBeGreaterThan(1);
    } finally {
      await handle.dispose();
    }
  });

  it("D2 kinematic sync 2D: an ECS move reaches the kinematic body", async () => {
    const handle = await createRealEngine({
      variant: "physics2d",
      maxEntities: 64,
    });
    try {
      const { engine, advance } = handle;
      await engine.use(Physics2DPlugin({ gravity: 0 }));
      await engine.use(createKinematicSync2D({ pixelsPerMeter: 1 }));
      const physics = engine.inject("physics2d");
      const body = engine.createEntity();
      engine.addComponent(body, Position2D, { x: 0, y: 0 });
      physics.addRigidBody(body, "kinematic", 0, 0);
      engine.addComponent(body, Position2D, { x: 4, y: 0 });

      await advance(10, 1 / 60);

      const position = physics.getPosition(body);
      if (position === null) {
        throw new Error("expected a physics2d body position");
      }
      expect(position.x).toBeGreaterThan(1);
    } finally {
      await handle.dispose();
    }
  });
});

async function instantiate(
  engine: Awaited<ReturnType<typeof createRealEngine>>["engine"],
  entityId: EntityId,
  physics3d: {
    readonly body: {
      readonly kind: "dynamic";
      readonly initialPosition: { readonly x: number; readonly y: number; readonly z: number };
      readonly colliders: readonly Physics3DColliderOptions[];
    };
    readonly onCollision?: () => void;
  },
): Promise<void> {
  await engine.hooks.callHook("prefab:instantiate", entityId, { physics3d });
}
