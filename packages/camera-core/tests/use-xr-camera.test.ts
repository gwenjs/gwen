// packages/camera-core/tests/use-xr-camera.test.ts
import { describe, it, expect } from "vitest";
import { createEngine } from "@gwenjs/core";
import { defineActor, useActor } from "@gwenjs/core/actor";
import { Camera } from "../src/components.js";
import { getCameraStores } from "../src/camera-stores.js";
import { XRCameraPrefab } from "../src/xr-camera-prefab.js";
import { useXRCamera } from "../src/use-xr-camera.js";

function makeViewMatrix(tx: number, ty: number, tz: number): Float32Array {
  // Identity rotation + translation — column-major 4×4
  // R = I, t = [tx, ty, tz] → position = -R^T * t = -[tx, ty, tz]
  const m = new Float32Array(16);
  m[0] = 1;
  m[5] = 1;
  m[10] = 1;
  m[15] = 1; // identity rotation
  m[12] = tx;
  m[13] = ty;
  m[14] = tz; // translation
  return m;
}

describe("useXRCamera", () => {
  it("registers viewport and sets projectionType 2", async () => {
    const engine = await createEngine({ maxEntities: 100 });
    const Actor = defineActor(XRCameraPrefab, () => useXRCamera({ viewport: "main" }));
    await engine.use(Actor._plugin);
    const actor = engine.run(() => useActor(Actor));
    const id = actor.spawn();

    expect(getCameraStores(engine).viewports.get(id)).toBe("main");
    expect(engine.getComponent(id, Camera)?.projectionType).toBe(2);
  });

  it("applies default opts", async () => {
    const engine = await createEngine({ maxEntities: 100 });
    const Actor = defineActor(XRCameraPrefab, () => useXRCamera());
    await engine.use(Actor._plugin);
    const actor = engine.run(() => useActor(Actor));
    const id = actor.spawn();

    expect(getCameraStores(engine).viewports.get(id)).toBe("main");
    expect(engine.getComponent(id, Camera)?.priority).toBe(0);
  });

  it("applies custom priority", async () => {
    const engine = await createEngine({ maxEntities: 100 });
    const Actor = defineActor(XRCameraPrefab, () => useXRCamera({ priority: 10 }));
    await engine.use(Actor._plugin);
    const actor = engine.run(() => useActor(Actor));
    const id = actor.spawn();

    expect(engine.getComponent(id, Camera)?.priority).toBe(10);
  });

  it("setViewport updates cameraViewportMap and getViewport", async () => {
    const engine = await createEngine({ maxEntities: 100 });
    const Actor = defineActor(XRCameraPrefab, () => useXRCamera({ viewport: "main" }));
    await engine.use(Actor._plugin);
    const actor = engine.run(() => useActor(Actor));
    const id = actor.spawn();
    actor.get()!.setViewport("hud");

    expect(getCameraStores(engine).viewports.get(id)).toBe("hud");
    expect(actor.get()!.getViewport()).toBe("hud");
  });

  it("setPriority updates Camera priority", async () => {
    const engine = await createEngine({ maxEntities: 100 });
    const Actor = defineActor(XRCameraPrefab, () => useXRCamera());
    await engine.use(Actor._plugin);
    const actor = engine.run(() => useActor(Actor));
    const id = actor.spawn();
    actor.get()!.setPriority(5);

    expect(engine.getComponent(id, Camera)?.priority).toBe(5);
  });

  it("setActive disables the camera", async () => {
    const engine = await createEngine({ maxEntities: 100 });
    const Actor = defineActor(XRCameraPrefab, () => useXRCamera());
    await engine.use(Actor._plugin);
    const actor = engine.run(() => useActor(Actor));
    const id = actor.spawn();
    actor.get()!.setActive(false);

    expect(engine.getComponent(id, Camera)?.active).toBe(0);
  });

  it("_setViews stores data in cameraMatrixStore", async () => {
    const engine = await createEngine({ maxEntities: 100 });
    const Actor = defineActor(XRCameraPrefab, () => useXRCamera());
    await engine.use(Actor._plugin);
    const actor = engine.run(() => useActor(Actor));
    const id = actor.spawn();

    const views = [
      {
        eye: "left" as const,
        viewMatrix: makeViewMatrix(1, 2, 3),
        projectionMatrix: new Float32Array(16),
      },
      {
        eye: "right" as const,
        viewMatrix: makeViewMatrix(1, 2, 3),
        projectionMatrix: new Float32Array(16),
      },
    ];
    actor.get()!._setViews(views);

    expect(getCameraStores(engine).matrices.get(id)).toBe(views);
    expect(getCameraStores(engine).matrices.get(id)!.length).toBe(2);
  });

  it("getHeadPosition returns undefined before _setViews", async () => {
    const engine = await createEngine({ maxEntities: 100 });
    const Actor = defineActor(XRCameraPrefab, () => useXRCamera());
    await engine.use(Actor._plugin);
    const actor = engine.run(() => useActor(Actor));
    actor.spawn();

    expect(actor.get()!.getHeadPosition()).toBeUndefined();
  });

  it("getHeadPosition derives world position from view matrix", async () => {
    const engine = await createEngine({ maxEntities: 100 });
    const Actor = defineActor(XRCameraPrefab, () => useXRCamera());
    await engine.use(Actor._plugin);
    const actor = engine.run(() => useActor(Actor));
    actor.spawn();

    // Identity rotation + translation [5, 3, -2]
    // Camera world pos = -R^T * t = -I * [5,3,-2] = [-5, -3, 2]
    actor.get()!._setViews([
      {
        eye: "left",
        viewMatrix: makeViewMatrix(5, 3, -2),
        projectionMatrix: new Float32Array(16),
      },
    ]);

    const pos = actor.get()!.getHeadPosition()!;
    expect(pos.x).toBeCloseTo(-5);
    expect(pos.y).toBeCloseTo(-3);
    expect(pos.z).toBeCloseTo(2);
  });

  it("despawn removes entity from both maps", async () => {
    const engine = await createEngine({ maxEntities: 100 });
    const Actor = defineActor(XRCameraPrefab, () => useXRCamera());
    await engine.use(Actor._plugin);
    const actor = engine.run(() => useActor(Actor));
    const id = actor.spawn();

    actor.get()!._setViews([
      {
        eye: "none",
        viewMatrix: makeViewMatrix(0, 0, 0),
        projectionMatrix: new Float32Array(16),
      },
    ]);
    expect(getCameraStores(engine).viewports.has(id)).toBe(true);
    expect(getCameraStores(engine).matrices.has(id)).toBe(true);

    actor.despawn(id);
    expect(getCameraStores(engine).viewports.has(id)).toBe(false);
    expect(getCameraStores(engine).matrices.has(id)).toBe(false);
  });
});

describe("CameraSystem — XR cameras are skipped", () => {
  it("XR camera is not processed by CameraSystem", async () => {
    const engine = await createEngine({ maxEntities: 100 });
    const { getOrCreateCameraManager, getOrCreateViewportManager } =
      await import("@gwenjs/renderer-core");
    getOrCreateCameraManager(engine);
    getOrCreateViewportManager(engine);
    const { CameraSystem } = await import("../src/camera-system.js");
    await engine.use(CameraSystem());

    const Actor = defineActor(XRCameraPrefab, () => useXRCamera({ viewport: "main" }));
    await engine.use(Actor._plugin);
    const actor = engine.run(() => useActor(Actor));
    actor.spawn();

    await engine.advance(0.016);

    const cameras = engine.inject("cameraManager");
    // CameraSystem must not have pushed a state for the XR camera
    expect(cameras.get("main")).toBeUndefined();
  });
});
