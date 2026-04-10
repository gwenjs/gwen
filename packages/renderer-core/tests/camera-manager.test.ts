// packages/renderer-core/tests/camera-manager.test.ts
import { describe, it, expect } from "vitest";
import { CameraManagerImpl } from "../src/camera-manager.js";
import type { CameraState } from "../src/camera-types.js";

function makeState(viewportId: string, priority = 0): CameraState {
  return {
    worldTransform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
    },
    projection: { type: "orthographic", zoom: 1, near: -1, far: 1 },
    viewportId,
    active: true,
    priority,
  };
}

describe("CameraManagerImpl", () => {
  it("get() returns undefined for unknown viewport", () => {
    const mgr = new CameraManagerImpl();
    expect(mgr.get("main")).toBeUndefined();
  });

  it("set() + get() round-trips a CameraState", () => {
    const mgr = new CameraManagerImpl();
    const state = makeState("main");
    mgr.set("main", state);
    expect(mgr.get("main")).toBe(state);
  });

  it("set() overwrites when same priority (last write wins)", () => {
    const mgr = new CameraManagerImpl();
    const first = makeState("main", 0);
    const second = makeState("main", 0);
    mgr.set("main", first);
    mgr.set("main", second);
    expect(mgr.get("main")).toBe(second);
  });

  it("set() is ignored when incoming priority is lower than existing", () => {
    const mgr = new CameraManagerImpl();
    const high = makeState("main", 10);
    const low = makeState("main", 5);
    mgr.set("main", high);
    mgr.set("main", low);
    expect(mgr.get("main")).toBe(high);
  });

  it("set() overwrites when incoming priority is higher than existing", () => {
    const mgr = new CameraManagerImpl();
    const low = makeState("main", 5);
    const high = makeState("main", 10);
    mgr.set("main", low);
    mgr.set("main", high);
    expect(mgr.get("main")).toBe(high);
  });

  it("getAll() returns all stored states", () => {
    const mgr = new CameraManagerImpl();
    mgr.set("main", makeState("main"));
    mgr.set("minimap", makeState("minimap"));
    const all = mgr.getAll();
    expect(all.size).toBe(2);
    expect(all.has("main")).toBe(true);
    expect(all.has("minimap")).toBe(true);
  });

  it("clearFrame() removes all states", () => {
    const mgr = new CameraManagerImpl();
    mgr.set("main", makeState("main"));
    mgr.clearFrame();
    expect(mgr.get("main")).toBeUndefined();
    expect(mgr.getAll().size).toBe(0);
  });
});
