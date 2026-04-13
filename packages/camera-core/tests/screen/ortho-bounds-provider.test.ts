import { describe, it, expect } from "vitest";
import { createEngine } from "@gwenjs/core";
import { getOrCreateCameraManager, getOrCreateScreenService } from "@gwenjs/renderer-core";
import { createOrthoBoundsProvider } from "../../src/camera-core-plugin.js";
import type { CameraState } from "@gwenjs/renderer-core";

async function makeEngine() {
  const engine = await createEngine({ maxEntities: 100 });
  const cameras = getOrCreateCameraManager(engine);
  const svc = getOrCreateScreenService(engine);
  svc.registerBoundsProvider(createOrthoBoundsProvider(cameras));
  return { engine, cameras, svc };
}

function makeCamState(x: number, y: number, zoom: number, active = true): CameraState {
  return {
    worldTransform: { position: { x, y, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
    projection: { type: "orthographic", zoom, near: -1, far: 1 },
    viewportId: "main",
    active,
    priority: 0,
  };
}

describe("ortho bounds provider (via camera-core)", () => {
  it("ScreenService has a bounds provider after registration", async () => {
    const { svc } = await makeEngine();
    expect(svc.hasBoundsProvider()).toBe(true);
  });

  it("computes correct bounds for zoom=1, camera at origin", async () => {
    const { cameras, svc } = await makeEngine();
    cameras.set("main", makeCamState(0, 0, 1));

    const bounds = svc.computeBoundsFor("main", 800, 600);

    expect(bounds).toBeDefined();
    expect(bounds!.minX).toBeCloseTo(-400);
    expect(bounds!.maxX).toBeCloseTo(400);
    expect(bounds!.minY).toBeCloseTo(-300);
    expect(bounds!.maxY).toBeCloseTo(300);
  });

  it("computes correct bounds for zoom=2 (world units per pixel halved)", async () => {
    const { cameras, svc } = await makeEngine();
    cameras.set("main", makeCamState(0, 0, 2));

    const bounds = svc.computeBoundsFor("main", 800, 600);

    expect(bounds!.minX).toBeCloseTo(-200);
    expect(bounds!.maxX).toBeCloseTo(200);
    expect(bounds!.minY).toBeCloseTo(-150);
    expect(bounds!.maxY).toBeCloseTo(150);
  });

  it("computes correct bounds for camera offset from origin", async () => {
    const { cameras, svc } = await makeEngine();
    cameras.set("main", makeCamState(100, 50, 1));

    const bounds = svc.computeBoundsFor("main", 800, 600);

    expect(bounds!.minX).toBeCloseTo(-300);
    expect(bounds!.maxX).toBeCloseTo(500);
    expect(bounds!.minY).toBeCloseTo(-250);
    expect(bounds!.maxY).toBeCloseTo(350);
  });

  it("returns undefined when no camera is registered for viewport", async () => {
    const { svc } = await makeEngine();
    const bounds = svc.computeBoundsFor("main", 800, 600);
    expect(bounds).toBeUndefined();
  });

  it("returns undefined when camera is inactive", async () => {
    const { cameras, svc } = await makeEngine();
    cameras.set("main", makeCamState(0, 0, 1, false));
    expect(svc.computeBoundsFor("main", 800, 600)).toBeUndefined();
  });

  it("returns undefined for perspective projection", async () => {
    const { cameras, svc } = await makeEngine();
    cameras.set("main", {
      worldTransform: { position: { x: 0, y: 0, z: 5 }, rotation: { x: 0, y: 0, z: 0 } },
      projection: { type: "perspective", fov: Math.PI / 3, near: 0.1, far: 1000 },
      viewportId: "main",
      active: true,
      priority: 0,
    });
    expect(svc.computeBoundsFor("main", 800, 600)).toBeUndefined();
  });
});
