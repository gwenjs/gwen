// packages/renderer-core/tests/screen-to-world.test.ts
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../src/use-camera-manager.js");
vi.mock("../src/use-screen.js");

import { useCameraManager } from "../src/use-camera-manager.js";
import { useScreen } from "../src/use-screen.js";
import { screenToWorld } from "../src/screen-to-world.js";
import { UnavailableCameraError, ScreenToWorldPerspectiveError } from "../src/errors.js";
import type { CameraState } from "../src/camera-types.js";
import type { ViewportScreenInfo } from "../src/screen-service.js";

const mockUseCameraManager = vi.mocked(useCameraManager);
const mockUseScreen = vi.mocked(useScreen);

function makeOrthoCamera(opts: {
  x?: number;
  y?: number;
  z?: number;
  zoom?: number;
  viewportId?: string;
  active?: boolean;
  priority?: number;
}): CameraState {
  return {
    worldTransform: {
      position: { x: opts.x ?? 0, y: opts.y ?? 0, z: opts.z ?? 0 },
      rotation: { x: 0, y: 0, z: 0 },
    },
    projection: { type: "orthographic", zoom: opts.zoom ?? 1, near: -1, far: 1 },
    viewportId: opts.viewportId ?? "main",
    active: opts.active ?? true,
    priority: opts.priority ?? 0,
  };
}

function setupCamera(state: CameraState, pixels = { width: 800, height: 600 }): void {
  const states = new Map([[state.viewportId, state]]);
  mockUseCameraManager.mockReturnValue({
    get: (id: string) => states.get(id),
    getAll: () => states,
    set: vi.fn(),
    clearFrame: vi.fn(),
  });
  mockUseScreen.mockReturnValue({
    pixels,
    dpr: 1,
    bounds: undefined,
  } as ViewportScreenInfo);
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("screenToWorld — orthographic formula", () => {
  it("center pixel maps to the camera world position", () => {
    setupCamera(makeOrthoCamera({ x: 0, y: 0 }));
    const result = screenToWorld(400, 300);
    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
  });

  it("center pixel maps to an offset camera position", () => {
    setupCamera(makeOrthoCamera({ x: 100, y: 200 }));
    const result = screenToWorld(400, 300);
    expect(result.x).toBe(100);
    expect(result.y).toBe(200);
  });

  it("top-left pixel (0, 0) returns the negative half-viewport offset", () => {
    setupCamera(makeOrthoCamera({ x: 0, y: 0 }));
    const result = screenToWorld(0, 0);
    expect(result.x).toBe(-400);
    expect(result.y).toBe(-300);
  });

  it("bottom-right pixel returns the positive half-viewport offset", () => {
    setupCamera(makeOrthoCamera({ x: 0, y: 0 }));
    const result = screenToWorld(800, 600);
    expect(result.x).toBe(400);
    expect(result.y).toBe(300);
  });

  it("offset camera + non-center pixel combines both contributions", () => {
    setupCamera(makeOrthoCamera({ x: 100, y: 200 }));
    // offset from center: (0-400)=-400, (0-300)=-300 → world: (100-400, 200-300) = (-300, -100)
    const result = screenToWorld(0, 0);
    expect(result.x).toBe(-300);
    expect(result.y).toBe(-100);
  });

  it("viewport dimensions affect the result", () => {
    setupCamera(makeOrthoCamera({ x: 0, y: 0 }), { width: 400, height: 300 });
    // top-left with 400×300 viewport: half = (-200, -150)
    const result = screenToWorld(0, 0);
    expect(result.x).toBe(-200);
    expect(result.y).toBe(-150);
  });

  it("zoom 2 (zoom in) halves the world offset", () => {
    setupCamera(makeOrthoCamera({ x: 0, y: 0, zoom: 2 }));
    // offset from center: (600-400)=200 / 2 = 100 ; (450-300)=150 / 2 = 75
    const result = screenToWorld(600, 450);
    expect(result.x).toBe(100);
    expect(result.y).toBe(75);
  });

  it("zoom 0.5 (zoom out) doubles the world offset", () => {
    setupCamera(makeOrthoCamera({ x: 0, y: 0, zoom: 0.5 }));
    // offset from center: (600-400)=200 / 0.5 = 400 ; (450-300)=150 / 0.5 = 300
    const result = screenToWorld(600, 450);
    expect(result.x).toBe(400);
    expect(result.y).toBe(300);
  });

  it("z equals the camera world z", () => {
    setupCamera(makeOrthoCamera({ z: 5 }));
    const result = screenToWorld(400, 300);
    expect(result.z).toBe(5);
  });
});

describe("screenToWorld — camera resolution (auto-detect)", () => {
  it("picks the single active camera", () => {
    setupCamera(makeOrthoCamera({ x: 42, y: 0 }));
    expect(screenToWorld(400, 300).x).toBe(42);
  });

  it("ignores inactive cameras", () => {
    const active = makeOrthoCamera({ x: 10, viewportId: "a", active: true });
    const inactive = makeOrthoCamera({ x: 99, viewportId: "b", active: false });
    const states = new Map([
      ["a", active],
      ["b", inactive],
    ]);
    mockUseCameraManager.mockReturnValue({
      get: (id: string) => states.get(id),
      getAll: () => states,
      set: vi.fn(),
      clearFrame: vi.fn(),
    });
    mockUseScreen.mockReturnValue({
      pixels: { width: 800, height: 600 },
      dpr: 1,
      bounds: undefined,
    } as ViewportScreenInfo);
    expect(screenToWorld(400, 300).x).toBe(10);
  });

  it("picks the highest priority camera when multiple are active", () => {
    const low = makeOrthoCamera({ x: 1, viewportId: "low", priority: 0 });
    const high = makeOrthoCamera({ x: 99, viewportId: "high", priority: 10 });
    const states = new Map([
      ["low", low],
      ["high", high],
    ]);
    mockUseCameraManager.mockReturnValue({
      get: (id: string) => states.get(id),
      getAll: () => states,
      set: vi.fn(),
      clearFrame: vi.fn(),
    });
    mockUseScreen.mockReturnValue({
      pixels: { width: 800, height: 600 },
      dpr: 1,
      bounds: undefined,
    } as ViewportScreenInfo);
    expect(screenToWorld(400, 300).x).toBe(99);
  });
});

describe("screenToWorld — camera resolution (explicit viewportId)", () => {
  it("uses an inactive camera when its viewportId is explicitly provided", () => {
    const inactive = makeOrthoCamera({ x: 77, viewportId: "main", active: false });
    setupCamera(inactive);
    // explicit viewportId bypasses the active check — documents the intentional behaviour
    expect(screenToWorld(400, 300, "main").x).toBe(77);
  });

  it("uses the specified viewport camera", () => {
    const main = makeOrthoCamera({ x: 0, viewportId: "main" });
    const hud = makeOrthoCamera({ x: 500, viewportId: "hud" });
    const states = new Map([
      ["main", main],
      ["hud", hud],
    ]);
    mockUseCameraManager.mockReturnValue({
      get: (id: string) => states.get(id),
      getAll: () => states,
      set: vi.fn(),
      clearFrame: vi.fn(),
    });
    mockUseScreen.mockReturnValue({
      pixels: { width: 800, height: 600 },
      dpr: 1,
      bounds: undefined,
    } as ViewportScreenInfo);
    expect(screenToWorld(400, 300, "hud").x).toBe(500);
  });
});

describe("screenToWorld — errors", () => {
  it("throws UnavailableCameraError when no active camera exists", () => {
    mockUseCameraManager.mockReturnValue({
      get: () => undefined,
      getAll: () => new Map(),
      set: vi.fn(),
      clearFrame: vi.fn(),
    });
    expect(() => screenToWorld(400, 300)).toThrow(UnavailableCameraError);
  });

  it("throws UnavailableCameraError when the explicit viewportId is not found", () => {
    mockUseCameraManager.mockReturnValue({
      get: () => undefined,
      getAll: () => new Map(),
      set: vi.fn(),
      clearFrame: vi.fn(),
    });
    expect(() => screenToWorld(400, 300, "missing")).toThrow(UnavailableCameraError);
  });

  it("throws ScreenToWorldPerspectiveError for a perspective camera", () => {
    const perspectiveState: CameraState = {
      worldTransform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
      projection: { type: "perspective", fov: Math.PI / 3, near: 0.1, far: 1000 },
      viewportId: "main",
      active: true,
      priority: 0,
    };
    const states = new Map([["main", perspectiveState]]);
    mockUseCameraManager.mockReturnValue({
      get: (id: string) => states.get(id),
      getAll: () => states,
      set: vi.fn(),
      clearFrame: vi.fn(),
    });
    expect(() => screenToWorld(400, 300)).toThrow(ScreenToWorldPerspectiveError);
  });

  it("ScreenToWorldPerspectiveError exposes the projection type", () => {
    expect.assertions(2);
    const perspectiveState: CameraState = {
      worldTransform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
      projection: { type: "perspective", fov: Math.PI / 3, near: 0.1, far: 1000 },
      viewportId: "main",
      active: true,
      priority: 0,
    };
    const states = new Map([["main", perspectiveState]]);
    mockUseCameraManager.mockReturnValue({
      get: (id: string) => states.get(id),
      getAll: () => states,
      set: vi.fn(),
      clearFrame: vi.fn(),
    });
    try {
      screenToWorld(400, 300);
    } catch (err) {
      expect(err).toBeInstanceOf(ScreenToWorldPerspectiveError);
      expect((err as ScreenToWorldPerspectiveError).projectionType).toBe("perspective");
    }
  });
});
