import { describe, expect, it } from "vitest";

import { CoreErrorCodes, GwenContextError, useEngine } from "../../src/index.js";
import { engineContext } from "../../src/engine/context.js";
import { defineScene } from "../../src/scene/runtime/define-scene.js";
import { defineSceneRouter } from "../../src/router/defines/define-scene-router.js";
import { useSceneRouter } from "../../src/router/uses/use-scene-router.js";
import { GwenError } from "@gwenjs/schema";

describe("outside engine context", () => {
  it("uses one code for useEngine and useSceneRouter", () => {
    engineContext.unset();
    let fromEngine = "";
    try {
      useEngine();
    } catch (error) {
      fromEngine = error instanceof GwenContextError ? error.code : "";
    }

    const scene = defineScene("OutsideScene", () => {});
    const router = defineSceneRouter({
      initial: "only",
      routes: {
        only: { scene, on: {} },
      },
    });
    let fromRouter = "";
    try {
      useSceneRouter(router);
    } catch (error) {
      fromRouter = error instanceof GwenError ? error.code : "";
    }

    expect(fromEngine).toBe(fromRouter);
    expect(fromEngine).toBe(CoreErrorCodes.OUTSIDE_ENGINE_CONTEXT);
  });
});
