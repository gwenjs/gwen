/**
 * Official physics plugins on a real engine: option issues, duplicate
 * provides, and removal of the physics2d key.
 */
import { describe, expect, it } from "vitest";
import {
  defineComponent,
  GwenPluginDependencyError,
  GwenPluginOptionsError,
  GwenPluginProvideError,
  Types,
} from "../../src/index.js";
import { createRealEngine, type RealEngineHandle } from "./harness.js";
import "../../../physics2d/src/augment";
import { Physics2DPlugin } from "../../../physics2d/src/plugin/index";
import { createPhysicsKinematicSyncSystem } from "../../../physics2d/src/systems";

const Position2D = defineComponent({
  name: "plugin-provides-position-2d",
  schema: { x: Types.f32, y: Types.f32 },
});

async function withPhysics2D(body: (handle: RealEngineHandle) => Promise<void>): Promise<void> {
  const handle = await createRealEngine({ variant: "physics2d", maxEntities: 32 });
  try {
    await body(handle);
  } finally {
    await handle.dispose();
  }
}

function tooManyLayers(): Record<string, number> {
  const layers: Record<string, number> = {};
  for (let i = 0; i < 33; i += 1) layers[`l${i}`] = i % 32;
  return layers;
}

describe("official physics plugin provides", () => {
  it("physics2d with an invalid layer bit rejects CORE:PLUGIN_OPTIONS_INVALID and provides nothing", async () => {
    await withPhysics2D(async (handle) => {
      let caught: unknown;
      try {
        await handle.engine.use(Physics2DPlugin({ layers: { enemy: 99 } }));
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(GwenPluginOptionsError);
      if (!(caught instanceof GwenPluginOptionsError)) return;
      expect(caught.code).toBe("CORE:PLUGIN_OPTIONS_INVALID");
      expect(caught.issues[0]?.path).toBe("layers.enemy");
      expect(handle.engine.tryInject("physics2d")).toBeUndefined();
    });
  });

  it("physics2d with more than 32 layers rejects CORE:PLUGIN_OPTIONS_INVALID", async () => {
    await withPhysics2D(async (handle) => {
      let caught: unknown;
      try {
        await handle.engine.use(Physics2DPlugin({ layers: tooManyLayers() }));
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(GwenPluginOptionsError);
      if (!(caught instanceof GwenPluginOptionsError)) return;
      expect(caught.code).toBe("CORE:PLUGIN_OPTIONS_INVALID");
      expect(caught.issues[0]?.path).toBe("layers");
      expect(handle.engine.tryInject("physics2d")).toBeUndefined();
    });
  });

  it("two physics2d instances with different names reject CORE:PLUGIN_PROVIDE_DUPLICATE", async () => {
    await withPhysics2D(async (handle) => {
      await handle.engine.use(Physics2DPlugin());
      let caught: unknown;
      try {
        await handle.engine.use({ name: "other", provides: ["physics2d"], setup() {} });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(GwenPluginProvideError);
      if (!(caught instanceof GwenPluginProvideError)) return;
      expect(caught.code).toBe("CORE:PLUGIN_PROVIDE_DUPLICATE");
      expect(caught.keys).toEqual(["physics2d"]);
      expect(caught.owner).toBe("@gwenjs/physics2d");
      expect(handle.engine.tryInject("physics2d")).toBeDefined();
    });
  });

  it("unuse(physics2d) removes the key, then the sync system rejects with a dependency error", async () => {
    await withPhysics2D(async (handle) => {
      await handle.engine.use(Physics2DPlugin());
      await handle.engine.unuse("@gwenjs/physics2d");
      expect(handle.engine.tryInject("physics2d")).toBeUndefined();
      let caught: unknown;
      try {
        await handle.engine.use(
          createPhysicsKinematicSyncSystem({ positionComponent: Position2D }),
        );
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(GwenPluginDependencyError);
      if (!(caught instanceof GwenPluginDependencyError)) return;
      expect(caught.code).toBe("CORE:PLUGIN_DEPENDENCY_MISSING");
      expect(caught.missing).toEqual([{ kind: "service", name: "physics2d" }]);
    });
  });
});
