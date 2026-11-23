import { describe, expect, it } from "vitest";
import { GwenError } from "@gwenjs/schema";
import { createEngine } from "@gwenjs/core/node";
import type { GwenEngine } from "../../src/engine/engine-types.js";
import { createRealEngine, type RealEngineHandle } from "./harness.js";

describe("createEngine bridge variant", () => {
  it("createEngine rejects a light bridge with variant physics2d", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 8 });
    let opened: GwenEngine | undefined;
    let caught: unknown;

    try {
      try {
        opened = await createEngine({
          variant: "physics2d",
          maxEntities: 8,
          _bridge: handle.bridge,
        });
      } catch (err: unknown) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(GwenError);
      if (!(caught instanceof GwenError)) return;
      expect(caught.code).toBe("CORE:WASM_VARIANT_MISMATCH");
      expect(caught.composable).toBe("createEngine");
      expect(caught.message.split("\n")[0]).toBe(
        '[createEngine()] The bridge is "light" but the engine config declares "physics2d".',
      );
      if (__GWEN_DEV__) {
        expect(caught.message).toContain("Fix: ");
      } else {
        expect(caught.message).not.toContain("Fix: ");
      }
    } finally {
      if (opened !== undefined) await opened.stop();
      await handle.dispose();
    }
  });

  it("createEngine rejects a physics2d bridge with variant light and accepts each bridge with its own variant or none", async () => {
    const light = await createRealEngine({ variant: "light", maxEntities: 8 });
    let physics: RealEngineHandle | undefined;
    const opened: GwenEngine[] = [];

    try {
      physics = await createRealEngine({ variant: "physics2d", maxEntities: 8 });

      const physicsBridgeOnLight = await openOrCode({
        variant: "light",
        maxEntities: 8,
        _bridge: physics.bridge,
      });
      if (physicsBridgeOnLight.engine !== undefined) opened.push(physicsBridgeOnLight.engine);
      expect(physicsBridgeOnLight.code).toBe("CORE:WASM_VARIANT_MISMATCH");

      const lightBridgeOnPhysics = await openOrCode({
        variant: "physics2d",
        maxEntities: 8,
        _bridge: light.bridge,
      });
      if (lightBridgeOnPhysics.engine !== undefined) opened.push(lightBridgeOnPhysics.engine);
      expect(lightBridgeOnPhysics.code).toBe("CORE:WASM_VARIANT_MISMATCH");

      const matchedLight = await createEngine({
        variant: "light",
        maxEntities: 8,
        _bridge: light.bridge,
      });
      opened.push(matchedLight);
      const matchedPhysics = await createEngine({
        variant: "physics2d",
        maxEntities: 8,
        _bridge: physics.bridge,
      });
      opened.push(matchedPhysics);
      const omittedLight = await createEngine({ maxEntities: 8, _bridge: light.bridge });
      opened.push(omittedLight);
      const omittedPhysics = await createEngine({ maxEntities: 8, _bridge: physics.bridge });
      opened.push(omittedPhysics);
    } finally {
      for (const engine of opened) await engine.stop();
      await light.dispose();
      if (physics !== undefined) await physics.dispose();
    }
  });
});

async function openOrCode(options: {
  variant?: "light" | "physics2d";
  maxEntities: number;
  _bridge: RealEngineHandle["bridge"];
}): Promise<{ code: string | undefined; engine: GwenEngine | undefined }> {
  try {
    return { code: undefined, engine: await createEngine(options) };
  } catch (err: unknown) {
    if (!(err instanceof GwenError)) throw err;
    return { code: err.code, engine: undefined };
  }
}
