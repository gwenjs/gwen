// packages/camera-core/tests/use-camera.test.ts
import { describe, it, expect } from "vitest";
import { createEngine } from "@gwenjs/core";
import { defineActor, useActor } from "@gwenjs/core/actor";
import { Camera, CameraBounds, CameraShake } from "../src/components.js";
import { getCameraStores } from "../src/camera-stores.js";
import { OrthographicCameraPrefab, PerspectiveCameraPrefab } from "../src/camera-prefabs.js";
import { useCamera } from "../src/use-camera.js";

// ── Orthographic ───────────────────────────────────────────────────────────────

describe("useCamera — orthographic", () => {
  it("registers viewport and sets projectionType 0", async () => {
    const engine = await createEngine({ maxEntities: 100 });
    const Actor = defineActor(OrthographicCameraPrefab, () =>
      useCamera({ projection: "orthographic", viewport: "main" }),
    );
    await engine.use(Actor._plugin);
    const actor = engine.run(() => useActor(Actor));
    const id = actor.spawn();

    expect(getCameraStores(engine).viewports.get(id)).toBe("main");
    expect(engine.getComponent(id, Camera)?.projectionType).toBe(0);
  });

  it("applies initial opts", async () => {
    const engine = await createEngine({ maxEntities: 100 });
    const Actor = defineActor(OrthographicCameraPrefab, () =>
      useCamera({ projection: "orthographic", zoom: 2, priority: 3, near: 0.5, far: 500 }),
    );
    await engine.use(Actor._plugin);
    const actor = engine.run(() => useActor(Actor));
    const id = actor.spawn();
    const cam = engine.getComponent(id, Camera);

    expect(cam?.zoom).toBe(2);
    expect(cam?.priority).toBe(3);
    expect(cam?.near).toBeCloseTo(0.5);
    expect(cam?.far).toBe(500);
  });

  it("setZoom updates zoom", async () => {
    const engine = await createEngine({ maxEntities: 100 });
    const Actor = defineActor(OrthographicCameraPrefab, () =>
      useCamera({ projection: "orthographic" }),
    );
    await engine.use(Actor._plugin);
    const actor = engine.run(() => useActor(Actor));
    const id = actor.spawn();
    actor.get()!.setZoom(3);

    expect(engine.getComponent(id, Camera)?.zoom).toBe(3);
  });

  it("getZoom returns current zoom", async () => {
    const engine = await createEngine({ maxEntities: 100 });
    const Actor = defineActor(OrthographicCameraPrefab, () =>
      useCamera({ projection: "orthographic", zoom: 4 }),
    );
    await engine.use(Actor._plugin);
    const actor = engine.run(() => useActor(Actor));
    actor.spawn();

    expect(actor.get()!.getZoom()).toBe(4);
  });

  it("setPosition updates x and y", async () => {
    const engine = await createEngine({ maxEntities: 100 });
    const Actor = defineActor(OrthographicCameraPrefab, () =>
      useCamera({ projection: "orthographic" }),
    );
    await engine.use(Actor._plugin);
    const actor = engine.run(() => useActor(Actor));
    const id = actor.spawn();
    actor.get()!.setPosition(10, 20);
    const cam = engine.getComponent(id, Camera);

    expect(cam?.x).toBe(10);
    expect(cam?.y).toBe(20);
  });

  it("setActive disables camera", async () => {
    const engine = await createEngine({ maxEntities: 100 });
    const Actor = defineActor(OrthographicCameraPrefab, () =>
      useCamera({ projection: "orthographic" }),
    );
    await engine.use(Actor._plugin);
    const actor = engine.run(() => useActor(Actor));
    const id = actor.spawn();
    actor.get()!.setActive(false);

    expect(engine.getComponent(id, Camera)?.active).toBe(0);
  });

  it("setPriority updates priority", async () => {
    const engine = await createEngine({ maxEntities: 100 });
    const Actor = defineActor(OrthographicCameraPrefab, () =>
      useCamera({ projection: "orthographic" }),
    );
    await engine.use(Actor._plugin);
    const actor = engine.run(() => useActor(Actor));
    const id = actor.spawn();
    actor.get()!.setPriority(7);

    expect(engine.getComponent(id, Camera)?.priority).toBe(7);
  });

  it("setViewport updates cameraViewportMap and getViewport", async () => {
    const engine = await createEngine({ maxEntities: 100 });
    const Actor = defineActor(OrthographicCameraPrefab, () =>
      useCamera({ projection: "orthographic", viewport: "main" }),
    );
    await engine.use(Actor._plugin);
    const actor = engine.run(() => useActor(Actor));
    const id = actor.spawn();
    actor.get()!.setViewport("hud");

    expect(getCameraStores(engine).viewports.get(id)).toBe("hud");
    expect(actor.get()!.getViewport()).toBe("hud");
  });

  it("setBounds updates CameraBounds", async () => {
    const engine = await createEngine({ maxEntities: 100 });
    const Actor = defineActor(OrthographicCameraPrefab, () =>
      useCamera({ projection: "orthographic" }),
    );
    await engine.use(Actor._plugin);
    const actor = engine.run(() => useActor(Actor));
    const id = actor.spawn();
    actor.get()!.setBounds({ minX: -100, maxX: 100, minY: -50, maxY: 50 });
    const bounds = engine.getComponent(id, CameraBounds);

    expect(bounds?.minX).toBe(-100);
    expect(bounds?.maxX).toBe(100);
    expect(bounds?.minY).toBe(-50);
    expect(bounds?.maxY).toBe(50);
    expect(bounds?.minZ).toBe(-Infinity);
    expect(bounds?.maxZ).toBe(Infinity);
  });

  it("clearBounds resets all bounds to Infinity", async () => {
    const engine = await createEngine({ maxEntities: 100 });
    const Actor = defineActor(OrthographicCameraPrefab, () =>
      useCamera({ projection: "orthographic" }),
    );
    await engine.use(Actor._plugin);
    const actor = engine.run(() => useActor(Actor));
    const id = actor.spawn();
    actor.get()!.setBounds({ minX: -100, maxX: 100 });
    actor.get()!.clearBounds();
    const bounds = engine.getComponent(id, CameraBounds);

    expect(bounds?.minX).toBe(-Infinity);
    expect(bounds?.maxX).toBe(Infinity);
    expect(bounds?.minY).toBe(-Infinity);
    expect(bounds?.maxY).toBe(Infinity);
  });

  it("shake sets trauma on CameraShake", async () => {
    const engine = await createEngine({ maxEntities: 100 });
    const Actor = defineActor(OrthographicCameraPrefab, () =>
      useCamera({ projection: "orthographic" }),
    );
    await engine.use(Actor._plugin);
    const actor = engine.run(() => useActor(Actor));
    const id = actor.spawn();
    actor.get()!.shake(0.8);

    expect(engine.getComponent(id, CameraShake)?.trauma).toBeCloseTo(0.8);
  });

  it("ShakeHandle.trauma accumulates trauma", async () => {
    const engine = await createEngine({ maxEntities: 100 });
    const Actor = defineActor(OrthographicCameraPrefab, () =>
      useCamera({ projection: "orthographic" }),
    );
    await engine.use(Actor._plugin);
    const actor = engine.run(() => useActor(Actor));
    const id = actor.spawn();
    const handle = actor.get()!.shake(0.3);
    handle.trauma(0.3);

    expect(engine.getComponent(id, CameraShake)?.trauma).toBeCloseTo(0.6);
  });

  it("ShakeHandle.trauma clamps at 1", async () => {
    const engine = await createEngine({ maxEntities: 100 });
    const Actor = defineActor(OrthographicCameraPrefab, () =>
      useCamera({ projection: "orthographic" }),
    );
    await engine.use(Actor._plugin);
    const actor = engine.run(() => useActor(Actor));
    const id = actor.spawn();
    const handle = actor.get()!.shake(0.8);
    handle.trauma(0.8);

    expect(engine.getComponent(id, CameraShake)?.trauma).toBe(1);
  });

  it("despawn removes entity from cameraViewportMap", async () => {
    const engine = await createEngine({ maxEntities: 100 });
    const Actor = defineActor(OrthographicCameraPrefab, () =>
      useCamera({ projection: "orthographic", viewport: "main" }),
    );
    await engine.use(Actor._plugin);
    const actor = engine.run(() => useActor(Actor));
    const id = actor.spawn();
    expect(getCameraStores(engine).viewports.has(id)).toBe(true);
    actor.despawn(id);

    expect(getCameraStores(engine).viewports.has(id)).toBe(false);
  });
});

// ── Perspective ────────────────────────────────────────────────────────────────

describe("useCamera — perspective", () => {
  it("sets projectionType 1", async () => {
    const engine = await createEngine({ maxEntities: 100 });
    const Actor = defineActor(PerspectiveCameraPrefab, () =>
      useCamera({ projection: "perspective" }),
    );
    await engine.use(Actor._plugin);
    const actor = engine.run(() => useActor(Actor));
    const id = actor.spawn();

    expect(engine.getComponent(id, Camera)?.projectionType).toBe(1);
  });

  it("applies default fov", async () => {
    const engine = await createEngine({ maxEntities: 100 });
    const Actor = defineActor(PerspectiveCameraPrefab, () =>
      useCamera({ projection: "perspective" }),
    );
    await engine.use(Actor._plugin);
    const actor = engine.run(() => useActor(Actor));
    const id = actor.spawn();

    expect(engine.getComponent(id, Camera)?.fov).toBeCloseTo(Math.PI / 3);
  });

  it("setFov updates fov and getFov reads it back", async () => {
    const engine = await createEngine({ maxEntities: 100 });
    const Actor = defineActor(PerspectiveCameraPrefab, () =>
      useCamera({ projection: "perspective" }),
    );
    await engine.use(Actor._plugin);
    const actor = engine.run(() => useActor(Actor));
    const id = actor.spawn();
    actor.get()!.setFov(Math.PI / 2);

    expect(engine.getComponent(id, Camera)?.fov).toBeCloseTo(Math.PI / 2);
    expect(actor.get()!.getFov()).toBeCloseTo(Math.PI / 2);
  });

  it("setPosition updates x, y, z", async () => {
    const engine = await createEngine({ maxEntities: 100 });
    const Actor = defineActor(PerspectiveCameraPrefab, () =>
      useCamera({ projection: "perspective" }),
    );
    await engine.use(Actor._plugin);
    const actor = engine.run(() => useActor(Actor));
    const id = actor.spawn();
    actor.get()!.setPosition(1, 2, 3);
    const cam = engine.getComponent(id, Camera);

    expect(cam?.x).toBe(1);
    expect(cam?.y).toBe(2);
    expect(cam?.z).toBe(3);
  });

  it("setRotation updates rotX, rotY, rotZ", async () => {
    const engine = await createEngine({ maxEntities: 100 });
    const Actor = defineActor(PerspectiveCameraPrefab, () =>
      useCamera({ projection: "perspective" }),
    );
    await engine.use(Actor._plugin);
    const actor = engine.run(() => useActor(Actor));
    const id = actor.spawn();
    actor.get()!.setRotation(0.1, 0.2, 0.3);
    const cam = engine.getComponent(id, Camera);

    expect(cam?.rotX).toBeCloseTo(0.1);
    expect(cam?.rotY).toBeCloseTo(0.2);
    expect(cam?.rotZ).toBeCloseTo(0.3);
  });

  it("setBounds includes minZ and maxZ", async () => {
    const engine = await createEngine({ maxEntities: 100 });
    const Actor = defineActor(PerspectiveCameraPrefab, () =>
      useCamera({ projection: "perspective" }),
    );
    await engine.use(Actor._plugin);
    const actor = engine.run(() => useActor(Actor));
    const id = actor.spawn();
    actor.get()!.setBounds({ minX: -10, maxX: 10, minZ: -5, maxZ: 5 });
    const bounds = engine.getComponent(id, CameraBounds);

    expect(bounds?.minX).toBe(-10);
    expect(bounds?.maxX).toBe(10);
    expect(bounds?.minZ).toBe(-5);
    expect(bounds?.maxZ).toBe(5);
  });
});
