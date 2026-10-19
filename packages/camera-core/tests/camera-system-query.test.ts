// packages/camera-core/tests/camera-system-query.test.ts
import { describe, it, expect, vi } from "vitest";
import { createEngine } from "@gwenjs/core";
import type { EntityId, GwenEngine } from "@gwenjs/core";
import { getOrCreateCameraManager, getOrCreateViewportManager } from "@gwenjs/renderer-core";
import { Camera, CameraBounds } from "../src/components.js";
import { getCameraStores } from "../src/camera-stores.js";
import { CameraSystem } from "../src/camera-system.js";

/** The real engine, with a pass-through spy on the deprecated `createLiveQuery`. */
async function makeEngine(): Promise<GwenEngine> {
  const engine = await createEngine({ maxEntities: 100 });
  liveQuerySpy.current = vi.spyOn(engine, "createLiveQuery");
  getOrCreateCameraManager(engine);
  getOrCreateViewportManager(engine);
  engine.inject("viewportManager").set("main", { x: 0, y: 0, width: 1, height: 1 });
  engine.inject("viewportManager").set("minimap", { x: 0, y: 0, width: 1, height: 1 });
  return engine;
}

const liveQuerySpy: { current?: { mock: { calls: unknown[] } } } = {};

function expectNoLiveQuery(): void {
  expect(liveQuerySpy.current?.mock.calls).toEqual([]);
}

function addCamera(
  engine: GwenEngine,
  viewport: string,
  fields: { x: number; priority?: number; active?: 0 | 1; bounded?: boolean },
): EntityId {
  const id = engine.createEntity();
  engine.addComponent(id, Camera, {
    active: fields.active ?? 1,
    priority: fields.priority ?? 0,
    projectionType: 0,
    x: fields.x,
    y: 0,
    z: 0,
    rotX: 0,
    rotY: 0,
    rotZ: 0,
    zoom: 1,
    fov: 1,
    near: -1,
    far: 1,
  });
  if (fields.bounded === true) {
    engine.addComponent(id, CameraBounds, {
      minX: -1000,
      maxX: 1000,
      minY: -1000,
      maxY: 1000,
      minZ: -1000,
      maxZ: 1000,
    });
  }
  getCameraStores(engine).viewports.set(id, viewport);
  return id;
}

describe("CameraSystem — which camera query order decides", () => {
  it("with equal priority the camera created later in the same archetype wins", async () => {
    const engine = await makeEngine();
    await engine.use(CameraSystem());
    const activated: EntityId[] = [];
    engine.hooks.hook("camera:activate", (event) => activated.push(event.entityId));
    addCamera(engine, "main", { x: 1 });
    const second = addCamera(engine, "main", { x: 2 });

    await engine.advance(0.016);

    expect(activated).toEqual([second]);
    expect(engine.inject("cameraManager").get("main")?.worldTransform.position.x).toBeCloseTo(2);
    expectNoLiveQuery();
  });

  it.each([
    { name: "plain created first", boundedFirst: false },
    { name: "bounded created first", boundedFirst: true },
  ])(
    "with equal priority across two archetypes the camera with the extra component wins ($name)",
    async ({ boundedFirst }) => {
      const engine = await makeEngine();
      await engine.use(CameraSystem());
      const activated: EntityId[] = [];
      engine.hooks.hook("camera:activate", (event) => activated.push(event.entityId));
      let plain: EntityId;
      let bounded: EntityId;
      if (boundedFirst) {
        bounded = addCamera(engine, "main", { x: 2, bounded: true });
        plain = addCamera(engine, "main", { x: 1 });
      } else {
        plain = addCamera(engine, "main", { x: 1 });
        bounded = addCamera(engine, "main", { x: 2, bounded: true });
      }

      await engine.advance(0.016);

      // Query order follows the archetype chunks, not the creation order: the chunk of the
      // entities that also hold CameraBounds comes last, and the last equal priority wins.
      expect(plain).not.toBe(bounded);
      expect(activated).toEqual([bounded]);
      expect(engine.inject("cameraManager").get("main")?.worldTransform.position.x).toBeCloseTo(2);
      expectNoLiveQuery();
    },
  );

  it("pushes one state per viewport and skips active = 0 among several cameras", async () => {
    const engine = await makeEngine();
    await engine.use(CameraSystem());
    addCamera(engine, "main", { x: 5 });
    addCamera(engine, "minimap", { x: 7, bounded: true });
    addCamera(engine, "minimap", { x: 9, active: 0 });

    await engine.advance(0.016);

    const cameras = engine.inject("cameraManager");
    expect(cameras.get("main")?.worldTransform.position.x).toBeCloseTo(5);
    expect(cameras.get("minimap")?.worldTransform.position.x).toBeCloseTo(7);
    expectNoLiveQuery();
  });
});

describe("CameraSystem — reads cameras through the chunk store", () => {
  it("never calls the deprecated createLiveQuery", async () => {
    const engine = await makeEngine();
    await engine.use(CameraSystem());
    addCamera(engine, "main", { x: 1 });

    await engine.advance(0.016);

    expectNoLiveQuery();
    expect(engine.inject("cameraManager").get("main")?.worldTransform.position.x).toBeCloseTo(1);
  });

  it("does not take the per-entity query path during a frame", async () => {
    const engine = await makeEngine();
    const codes: string[] = [];
    engine.errors.on((event) => codes.push(event.code));
    await engine.use(CameraSystem());
    addCamera(engine, "main", { x: 1 });
    addCamera(engine, "minimap", { x: 2, bounded: true });

    await engine.advance(0.016);
    await engine.advance(0.016);

    expect(codes).not.toContain("CORE:QUERY_PER_ENTITY_PATH");
    expectNoLiveQuery();
  });
});
