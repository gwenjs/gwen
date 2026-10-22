import { afterEach, describe, expect, it } from "vitest";
import { createEngine } from "@gwenjs/core";
import type { GwenEngine } from "@gwenjs/core";
import { getCameraStores } from "../src/camera-stores.js";
import { CameraEmptyPathError } from "../src/errors.js";
import {
  clearCameraPath,
  getCameraPath,
  getCameraViewport,
  setCameraPath,
  setCameraViewport,
} from "../src/engine-verbs.js";
import * as root from "../src/index.js";
import type { CameraPathData } from "../src/types.js";

const engines: GwenEngine[] = [];

afterEach(async () => {
  while (engines.length > 0) {
    await engines.pop()?.stop();
  }
});

async function makeEngine(): Promise<GwenEngine> {
  const engine = await createEngine({ maxEntities: 100 });
  engines.push(engine);
  return engine;
}

function pathData(x: number): CameraPathData {
  return {
    waypoints: [
      { position: { x, y: 0, z: 0 }, duration: 1.5, easing: "easeInOut" },
      { position: { x, y: 300, z: 0 }, duration: 1.0 },
    ],
    opts: { loop: false },
    elapsed: 0,
  };
}

describe("engine verbs", () => {
  it("a path set on engine A is read back on A and absent on B", async () => {
    const engineA = await makeEngine();
    const engineB = await makeEngine();
    const idA = engineA.createEntity();
    const idB = engineB.createEntity();
    expect(idA).toBe(idB);
    const pathA = pathData(200);
    setCameraPath(engineA, idA, pathA);
    expect(getCameraPath(engineA, idA)).toBe(pathA);
    expect(getCameraPath(engineB, idB)).toBeUndefined();
  });

  it("a viewport binding is per engine", async () => {
    const engineA = await makeEngine();
    const engineB = await makeEngine();
    const idA = engineA.createEntity();
    const idB = engineB.createEntity();
    expect(idA).toBe(idB);
    setCameraViewport(engineA, idA, "minimap");
    setCameraViewport(engineB, idB, "main");
    expect(getCameraViewport(engineA, idA)).toBe("minimap");
    expect(getCameraViewport(engineB, idB)).toBe("main");
  });

  it("getCameraPath of a camera with no path returns undefined", async () => {
    const engine = await makeEngine();
    const id = engine.createEntity();
    expect(getCameraPath(engine, id)).toBeUndefined();
  });

  it("clearCameraPath on one camera leaves the other cameras' paths intact", async () => {
    const engine = await makeEngine();
    const first = engine.createEntity();
    const second = engine.createEntity();
    const pathFirst = pathData(200);
    const pathSecond = pathData(10);
    setCameraPath(engine, first, pathFirst);
    setCameraPath(engine, second, pathSecond);
    clearCameraPath(engine, first);
    expect(getCameraPath(engine, second)).toBe(pathSecond);
    expect(getCameraPath(engine, first)).toBeUndefined();
  });

  it("clearCameraPath removes the path of that camera, and clearing a camera with no path does not throw and changes nothing", async () => {
    const engine = await makeEngine();
    const cleared = engine.createEntity();
    const kept = engine.createEntity();
    const pathCleared = pathData(200);
    const pathKept = pathData(10);
    setCameraPath(engine, cleared, pathCleared);
    setCameraPath(engine, kept, pathKept);
    clearCameraPath(engine, cleared);
    expect(getCameraPath(engine, cleared)).toBeUndefined();
    clearCameraPath(engine, cleared);
    expect(getCameraPath(engine, kept)).toBe(pathKept);
  });

  it("setCameraPath with no waypoints throws CameraEmptyPathError and stores nothing", async () => {
    const engine = await makeEngine();
    const id = engine.createEntity();
    const empty: CameraPathData = {
      waypoints: [],
      opts: { loop: false },
      elapsed: 0,
    };
    let thrown: unknown;
    try {
      setCameraPath(engine, id, empty);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(CameraEmptyPathError);
    if (thrown instanceof CameraEmptyPathError) {
      expect(thrown.code).toBe("CAMERA:EMPTY_PATH");
      expect(thrown.message).toBe("[GwenCamera] playPath() requires at least one waypoint.");
    }
    expect(getCameraPath(engine, id)).toBeUndefined();

    const one: CameraPathData = {
      waypoints: [{ position: { x: 200, y: 0, z: 0 }, duration: 1.5, easing: "easeInOut" }],
      opts: { loop: false },
      elapsed: 0,
    };
    setCameraPath(engine, id, one);
    expect(getCameraPath(engine, id)).toBe(one);
  });

  it("getCameraViewport of an unbound camera returns undefined, and setCameraViewport overwrites a previous binding", async () => {
    const engine = await makeEngine();
    const id = engine.createEntity();
    expect(getCameraViewport(engine, id)).toBeUndefined();
    setCameraViewport(engine, id, "minimap");
    expect(getCameraViewport(engine, id)).toBe("minimap");
    setCameraViewport(engine, id, "main");
    expect(getCameraViewport(engine, id)).toBe("main");
  });

  it("the verbs read and write the stores CameraSystem reads", async () => {
    const engine = await makeEngine();
    const id = engine.createEntity();
    const path = pathData(200);
    setCameraViewport(engine, id, "minimap");
    setCameraPath(engine, id, path);
    expect(getCameraStores(engine).viewports.get(id)).toBe("minimap");
    expect(getCameraStores(engine).paths.get(id)).toBe(path);

    const other = engine.createEntity();
    const pathOther = pathData(10);
    getCameraStores(engine).viewports.set(other, "hud");
    getCameraStores(engine).paths.set(other, pathOther);
    expect(getCameraViewport(engine, other)).toBe("hud");
    expect(getCameraPath(engine, other)).toBe(pathOther);
  });

  it("clearCameraPath on engine A leaves engine B's path for the same camera id intact", async () => {
    const engineA = await makeEngine();
    const engineB = await makeEngine();
    const idA = engineA.createEntity();
    const idB = engineB.createEntity();
    expect(idA).toBe(idB);
    const pathA = pathData(200);
    const pathB = pathData(10);
    setCameraPath(engineA, idA, pathA);
    setCameraPath(engineB, idB, pathB);
    clearCameraPath(engineA, idA);
    expect(getCameraPath(engineA, idA)).toBeUndefined();
    expect(getCameraPath(engineB, idB)).toBe(pathB);
  });

  it("a second setCameraPath on the same camera replaces the first path", async () => {
    const engine = await makeEngine();
    const id = engine.createEntity();
    const first = pathData(200);
    const second = pathData(10);
    setCameraPath(engine, id, first);
    setCameraPath(engine, id, second);
    expect(getCameraPath(engine, id)).toBe(second);
  });

  it("the five verbs are exported from the camera-core root as functions and no store is", () => {
    expect(typeof root.setCameraViewport).toBe("function");
    expect(typeof root.getCameraViewport).toBe("function");
    expect(typeof root.setCameraPath).toBe("function");
    expect(typeof root.getCameraPath).toBe("function");
    expect(typeof root.clearCameraPath).toBe("function");
    for (const value of Object.values(root)) {
      expect(value instanceof Map || value instanceof Set).toBe(false);
    }
  });
});
