// packages/camera-core/tests/camera-provider-phase.test.ts
import { afterEach, describe, expect, it } from "vitest";
import { createEngine } from "@gwenjs/core/node";
import type { GwenEngine } from "@gwenjs/core";
import { GwenError } from "@gwenjs/schema";
import { RenderHostPlugin } from "@gwenjs/renderer-core";
import * as testing from "@gwenjs/renderer-core/testing";
import { Camera, CameraCorePlugin, FollowTarget, setCameraViewport } from "../src/index.js";

const openEngines: GwenEngine[] = [];

afterEach(async () => {
  while (openEngines.length > 0) await openEngines.pop()?.stop();
});

type CameraProviderRun = (
  engine: GwenEngine,
  options: { readonly viewportId: string; readonly dt?: number },
) => Promise<void>;

function providerSuite(): CameraProviderRun {
  const suite: unknown = Reflect.get(testing, "runCameraProviderConformance");
  expect(typeof suite).toBe("function");
  if (typeof suite !== "function") {
    throw new Error("runCameraProviderConformance is not a function");
  }
  return async (engine, options) => {
    const result: unknown = Reflect.apply(suite, undefined, [engine, options]);
    if (!(result instanceof Promise)) {
      throw new Error("runCameraProviderConformance did not return a promise");
    }
    await result;
  };
}

async function rejectionOf(run: () => Promise<void>): Promise<GwenError> {
  let caught: unknown;
  try {
    await run();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(GwenError);
  if (!(caught instanceof GwenError)) throw new Error("expected GwenError");
  return caught;
}

function cameraAt(x: number, y: number) {
  return {
    active: 1,
    priority: 0,
    projectionType: 0,
    x,
    y,
    z: 0,
    rotX: 0,
    rotY: 0,
    rotZ: 0,
    zoom: 1,
    fov: 1,
    near: -1,
    far: 1,
  };
}

async function openEngine(): Promise<GwenEngine> {
  const engine = await createEngine({ maxEntities: 100 });
  openEngines.push(engine);
  await engine.use(RenderHostPlugin());
  await engine.use(CameraCorePlugin());
  return engine;
}

describe("camera provider phase contract", () => {
  it("CameraCorePlugin's follow camera passes the camera provider conformance run", async () => {
    const run = providerSuite();
    const engine = await openEngine();
    const targetId = engine.createEntity();
    engine.addComponent(targetId, Camera, cameraAt(100, 200));
    const camId = engine.createEntity();
    engine.addComponent(camId, Camera, cameraAt(0, 0));
    engine.addComponent(camId, FollowTarget, {
      entityId: targetId,
      lerp: 1,
      offsetX: 0,
      offsetY: 0,
      offsetZ: 0,
    });
    setCameraViewport(engine, camId, "main");
    await run(engine, { viewportId: "main" });
    const state = engine.inject("cameraManager").get("main");
    expect(state?.worldTransform.position.x).toBeCloseTo(100);
    expect(state?.worldTransform.position.y).toBeCloseTo(200);
  });

  it("a camera bound to no viewport fails the conformance run naming the viewport", async () => {
    const run = providerSuite();
    const engine = await openEngine();
    const camId = engine.createEntity();
    engine.addComponent(camId, Camera, cameraAt(0, 0));
    const error = await rejectionOf(() => run(engine, { viewportId: "main" }));
    expect(error.code).toBe("RENDERER:CONFORMANCE_FAILED");
    expect(error.message).toContain('"main"');
    expect(error.message).not.toContain("wrote it later");
  });
});
