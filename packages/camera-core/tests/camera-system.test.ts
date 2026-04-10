// packages/camera-core/tests/camera-system.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createEngine } from "@gwenjs/core";
import type { GwenEngine } from "@gwenjs/core";
import { getOrCreateCameraManager, getOrCreateViewportManager } from "@gwenjs/renderer-core";
import { Camera, CameraBounds, CameraPath, CameraShake, FollowTarget } from "../src/components.js";
import { cameraPathStore } from "../src/camera-path-store.js";
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
  cameraPathStore.clear();
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

describe("CameraSystem — follow offset", () => {
  it("applies offsetX/offsetY to the lerped position", async () => {
    const engine = await makeEngine();
    engine.inject("viewportManager").set("main", { x: 0, y: 0, width: 1, height: 1 });
    await engine.use(CameraSystem);

    const targetId = engine.createEntity();
    engine.addComponent(targetId, Camera, {
      active: 1,
      priority: 0,
      projectionType: 0,
      x: 100,
      y: 100,
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
      offsetX: 10,
      offsetY: -5,
      offsetZ: 0,
    });
    cameraViewportMap.set(camId, "main");

    await engine.advance(16);

    const state = engine.inject("cameraManager").get("main");
    expect(state?.worldTransform.position.x).toBeCloseTo(110);
    expect(state?.worldTransform.position.y).toBeCloseTo(95);
  });

  it("applies partial lerp (< 1.0) smoothly", async () => {
    const engine = await makeEngine();
    engine.inject("viewportManager").set("main", { x: 0, y: 0, width: 1, height: 1 });
    await engine.use(CameraSystem);

    const targetId = engine.createEntity();
    engine.addComponent(targetId, Camera, {
      active: 1,
      priority: 0,
      projectionType: 0,
      x: 100,
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
      lerp: 0.5,
      offsetX: 0,
      offsetY: 0,
      offsetZ: 0,
    });
    cameraViewportMap.set(camId, "main");

    await engine.advance(16);

    const state = engine.inject("cameraManager").get("main");
    // lerp=0.5 → 0 + (100 - 0) * 0.5 = 50
    expect(state?.worldTransform.position.x).toBeCloseTo(50);
  });
});

describe("CameraSystem — bounds min clamp", () => {
  it("clamps camera below minX/minY", async () => {
    const engine = await makeEngine();
    engine.inject("viewportManager").set("main", { x: 0, y: 0, width: 1, height: 1 });
    await engine.use(CameraSystem);

    const targetId = engine.createEntity();
    engine.addComponent(targetId, Camera, {
      active: 1,
      priority: 0,
      projectionType: 0,
      x: -500,
      y: -500,
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
      minX: -100,
      minY: -100,
      minZ: 0,
      maxX: 100,
      maxY: 100,
      maxZ: 0,
    });
    cameraViewportMap.set(camId, "main");

    await engine.advance(16);

    const state = engine.inject("cameraManager").get("main");
    expect(state?.worldTransform.position.x).toBeCloseTo(-100);
    expect(state?.worldTransform.position.y).toBeCloseTo(-100);
  });
});

describe("CameraSystem — projection type", () => {
  it("builds orthographic projection from Camera component", async () => {
    const engine = await makeEngine();
    engine.inject("viewportManager").set("main", { x: 0, y: 0, width: 1, height: 1 });
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
      zoom: 2,
      fov: 0,
      near: -10,
      far: 10,
    });
    cameraViewportMap.set(camId, "main");

    await engine.advance(16);

    const state = engine.inject("cameraManager").get("main");
    expect(state?.projection.type).toBe("orthographic");
    if (state?.projection.type === "orthographic") {
      expect(state.projection.zoom).toBe(2);
      expect(state.projection.near).toBe(-10);
      expect(state.projection.far).toBe(10);
    }
  });

  it("builds perspective projection from Camera component", async () => {
    const engine = await makeEngine();
    engine.inject("viewportManager").set("main", { x: 0, y: 0, width: 1, height: 1 });
    await engine.use(CameraSystem);

    const camId = engine.createEntity();
    engine.addComponent(camId, Camera, {
      active: 1,
      priority: 0,
      projectionType: 1,
      x: 0,
      y: 0,
      z: 0,
      rotX: 0,
      rotY: 0,
      rotZ: 0,
      zoom: 1,
      fov: Math.PI / 3,
      near: 0.1,
      far: 1000,
    });
    cameraViewportMap.set(camId, "main");

    await engine.advance(16);

    const state = engine.inject("cameraManager").get("main");
    expect(state?.projection.type).toBe("perspective");
    if (state?.projection.type === "perspective") {
      expect(state.projection.fov).toBeCloseTo(Math.PI / 3);
      expect(state.projection.near).toBe(0.1);
      expect(state.projection.far).toBe(1000);
    }
  });
});

describe("CameraSystem — shake offset affects position", () => {
  it("shake offset shifts the CameraState position away from Camera.x/y", async () => {
    const engine = await makeEngine();
    engine.inject("viewportManager").set("main", { x: 0, y: 0, width: 1, height: 1 });
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
      maxX: 100,
      maxY: 100,
    });
    cameraViewportMap.set(camId, "main");

    await engine.advance(16);

    const state = engine.inject("cameraManager").get("main");
    expect(state).toBeDefined();
    // With maxX/maxY=100 and trauma=1 the shake offset is non-zero for this seed
    const dx = Math.abs((state?.worldTransform.position.x ?? 50) - 50);
    const dy = Math.abs((state?.worldTransform.position.y ?? 50) - 50);
    expect(dx + dy).toBeGreaterThan(0);
  });
});

describe("CameraSystem — multi-camera priority", () => {
  it("higher priority camera wins the viewport slot", async () => {
    const engine = await makeEngine();
    engine.inject("viewportManager").set("main", { x: 0, y: 0, width: 1, height: 1 });
    await engine.use(CameraSystem);

    const lowCam = engine.createEntity();
    engine.addComponent(lowCam, Camera, {
      active: 1,
      priority: 0,
      projectionType: 0,
      x: 10,
      y: 10,
      z: 0,
      rotX: 0,
      rotY: 0,
      rotZ: 0,
      zoom: 1,
      fov: 1,
      near: -1,
      far: 1,
    });
    cameraViewportMap.set(lowCam, "main");

    const highCam = engine.createEntity();
    engine.addComponent(highCam, Camera, {
      active: 1,
      priority: 10,
      projectionType: 0,
      x: 99,
      y: 99,
      z: 0,
      rotX: 0,
      rotY: 0,
      rotZ: 0,
      zoom: 1,
      fov: 1,
      near: -1,
      far: 1,
    });
    cameraViewportMap.set(highCam, "main");

    await engine.advance(16);

    // CameraManager should hold the state from highCam (priority wins)
    const state = engine.inject("cameraManager").get("main");
    expect(state?.priority).toBe(10);
    expect(state?.worldTransform.position.x).toBeCloseTo(99);
  });
});

describe("CameraSystem — camera:deactivate hook", () => {
  it("emits camera:deactivate when the only active camera is deactivated", async () => {
    const engine = await makeEngine();
    engine.inject("viewportManager").set("main", { x: 0, y: 0, width: 1, height: 1 });
    await engine.use(CameraSystem);

    const deactivateSpy = vi.fn();
    engine.hooks.hook("camera:deactivate", deactivateSpy);

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

    await engine.advance(16); // camera becomes active

    // Deactivate the camera
    const camData = engine.getComponent(camId, Camera)!;
    engine.addComponent(camId, Camera, { ...camData, active: 0 });

    await engine.advance(16); // no active camera → deactivate

    expect(deactivateSpy).toHaveBeenCalledWith({ viewportId: "main" });
  });
});

describe("CameraSystem — CameraPath", () => {
  it("advances camera toward first waypoint position", async () => {
    const engine = await makeEngine();
    engine.inject("viewportManager").set("main", { x: 0, y: 0, width: 1, height: 1 });
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
    engine.addComponent(camId, CameraPath, { index: 0, progress: 0 });
    cameraViewportMap.set(camId, "main");

    // Path with a single very short waypoint so it snaps in one frame (dt=16ms → 0.016s > 0.01s)
    cameraPathStore.set(camId, {
      waypoints: [{ position: { x: 200, y: 300, z: 0 }, duration: 0.01 }],
      opts: {},
      elapsed: 0,
    });

    await engine.advance(16); // 16ms > 10ms duration → progress=1 → snap

    const state = engine.inject("cameraManager").get("main");
    expect(state?.worldTransform.position.x).toBeCloseTo(200);
    expect(state?.worldTransform.position.y).toBeCloseTo(300);
  });

  it("calls onComplete when the last waypoint is reached (no loop)", async () => {
    const engine = await makeEngine();
    engine.inject("viewportManager").set("main", { x: 0, y: 0, width: 1, height: 1 });
    await engine.use(CameraSystem);

    const onComplete = vi.fn();

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
    engine.addComponent(camId, CameraPath, { index: 0, progress: 0 });
    cameraViewportMap.set(camId, "main");

    cameraPathStore.set(camId, {
      waypoints: [{ position: { x: 50, y: 50, z: 0 }, duration: 0.001 }],
      opts: { onComplete },
      elapsed: 0,
    });

    await engine.advance(16);

    expect(onComplete).toHaveBeenCalledOnce();
    // path data should be removed after completion
    expect(cameraPathStore.has(camId)).toBe(false);
  });

  it("loops back to index 0 when loop:true", async () => {
    const engine = await makeEngine();
    engine.inject("viewportManager").set("main", { x: 0, y: 0, width: 1, height: 1 });
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
    engine.addComponent(camId, CameraPath, { index: 0, progress: 0 });
    cameraViewportMap.set(camId, "main");

    cameraPathStore.set(camId, {
      waypoints: [{ position: { x: 50, y: 0, z: 0 }, duration: 0.001 }],
      opts: { loop: true },
      elapsed: 0,
    });

    await engine.advance(16);

    // After looping, index resets to 0 and path data is still present
    expect(cameraPathStore.has(camId)).toBe(true);
    const pathComp = engine.getComponent(camId, CameraPath);
    expect(pathComp?.index).toBe(0);
  });

  it("camera without cameraViewportMap entry is ignored", async () => {
    const engine = await makeEngine();
    engine.inject("viewportManager").set("main", { x: 0, y: 0, width: 1, height: 1 });
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
    // NOT setting cameraViewportMap

    await engine.advance(16);

    expect(engine.inject("cameraManager").get("main")).toBeUndefined();
  });
});
