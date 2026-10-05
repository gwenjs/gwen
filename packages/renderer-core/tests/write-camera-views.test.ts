import { describe, it, expect, vi } from "vitest";
import type { GwenEngine, GwenLogger } from "@gwenjs/core";
import { getOrCreateCameraManager } from "../src/get-or-create-camera-manager.js";
import { getOrCreateScreenService } from "../src/get-or-create-screen-service.js";
import { getOrCreateViewportManager } from "../src/get-or-create-viewport-manager.js";
import { writeCameraViews } from "../src/write-camera-views.js";
import type { CameraState } from "../src/camera-types.js";
import type { RenderView } from "../src/types.js";
import { RENDERER_CONTRACT_VERSION } from "../src/types.js";

function makeEngine(): GwenEngine {
  const services = new Map<string, unknown>();
  const childLogger: GwenLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
    setSink: vi.fn(),
  };
  const logger: GwenLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnValue(childLogger),
    setSink: vi.fn(),
  };
  return {
    logger,
    provide: vi.fn((key: string, value: unknown) => {
      services.set(key, value);
    }),
    tryInject: vi.fn((key: string) => services.get(key)),
    hooks: { hook: vi.fn(), callHook: vi.fn() },
  } as unknown as GwenEngine;
}

function makeSlot(): RenderView {
  return {
    viewportId: "",
    eye: "left",
    viewMatrix: new Float32Array(16),
    projectionMatrix: new Float32Array(16),
    pixelRect: { x: -1, y: -1, width: -1, height: -1 },
  };
}

function camera(partial: Partial<CameraState> & Pick<CameraState, "projection">): CameraState {
  return {
    worldTransform: partial.worldTransform ?? {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
    },
    projection: partial.projection,
    viewportId: partial.viewportId ?? "main",
    active: partial.active ?? true,
    priority: partial.priority ?? 0,
  };
}

describe("writeCameraViews", () => {
  it("returns 0 when camera services are missing", () => {
    expect(writeCameraViews(makeEngine(), [makeSlot()])).toBe(0);
  });

  it("renders one perspective camera view into the caller buffer", () => {
    const engine = makeEngine();
    const viewports = getOrCreateViewportManager(engine);
    const cameras = getOrCreateCameraManager(engine);
    const screen = getOrCreateScreenService(engine);
    viewports.set("main", { x: 0, y: 0, width: 1, height: 1 });
    screen.setContainerSize(200, 100, 1);
    cameras.set(
      "main",
      camera({
        viewportId: "main",
        worldTransform: {
          position: { x: 4, y: 5, z: 6 },
          rotation: { x: 0, y: 0, z: 0 },
        },
        projection: { type: "perspective", fov: Math.PI / 2, near: 1, far: 3 },
      }),
    );

    const slot = makeSlot();
    const viewMatrix = slot.viewMatrix;
    const projectionMatrix = slot.projectionMatrix;
    const pixelRect = slot.pixelRect;
    const out = [slot];

    expect(writeCameraViews(engine, out)).toBe(1);
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(slot);
    expect(slot.viewMatrix).toBe(viewMatrix);
    expect(slot.projectionMatrix).toBe(projectionMatrix);
    expect(slot.pixelRect).toBe(pixelRect);
    expect(slot.viewportId).toBe("main");
    expect(slot.eye).toBe("none");
    expect(slot.pixelRect).toEqual({ x: 0, y: 0, width: 200, height: 100 });
    expect(Array.from(slot.viewMatrix)).toEqual([
      1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -4, -5, -6, 1,
    ]);
    expect(Array.from(slot.projectionMatrix)).toEqual([
      0.5, 0, 0, 0, 0, 1, 0, 0, 0, 0, -2, -1, 0, 0, -3, 0,
    ]);
    expect(RENDERER_CONTRACT_VERSION).toBe(2);

    writeCameraViews(engine, out);
    expect(slot.viewMatrix).toBe(viewMatrix);
    expect(out).toHaveLength(1);
  });

  it("writes a YXZ yaw of half pi into a column-major view matrix", () => {
    const engine = makeEngine();
    getOrCreateViewportManager(engine).set("main", { x: 0, y: 0, width: 1, height: 1 });
    getOrCreateScreenService(engine).setContainerSize(10, 10, 1);
    getOrCreateCameraManager(engine).set(
      "main",
      camera({
        projection: { type: "orthographic", zoom: 1, near: -1, far: 1 },
        worldTransform: {
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: Math.PI / 2, z: 0 },
        },
      }),
    );
    const slot = makeSlot();
    writeCameraViews(engine, [slot]);
    const v = Array.from(slot.viewMatrix).map((n) => Math.round(n * 1e6) / 1e6);
    expect(v).toEqual([0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 0, 1]);
  });

  it("writes an orthographic projection from pixels and zoom", () => {
    const engine = makeEngine();
    getOrCreateViewportManager(engine).set("main", { x: 0, y: 0, width: 1, height: 1 });
    getOrCreateScreenService(engine).setContainerSize(100, 50, 2);
    getOrCreateCameraManager(engine).set(
      "main",
      camera({
        projection: { type: "orthographic", zoom: 1, near: -1, far: 1 },
      }),
    );
    const slot = makeSlot();
    writeCameraViews(engine, [slot]);
    expect(slot.pixelRect).toEqual({ x: 0, y: 0, width: 200, height: 100 });
    const p = Array.from(slot.projectionMatrix);
    expect(p[0]).toBeCloseTo(0.02);
    expect(p[5]).toBeCloseTo(0.04);
    expect(p[10]).toBeCloseTo(-1);
    expect(p[15]).toBe(1);
  });

  it("places a right-half viewport in device pixels", () => {
    const engine = makeEngine();
    getOrCreateViewportManager(engine).set("right", { x: 0.5, y: 0, width: 0.5, height: 1 });
    getOrCreateScreenService(engine).setContainerSize(200, 100, 2);
    getOrCreateCameraManager(engine).set(
      "right",
      camera({
        viewportId: "right",
        projection: { type: "orthographic", zoom: 1, near: -1, far: 1 },
      }),
    );
    const slot = makeSlot();
    expect(writeCameraViews(engine, [slot])).toBe(1);
    expect(slot.viewportId).toBe("right");
    expect(slot.pixelRect).toEqual({ x: 200, y: 0, width: 200, height: 200 });
  });

  it("skips inactive cameras and does not grow a short buffer", () => {
    const engine = makeEngine();
    const viewports = getOrCreateViewportManager(engine);
    viewports.set("main", { x: 0, y: 0, width: 1, height: 1 });
    viewports.set("off", { x: 0, y: 0, width: 1, height: 1 });
    getOrCreateScreenService(engine).setContainerSize(10, 10, 1);
    const cameras = getOrCreateCameraManager(engine);
    cameras.set(
      "main",
      camera({ projection: { type: "orthographic", zoom: 1, near: -1, far: 1 } }),
    );
    cameras.set(
      "off",
      camera({
        viewportId: "off",
        active: false,
        projection: { type: "orthographic", zoom: 1, near: -1, far: 1 },
      }),
    );
    const out: RenderView[] = [];
    expect(writeCameraViews(engine, out)).toBe(1);
    expect(out).toHaveLength(0);
  });

  it("counts a short matrix without writing the slot", () => {
    const engine = makeEngine();
    getOrCreateViewportManager(engine).set("main", { x: 0, y: 0, width: 1, height: 1 });
    getOrCreateScreenService(engine).setContainerSize(10, 10, 1);
    getOrCreateCameraManager(engine).set(
      "main",
      camera({ projection: { type: "orthographic", zoom: 1, near: -1, far: 1 } }),
    );
    const short = new Float32Array(4);
    const before = Array.from(short);
    const slot: RenderView = {
      viewportId: "",
      eye: "left",
      viewMatrix: short,
      projectionMatrix: new Float32Array(16),
      pixelRect: { x: -1, y: -1, width: -1, height: -1 },
    };
    expect(writeCameraViews(engine, [slot])).toBe(1);
    expect(Array.from(slot.viewMatrix)).toEqual(before);
    expect(slot.viewportId).toBe("");
  });
});
