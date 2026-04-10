// packages/camera-core/tests/camera-system.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createEngine } from "@gwenjs/core";
import type { GwenEngine } from "@gwenjs/core";
import { getOrCreateCameraManager, getOrCreateViewportManager } from "@gwenjs/renderer-core";
import { Camera, FollowTarget, CameraBounds, CameraShake } from "../src/components.js";
import { cameraViewportMap } from "../src/camera-viewport-map.js";
import { CameraSystem } from "../src/camera-system.js";

async function makeEngine(): Promise<GwenEngine> {
  const engine = await createEngine({ maxEntities: 100 });
  getOrCreateCameraManager(engine);
  getOrCreateViewportManager(engine);
  return engine;
}

beforeEach(() => {
  cameraViewportMap.clear();
});

describe("CameraSystem — follow target", () => {
  it("lerps camera position toward target position", async () => {
    const engine = await makeEngine();
    const viewports = engine.inject("viewportManager");
    viewports.set("main", { x: 0, y: 0, width: 1, height: 1 });

    await engine.use(CameraSystem);

    // create target entity with Camera component at (100, 200)
    const targetId = engine.createEntity();
    engine.addComponent(targetId, Camera, {
      active: 1,
      priority: 0,
      projectionType: 0,
      x: 100,
      y: 200,
      z: 0,
      rotX: 0,
      rotY: 0,
      rotZ: 0,
      zoom: 1,
      fov: 1,
      near: -1,
      far: 1,
    });

    // create camera entity following the target
    const camId = engine.createEntity();
    engine.addComponent(camId, Camera, {
      active: 1,
      priority: 0,
      projectionType: 0,
      x: 0,
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
    engine.addComponent(camId, FollowTarget, {
      entityId: targetId,
      lerp: 1.0, // instant at lerp=1
      offsetX: 0,
      offsetY: 0,
      offsetZ: 0,
    });
    cameraViewportMap.set(camId, "main");

    await engine.advance(16); // one frame

    const cameras = engine.inject("cameraManager");
    const state = cameras.get("main");
    expect(state).toBeDefined();
    expect(state?.worldTransform.position.x).toBeCloseTo(100);
    expect(state?.worldTransform.position.y).toBeCloseTo(200);
  });
});

describe("CameraSystem — bounds clamp", () => {
  it("clamps camera position to CameraBounds after follow", async () => {
    const engine = await makeEngine();
    const viewports = engine.inject("viewportManager");
    viewports.set("main", { x: 0, y: 0, width: 1, height: 1 });
    await engine.use(CameraSystem);

    const targetId = engine.createEntity();
    engine.addComponent(targetId, Camera, {
      active: 1,
      priority: 0,
      projectionType: 0,
      x: 500,
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

    const camId = engine.createEntity();
    engine.addComponent(camId, Camera, {
      active: 1,
      priority: 0,
      projectionType: 0,
      x: 0,
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
    engine.addComponent(camId, FollowTarget, {
      entityId: targetId,
      lerp: 1.0,
      offsetX: 0,
      offsetY: 0,
      offsetZ: 0,
    });
    engine.addComponent(camId, CameraBounds, {
      minX: 0,
      minY: 0,
      minZ: 0,
      maxX: 200,
      maxY: 200,
      maxZ: 0,
    });
    cameraViewportMap.set(camId, "main");

    await engine.advance(16);

    const state = engine.inject("cameraManager").get("main");
    expect(state?.worldTransform.position.x).toBeCloseTo(200); // clamped
  });
});

describe("CameraSystem — shake", () => {
  it("applies shake offset without modifying Camera.x/y", async () => {
    const engine = await makeEngine();
    const viewports = engine.inject("viewportManager");
    viewports.set("main", { x: 0, y: 0, width: 1, height: 1 });
    await engine.use(CameraSystem);

    const camId = engine.createEntity();
    engine.addComponent(camId, Camera, {
      active: 1,
      priority: 0,
      projectionType: 0,
      x: 50,
      y: 50,
      z: 0,
      rotX: 0,
      rotY: 0,
      rotZ: 0,
      zoom: 1,
      fov: 1,
      near: -1,
      far: 1,
    });
    engine.addComponent(camId, CameraShake, {
      trauma: 1.0,
      decay: 0,
      maxX: 20,
      maxY: 20,
    });
    cameraViewportMap.set(camId, "main");

    await engine.advance(16);

    // Camera.x must remain 50 (shake does not write back to Camera component)
    expect(engine.getComponent(camId, Camera)?.x).toBe(50);

    // But the CameraState position may differ
    const state = engine.inject("cameraManager").get("main");
    expect(state).toBeDefined();
  });

  it("decays trauma each frame", async () => {
    const engine = await makeEngine();
    const viewports = engine.inject("viewportManager");
    viewports.set("main", { x: 0, y: 0, width: 1, height: 1 });
    await engine.use(CameraSystem);

    const camId = engine.createEntity();
    engine.addComponent(camId, Camera, {
      active: 1,
      priority: 0,
      projectionType: 0,
      x: 0,
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
    engine.addComponent(camId, CameraShake, {
      trauma: 1.0,
      decay: 1.0,
      maxX: 10,
      maxY: 10,
    });
    cameraViewportMap.set(camId, "main");

    // trauma starts at 1.0, decay=1.0 per second, dt=16ms → should be near 0.984
    await engine.advance(16);
    expect(engine.getComponent(camId, CameraShake)?.trauma).toBeLessThan(1.0);
  });
});

describe("CameraSystem — inactive camera", () => {
  it("does not push to CameraManager when Camera.active = 0", async () => {
    const engine = await makeEngine();
    const viewports = engine.inject("viewportManager");
    viewports.set("main", { x: 0, y: 0, width: 1, height: 1 });
    await engine.use(CameraSystem);

    const camId = engine.createEntity();
    engine.addComponent(camId, Camera, {
      active: 0,
      priority: 0,
      projectionType: 0,
      x: 0,
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
    cameraViewportMap.set(camId, "main");

    await engine.advance(16);

    expect(engine.inject("cameraManager").get("main")).toBeUndefined();
  });
});

describe("CameraSystem — semantic hooks", () => {
  it("emits camera:activate when a camera becomes active on a viewport", async () => {
    const engine = await makeEngine();
    const viewports = engine.inject("viewportManager");
    viewports.set("main", { x: 0, y: 0, width: 1, height: 1 });
    await engine.use(CameraSystem);

    const activateSpy = vi.fn();
    engine.hooks.hook("camera:activate", activateSpy);

    const camId = engine.createEntity();
    engine.addComponent(camId, Camera, {
      active: 1,
      priority: 0,
      projectionType: 0,
      x: 0,
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
    cameraViewportMap.set(camId, "main");

    await engine.advance(16);

    expect(activateSpy).toHaveBeenCalledWith({ viewportId: "main", entityId: camId });
  });

  it("emits camera:switch when active camera changes on a viewport", async () => {
    const engine = await makeEngine();
    const viewports = engine.inject("viewportManager");
    viewports.set("main", { x: 0, y: 0, width: 1, height: 1 });
    await engine.use(CameraSystem);

    const switchSpy = vi.fn();
    engine.hooks.hook("camera:switch", switchSpy);

    const cam1 = engine.createEntity();
    engine.addComponent(cam1, Camera, {
      active: 1,
      priority: 0,
      projectionType: 0,
      x: 0,
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
    cameraViewportMap.set(cam1, "main");

    await engine.advance(16); // cam1 becomes active

    const cam2 = engine.createEntity();
    engine.addComponent(cam2, Camera, {
      active: 1,
      priority: 1,
      projectionType: 0, // higher priority
      x: 0,
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
    cameraViewportMap.set(cam2, "main");

    // Deactivate cam1 by updating the component
    const cam1Data = engine.getComponent(cam1, Camera)!;
    engine.addComponent(cam1, Camera, { ...cam1Data, active: 0 });

    await engine.advance(16); // cam2 takes over

    expect(switchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ viewportId: "main", from: cam1, to: cam2 }),
    );
  });
});
