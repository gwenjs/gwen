import { describe, expect, it } from "vitest";

import { defineComponent, GwenComposableError, Types, type EntityId } from "../../src/index.js";
import { createRealEngine } from "./harness.js";
import "../../../physics3d/src/augment";
import { Physics3DPlugin } from "../../../physics3d/src/plugin/index";
import { createPhysicsKinematicSyncSystem as createKinematicSync3D } from "../../../physics3d/src/systems";
import type {
  Physics3DAPI,
  Physics3DBodyState,
  Physics3DColliderOptions,
} from "../../../physics3d/src/types";
import type { Physics2DAPI } from "../../../physics2d/src/types";
import "../../../physics2d/src/augment";
import { Physics2DPlugin } from "../../../physics2d/src/plugin/index";
import { createPhysicsKinematicSyncSystem as createKinematicSync2D } from "../../../physics2d/src/systems";

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

  it("reads a collision after WASM memory grows", async () => {
    const handle = await createRealEngine({
      variant: "physics3d",
      maxEntities: 64,
    });
    try {
      const { engine, bridge, advance } = handle;
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
      await advance(5, 1 / 60);
      expect(hits).toBeGreaterThan(0);

      const memory = bridge.getLinearMemory();
      if (memory === null) throw new Error("physics3d wasm did not export memory");
      const epochBefore = engine.memory.epoch;
      memory.grow(1);

      const hitsBeforeGrow = hits;
      const againLeft = engine.createEntity();
      const againRight = engine.createEntity();
      await instantiate(engine, againLeft, {
        body: {
          kind: "dynamic",
          initialPosition: { x: 5, y: 0, z: 0 },
          colliders: [OVERLAP_BOX],
        },
        onCollision: () => {
          hits += 1;
        },
      });
      await instantiate(engine, againRight, {
        body: {
          kind: "dynamic",
          initialPosition: { x: 5.2, y: 0, z: 0 },
          colliders: [OVERLAP_BOX],
        },
      });
      await advance(5, 1 / 60);

      expect(hits).toBeGreaterThan(hitsBeforeGrow);
      expect(engine.memory.epoch).toBeGreaterThan(epochBefore);
      expect(engine.state).not.toBe("faulted");
    } finally {
      await handle.dispose();
    }
    expect(handle.engine.state).toBe("stopped");
  });

  it("moves a character controller after a first read and then WASM memory grows", async () => {
    const handle = await createRealEngine({
      variant: "physics3d",
      maxEntities: 64,
    });
    const { engine, bridge } = handle;
    try {
      await engine.use(Physics3DPlugin({ gravity: { x: 0, y: -10, z: 0 } }));
      const physics = engine.inject("physics3d");
      const body = engine.createEntity();
      physics.createBody(body, {
        kind: "kinematic",
        initialPosition: { x: 0, y: 1, z: 0 },
      });
      const cc = physics.addCharacterController(body);
      cc.move({ x: 0, y: 0, z: 0 }, 1 / 60);
      expect(cc.isGrounded).toBe(false);

      const memory = bridge.getLinearMemory();
      if (memory === null) throw new Error("physics3d wasm did not export memory");
      memory.grow(1);
      cc.move({ x: 0, y: 0, z: 0 }, 1 / 60);
      // A detached Float32Array reads as undefined, and undefined !== 0 looks grounded.
      expect(cc.isGrounded).toBe(false);
      expect(cc.groundNormal).toBeNull();
      expect(engine.state).not.toBe("faulted");
    } finally {
      await handle.dispose();
    }
  });

  it("reads a physics2d collision after a first read and then WASM memory grows", async () => {
    const handle = await createRealEngine({
      variant: "physics2d",
      maxEntities: 64,
    });
    const { engine, bridge, advance } = handle;
    try {
      await engine.use(Physics2DPlugin({ gravity: 0 }));
      const physics = engine.inject("physics2d");
      let hits = 0;
      engine.hooks.hook("physics:collision", () => {
        hits += 1;
      });
      const left = engine.createEntity();
      const right = engine.createEntity();
      const leftHandle = physics.addRigidBody(left, "dynamic", 0, 0);
      const rightHandle = physics.addRigidBody(right, "dynamic", 0.2, 0);
      physics.addBoxCollider(leftHandle, 0.5, 0.5);
      physics.addBoxCollider(rightHandle, 0.5, 0.5);

      await advance(5, 1 / 60);
      expect(hits).toBeGreaterThan(0);

      const memory = bridge.getLinearMemory();
      if (memory === null) throw new Error("physics2d wasm did not export memory");
      const epochBefore = engine.memory.epoch;
      memory.grow(1);
      const hitsBeforeGrow = hits;
      const againLeft = engine.createEntity();
      const againRight = engine.createEntity();
      const againLeftHandle = physics.addRigidBody(againLeft, "dynamic", 5, 0);
      const againRightHandle = physics.addRigidBody(againRight, "dynamic", 5.2, 0);
      physics.addBoxCollider(againLeftHandle, 0.5, 0.5);
      physics.addBoxCollider(againRightHandle, 0.5, 0.5);
      await advance(5, 1 / 60);

      expect(hits).toBeGreaterThan(hitsBeforeGrow);
      expect(engine.memory.epoch).toBeGreaterThan(epochBefore);
      expect(engine.state).not.toBe("faulted");
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

      await advance(2, 1 / 60);

      expect(requireState(physics.getBodyState(body)).position.x).toBeCloseTo(4, 3);
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
      await engine.use(createKinematicSync2D({ pixelsPerMeter: 1, positionComponent: Position2D }));
      const physics = engine.inject("physics2d");
      const body = engine.createEntity();
      engine.addComponent(body, Position2D, { x: 0, y: 0 });
      physics.addRigidBody(body, "kinematic", 0, 0);
      engine.addComponent(body, Position2D, { x: 4, y: 0 });

      await advance(2, 1 / 60);

      const position = physics.getPosition(body);
      if (position === null) {
        throw new Error("expected a physics2d body position");
      }
      expect(position.x).toBeCloseTo(4, 3);
    } finally {
      await handle.dispose();
    }
  });

  it("default debug omits phase timing and a body still falls", async () => {
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
      expect("phaseMs" in engine.getStats()).toBe(false);
      expect("overBudget" in engine.getStats()).toBe(false);
    } finally {
      await handle.dispose();
    }
  });

  it("debug: true keeps the same fall and the same hits, and times the frame only in dev", async () => {
    const handle = await createRealEngine({
      variant: "physics3d",
      maxEntities: 64,
      debug: true,
    });
    try {
      const { engine, advance } = handle;
      await engine.use(Physics3DPlugin({ gravity: { x: 0, y: -10, z: 0 } }));
      const physics = engine.inject("physics3d");
      const body = engine.createEntity();
      physics.createBody(body, {
        kind: "dynamic",
        initialPosition: { x: 0, y: 5, z: 0 },
        initialLinearVelocity: { x: 0, y: 0, z: 0 },
      });
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

      await advance(10, 1 / 60);

      const position = requireState(physics.getBodyState(body)).position;
      expect(position.x).toBe(0);
      expect(position.z).toBe(0);
      expect(position.y).toBeCloseTo(4.857639312744141, 5);
      expect(hits).toBe(1);
      const stats = engine.getStats();
      if (__GWEN_DEV__) {
        expect(Object.keys(stats.phaseMs ?? {}).sort()).toEqual([
          "afterTick",
          "plugins",
          "render",
          "tick",
          "total",
          "update",
          "wasm",
        ]);
      } else {
        expect("phaseMs" in stats).toBe(false);
        expect("overBudget" in stats).toBe(false);
      }
    } finally {
      await handle.dispose();
    }
  });

  it("3D kinematic sync before Physics3DPlugin rejects use", async () => {
    const handle = await createRealEngine({
      variant: "physics3d",
      maxEntities: 64,
    });
    try {
      const sync = createKinematicSync3D({ positionComponent: Transform3D })();
      await expect(handle.engine.use(sync)).rejects.toBeInstanceOf(GwenComposableError);
      await expect(handle.engine.use(sync)).rejects.toMatchObject({
        code: "engine:plugin-setup-failed",
        message: expect.stringContaining('Plugin/service "physics3d" not found'),
      });
    } finally {
      await handle.dispose();
    }
  });

  it("stats: timeScale 0.5 reports the real frame rate, entities, and wasm bytes", async () => {
    const handle = await createRealEngine({
      variant: "physics3d",
      maxEntities: 64,
    });
    try {
      const { engine, advance, bridge } = handle;
      engine.timeScale = 0.5;
      engine.createEntity();
      await advance(1, 1 / 60);

      const stats = engine.getStats();
      const memory = bridge.getLinearMemory();
      if (memory === null) throw new Error("physics3d wasm did not export memory");
      expect(stats.fps).toBeCloseTo(60, 5);
      expect(stats.rawFrameTime).toBeCloseTo(1 / 60, 5);
      expect(stats.rawFrameTime).toBe(engine.rawFrameTime);
      expect(stats.deltaTime).toBeCloseTo((1 / 60) * 0.5, 5);
      expect(stats.entityCount).toBe(1);
      expect(stats.wasmMemoryBytes).toBe(memory.buffer.byteLength);
      expect(stats.wasmMemoryBytes).toBeGreaterThan(0);
      expect("phaseMs" in stats).toBe(false);
      expect("overBudget" in stats).toBe(false);
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
