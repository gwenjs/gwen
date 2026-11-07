/**
 * Official plugins are kit plugins: each factory calls `definePlugin`,
 * each object installs on a real engine, and none carries a key the
 * engine does not know. Core built-in modules are exempt (#73).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GWEN_PLUGIN_KEYS, GwenError } from "@gwenjs/schema";
import { defineComponent, GwenPluginProvideError, Types } from "../../src/index.js";
import { createRealEngine, type RealEngineHandle } from "./harness.js";
import "../../../physics2d/src/augment";
import { Physics2DPlugin } from "../../../physics2d/src/plugin/index";
import { createPhysicsKinematicSyncSystem } from "../../../physics2d/src/systems";
import "../../../physics3d/src/augment";
import { Physics3DPlugin } from "../../../physics3d/src/plugin/index";
import { createPhysicsKinematicSyncSystem as createPhysics3DKinematicSyncSystem } from "../../../physics3d/src/systems";
import { CameraCorePlugin } from "../../../camera-core/src/camera-core-plugin";
import { ScreenPlugin } from "../../../renderer-core/src/screen-plugin";
import { StaticSizeProvider } from "../../../renderer-core/src/screen-size-providers";
import { createViewportsPlugin } from "../../../app/src/viewports-plugin";

/**
 * Core built-ins stay `satisfies GwenModule` (#73 Decisions).
 * This file checks official plugins and does not open these modules.
 */
export const CORE_MODULES_NOT_CHECKED = ["actor", "system", "scene", "tween", "router"] as const;

const FACTORIES: readonly { readonly repoPath: string; readonly factories: readonly string[] }[] = [
  { repoPath: "packages/app/src/viewports-plugin.ts", factories: ["createViewportsPlugin"] },
  { repoPath: "packages/renderer-core/src/screen-plugin.ts", factories: ["ScreenPlugin"] },
  {
    repoPath: "packages/camera-core/src/camera-core-plugin.ts",
    factories: ["CameraCorePlugin"],
  },
  { repoPath: "packages/physics2d/src/plugin/index.ts", factories: ["Physics2DPlugin"] },
  {
    repoPath: "packages/physics2d/src/systems.ts",
    factories: ["createPhysicsKinematicSyncSystem"],
  },
  { repoPath: "packages/physics3d/src/plugin/index.ts", factories: ["Physics3DPlugin"] },
  {
    repoPath: "packages/physics3d/src/systems.ts",
    factories: ["createPhysicsKinematicSyncSystem"],
  },
];

const Position2D = defineComponent({
  name: "plugin-shape-position-2d",
  schema: { x: Types.f32, y: Types.f32 },
});

const Position3D = defineComponent({
  name: "plugin-shape-position-3d",
  schema: { x: Types.f32, y: Types.f32, z: Types.f32 },
});

const FRAMES = 10;
const DT = 1 / 60;

/** Source text without block and line comments, so a JSDoc example cannot satisfy a check. */
function sourceText(repoPath: string): string {
  const raw = readFileSync(
    fileURLToPath(new URL(`../../../../${repoPath}`, import.meta.url)),
    "utf8",
  );
  return raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
}

function importsDefinePlugin(source: string): boolean {
  return /import\s*\{[\s\S]*?\bdefinePlugin\b[\s\S]*?\}\s*from\s*["']@gwenjs\/kit\/plugin["']/.test(
    source,
  );
}

/** `export const Name = definePlugin(`, or `export function Name` that returns `definePlugin(`. */
function factoryCallsDefinePlugin(source: string, name: string): boolean {
  if (new RegExp(`export\\s+const\\s+${name}\\s*=\\s*definePlugin\\s*\\(`).test(source)) {
    return true;
  }
  const start = new RegExp(`export\\s+function\\s+${name}\\b`).exec(source);
  if (start === null) return false;
  const after = source.slice(start.index);
  const next = /\nexport\s/.exec(after.slice(1));
  const body = next === null ? after : after.slice(0, next.index + 1);
  return /\breturn\s+definePlugin\s*\(/.test(body);
}

function strayKeys(plugin: object): string[] {
  const allowedKeys: readonly string[] = GWEN_PLUGIN_KEYS;
  return Object.keys(plugin).filter((key) => !allowedKeys.includes(key));
}

async function withEngine(
  variant: "light" | "physics2d" | "physics3d",
  body: (handle: RealEngineHandle) => Promise<void>,
): Promise<void> {
  const handle = await createRealEngine({ variant, maxEntities: 32 });
  try {
    await body(handle);
  } finally {
    await handle.dispose();
  }
}

describe("official plugin shape", () => {
  it("every official plugin factory is built with definePlugin", () => {
    const offending: string[] = [];
    for (const entry of FACTORIES) {
      const source = sourceText(entry.repoPath);
      const built =
        importsDefinePlugin(source) &&
        entry.factories.every((name) => factoryCallsDefinePlugin(source, name));
      if (!built) offending.push(entry.repoPath);
    }
    expect(offending).toEqual([]);
  });

  it("every official plugin installs on a real engine", async () => {
    await withEngine("physics2d", async (handle) => {
      await handle.engine.use(Physics2DPlugin({ gravity: { x: 0, y: 0 } }));
      await handle.engine.use(
        createPhysicsKinematicSyncSystem({ pixelsPerMeter: 1, positionComponent: Position2D }),
      );
      const physics = handle.engine.inject("physics2d");
      const id = handle.engine.createEntity();
      handle.engine.addComponent(id, Position2D, { x: 0, y: 0 });
      physics.addRigidBody(id, "kinematic", 0, 0);
      handle.engine.addComponent(id, Position2D, { x: 4, y: 0 });
      await handle.advance(FRAMES, DT);
      const position = physics.getPosition(id);
      expect(position?.x ?? 0).toBeGreaterThan(1);
    });

    await withEngine("physics3d", async (handle) => {
      await handle.engine.use(Physics3DPlugin({ gravity: { x: 0, y: 0, z: 0 } }));
      await handle.engine.use(
        createPhysics3DKinematicSyncSystem({ positionComponent: Position3D })(),
      );
      const physics = handle.engine.inject("physics3d");
      const id = handle.engine.createEntity();
      handle.engine.addComponent(id, Position3D, { x: 0, y: 0, z: 0 });
      physics.createBody(id, {
        kind: "kinematic",
        initialPosition: { x: 0, y: 0, z: 0 },
      });
      handle.engine.addComponent(id, Position3D, { x: 4, y: 0, z: 0 });
      await handle.advance(FRAMES, DT);
      const state = physics.getBodyState(id);
      expect(state?.position.x ?? 0).toBeGreaterThan(1);
    });

    await withEngine("light", async (handle) => {
      await handle.engine.use(createViewportsPlugin());
      await handle.engine.use(
        ScreenPlugin({ sizeProvider: StaticSizeProvider({ width: 800, height: 600 }) }),
      );
      await handle.engine.use(CameraCorePlugin());
      await handle.advance(1, DT);
      expect(handle.engine.inject("viewportManager").get("main")?.id).toBe("main");
      expect(handle.engine.inject("screenService").getOrCreateInfo("main").pixels.width).toBe(800);
      expect(handle.engine.inject("screenService").hasBoundsProvider()).toBe(true);
      expect(handle.engine.inject("cameraManager").getAll().size).toBe(0);
    });
  });

  it("a copy with onRender added is rejected with CORE:PLUGIN_INVALID_SHAPE", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 8 });
    try {
      const plugin = Physics2DPlugin({ gravity: { x: 0, y: 0 } });
      const copy = { ...plugin, onRender() {} };
      let caught: unknown;
      try {
        await handle.engine.use(copy);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(GwenError);
      expect(caught).toMatchObject({ code: "CORE:PLUGIN_INVALID_SHAPE" });
      expect(caught instanceof Error ? caught.message : "").toContain("onRender");
    } finally {
      await handle.dispose();
    }
  });

  it("no official plugin object has a key outside GWEN_PLUGIN_KEYS", () => {
    const plugins = [
      Physics2DPlugin({ gravity: { x: 0, y: 0 } }),
      createPhysicsKinematicSyncSystem({ positionComponent: Position2D }),
      Physics3DPlugin({ gravity: { x: 0, y: 0, z: 0 } }),
      createPhysics3DKinematicSyncSystem({ positionComponent: Position3D })(),
      CameraCorePlugin(),
      ScreenPlugin(),
      createViewportsPlugin(),
    ];
    for (const plugin of plugins) {
      expect(strayKeys(plugin), plugin.name).toEqual([]);
    }
  });
});

describe("official plugin provided keys", () => {
  async function installAll(handle: RealEngineHandle): Promise<void> {
    await handle.engine.use(createViewportsPlugin());
    await handle.engine.use(
      ScreenPlugin({ sizeProvider: StaticSizeProvider({ width: 800, height: 600 }) }),
    );
    await handle.engine.use(CameraCorePlugin());
  }

  async function rejectsDuplicate(
    handle: RealEngineHandle,
    key: "viewportManager" | "screenService" | "cameraManager",
    owner: string,
  ): Promise<void> {
    let caught: unknown;
    try {
      await handle.engine.use({ name: "second", provides: [key], setup() {} });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(GwenPluginProvideError);
    expect(caught).toMatchObject({ code: "CORE:PLUGIN_PROVIDE_DUPLICATE", owner, keys: [key] });
  }

  it("viewports, screen and camera-core register viewportManager, screenService and cameraManager", async () => {
    expect(typeof GwenPluginProvideError).toBe("function");
    await withEngine("light", async (handle) => {
      await installAll(handle);
      expect(handle.engine.tryInject("viewportManager")).toBeDefined();
      expect(handle.engine.tryInject("screenService")).toBeDefined();
      expect(handle.engine.tryInject("cameraManager")).toBeDefined();
    });
  });

  it("a second plugin declaring viewportManager rejects DUPLICATE with owner gwen:viewports", async () => {
    expect(typeof GwenPluginProvideError).toBe("function");
    await withEngine("light", async (handle) => {
      await installAll(handle);
      await rejectsDuplicate(handle, "viewportManager", "gwen:viewports");
    });
  });

  it("a second plugin declaring screenService rejects DUPLICATE with owner gwen:screen", async () => {
    expect(typeof GwenPluginProvideError).toBe("function");
    await withEngine("light", async (handle) => {
      await installAll(handle);
      await rejectsDuplicate(handle, "screenService", "gwen:screen");
    });
  });

  it("a second plugin declaring cameraManager rejects DUPLICATE with owner gwen:viewports", async () => {
    expect(typeof GwenPluginProvideError).toBe("function");
    await withEngine("light", async (handle) => {
      await installAll(handle);
      await rejectsDuplicate(handle, "cameraManager", "gwen:viewports");
    });
  });

  it("unuse of gwen:screen removes screenService and keeps the other two keys", async () => {
    expect(typeof GwenPluginProvideError).toBe("function");
    await withEngine("light", async (handle) => {
      await installAll(handle);
      await handle.engine.unuse("gwen:screen");
      expect(handle.engine.tryInject("screenService")).toBeUndefined();
      expect(handle.engine.tryInject("viewportManager")).toBeDefined();
      expect(handle.engine.tryInject("cameraManager")).toBeDefined();
    });
  });
});
