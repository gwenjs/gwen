import { afterEach, describe, expect, it } from "vitest";
import type { GwenEngine } from "../../src/engine/engine-types.js";
import { sceneHandles } from "../../src/hmr/scene-handles.js";
import { registerSceneHandles } from "../../src/internal.js";
import { createEngine } from "../../src/node.js";
import { defineScene } from "../../src/scene/runtime/define-scene.js";
import { useSystem } from "../../src/scene/runtime/scene-context.js";
import { defineSystem } from "../../src/system/runtime/define-system.js";

const REGISTRY = { register: () => {} };
const engines: GwenEngine[] = [];

afterEach(async () => {
  for (const engine of engines.splice(0)) await engine.stop();
});

describe.runIf(!__GWEN_DEV__)("sceneHandles in production", () => {
  it("registerSceneHandles leaves the registry of every engine empty", async () => {
    const left = await createEngine();
    const right = await createEngine();
    engines.push(left, right);
    const leftDef = left.run(() =>
      defineScene("Room", () => {
        useSystem(defineSystem("P783HandleLeft", () => {})());
      })(REGISTRY),
    );
    const rightDef = right.run(() =>
      defineScene("Room", () => {
        useSystem(defineSystem("P783HandleRight", () => {})());
      })(REGISTRY),
    );

    registerSceneHandles(left, leftDef.name, leftDef.handles);
    registerSceneHandles(right, rightDef.name, rightDef.handles);

    expect(sceneHandles.get(left).get("Room")).toBeUndefined();
    expect(sceneHandles.get(right).get("Room")).toBeUndefined();
  });
});
