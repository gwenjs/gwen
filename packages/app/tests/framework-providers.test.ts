/**
 * @file Build-time installation of framework providers (FP-1, #280).
 *
 * Modules are injected through `moduleLoader`. Declarations go through `kit.addPlugin`
 * as plain values, so the `requires` and `provides` payloads need no type here.
 */

import { describe, expect, it } from "vitest";
import { defineGwenModule } from "@gwenjs/kit/module";
import type { GwenModule } from "@gwenjs/kit/module";
import { definePlugin } from "@gwenjs/kit/plugin";
import { GwenError } from "@gwenjs/schema";
import type { GwenPlugin, PluginDeclaration } from "@gwenjs/schema";
import { GwenApp } from "../src/app.js";
import { resolveLoadedConfig } from "../src/config.js";

declare module "@gwenjs/schema" {
  interface GwenProvides {
    "audio:mixer": object;
  }
}

const CAMERA_CORE = { src: "@gwenjs/camera-core", export: "CameraCorePlugin" };
const CAMERA_2D = {
  src: "@gwenjs/camera2d",
  export: "Camera2DPlugin",
  requires: { plugins: ["camera-core"] },
};
const CAMERA_3D = {
  src: "@gwenjs/camera3d",
  export: "Camera3DPlugin",
  requires: { plugins: ["camera-core"] },
};
const MIXER = {
  src: "@test/mixer",
  export: "MixerPlugin",
  provides: ["audio:mixer"] as const,
};
const MIXER_USER = {
  src: "@test/mixer-user",
  export: "MixerUserPlugin",
  requires: { services: ["audio:mixer"] },
};

const FX_BASE = { src: "@test/fx-base", export: "FxBasePlugin", name: "fx-base" };
const FX_EXT = {
  src: "@test/fx-ext",
  export: "FxExtPlugin",
  name: "fx-ext",
  requires: { plugins: [{ name: "fx-base", extensionApi: { major: 1, minor: 0 } }] },
};
const FX_EXT_STRING = { ...FX_EXT, requires: { plugins: ["fx-base"] } };

function moduleOf(name: string, declarations: readonly unknown[]): GwenModule {
  return defineGwenModule({
    meta: { name },
    setup(_options, kit) {
      for (const declaration of declarations) Reflect.apply(kit.addPlugin, kit, [declaration]);
    },
  });
}

/** Shape of the provider table `GwenApp` takes, declared here so the test needs no new export. */
interface ProviderTable {
  plugins: Record<string, PluginDeclaration>;
  services: Record<string, PluginDeclaration>;
}

/** A `GwenApp` built with an injected provider table, through the constructor's runtime path. */
function appWith(providers: ProviderTable): GwenApp {
  return Reflect.construct(GwenApp, [{ providers }]);
}

interface Run {
  app: GwenApp;
  caught: unknown;
}

/** Runs `setupModules` once on `app` and returns what it rejected with, if anything. */
async function setupOn(
  app: GwenApp,
  modules: readonly GwenModule[],
  plugins: GwenPlugin[] = [],
): Promise<unknown> {
  const registry = new Map(modules.map((mod) => [mod.meta.name, mod]));
  return app
    .setupModules(
      { ...resolveLoadedConfig({ modules: [...registry.keys()] }), plugins },
      async (name) => {
        const mod = registry.get(name);
        if (mod === undefined) throw new Error(`[test] unknown module ${name}`);
        return mod;
      },
    )
    .then(
      () => undefined,
      (error: unknown) => error,
    );
}

async function run(
  modules: readonly GwenModule[],
  plugins: GwenPlugin[] = [],
  makeApp: () => GwenApp = () => new GwenApp(),
): Promise<Run> {
  const app = makeApp();
  const caught = await setupOn(app, modules, plugins);
  return { app, caught };
}

/** Declarations after the built-in scene and tween rows. */
async function userDeclarations(
  modules: readonly GwenModule[],
  plugins: GwenPlugin[] = [],
  makeApp?: () => GwenApp,
): Promise<readonly PluginDeclaration[]> {
  const base = (await run([])).app.pluginDeclarations.length;
  const { app, caught } = await run(modules, plugins, makeApp);
  expect(caught).toBeUndefined();
  return app.pluginDeclarations.slice(base);
}

function gwenError(caught: unknown): GwenError {
  expect(caught).toBeInstanceOf(GwenError);
  if (!(caught instanceof GwenError)) throw new Error("expected a GwenError");
  return caught;
}

function mixerTable(): ProviderTable {
  return { plugins: {}, services: { "audio:mixer": MIXER } };
}

describe("framework providers", () => {
  it("a declaration requiring camera-core gets the provider inserted right before it", async () => {
    const list = await userDeclarations([moduleOf("@gwenjs/camera2d", [CAMERA_2D])]);
    expect(list).toEqual([CAMERA_CORE, CAMERA_2D]);
  });

  it("two consumers get one provider, before the first", async () => {
    const list = await userDeclarations([
      moduleOf("@gwenjs/camera2d", [CAMERA_2D]),
      moduleOf("@gwenjs/camera3d", [CAMERA_3D]),
    ]);
    expect(list).toEqual([CAMERA_CORE, CAMERA_2D, CAMERA_3D]);
  });

  it("a second setupModules on the same GwenApp keeps one camera-core row before the first consumer", async () => {
    const app = new GwenApp();
    const modules = [moduleOf("@gwenjs/camera2d", [CAMERA_2D])];
    expect(await setupOn(app, modules)).toBeUndefined();
    expect(await setupOn(app, modules)).toBeUndefined();
    const exports = app.pluginDeclarations.map((entry) => entry.export);
    expect(exports.filter((name) => name === "CameraCorePlugin")).toHaveLength(1);
    expect(exports.indexOf("CameraCorePlugin")).toBe(exports.indexOf("Camera2DPlugin") - 1);
    expect(exports.filter((name) => name === "Camera2DPlugin")).toHaveLength(2);
  });

  it("a provider declared earlier by the author is not inserted again", async () => {
    const authored = { ...CAMERA_CORE, options: { mode: "author" } };
    const list = await userDeclarations([
      moduleOf("@gwenjs/camera-core", [authored]),
      moduleOf("@gwenjs/camera2d", [CAMERA_2D]),
    ]);
    expect(list).toEqual([authored, CAMERA_2D]);
  });

  it("a provider declared later rejects APP:PLUGIN_REQUIREMENT_ORDER naming both modules", async () => {
    const { caught } = await run([
      moduleOf("@gwenjs/camera2d", [CAMERA_2D]),
      moduleOf("@gwenjs/camera-core", [CAMERA_CORE]),
    ]);
    const error = gwenError(caught);
    expect(error.code).toBe("APP:PLUGIN_REQUIREMENT_ORDER");
    expect(error.message).toContain(
      'Module "@gwenjs/camera2d" requires "camera-core", which module "@gwenjs/camera-core" declares later.',
    );
  });

  it("an unknown hard service rejects APP:SERVICE_PROVIDER_MISSING naming the module and the key", async () => {
    const { caught } = await run([moduleOf("@test/mixer-user", [MIXER_USER])]);
    const error = gwenError(caught);
    expect(error.code).toBe("APP:SERVICE_PROVIDER_MISSING");
    expect(error.message).toContain(
      'Module "@test/mixer-user" requires service "audio:mixer", which no module, config plugin or framework provider installs.',
    );
  });

  it("a service provided by an earlier declaration, a config plugin, a bootstrap plugin or the engine passes", async () => {
    const earlier = await userDeclarations([
      moduleOf("@test/mixer", [MIXER]),
      moduleOf("@test/mixer-user", [MIXER_USER]),
    ]);
    expect(earlier).toEqual([MIXER, MIXER_USER]);
    const configPlugin = definePlugin({ provides: ["audio:mixer"] }, () => ({
      name: "test:mixer",
      setup() {},
    }))();
    const viaConfig = await userDeclarations(
      [moduleOf("@test/mixer-user", [MIXER_USER])],
      [configPlugin],
    );
    expect(viaConfig).toEqual([MIXER_USER]);
    const viewportUser = {
      src: "@test/viewport-user",
      export: "ViewportUserPlugin",
      requires: { services: ["viewportManager", "screenService", "logger"] },
    };
    const viaBootstrapAndEngine = await userDeclarations([
      moduleOf("@test/viewport-user", [viewportUser]),
    ]);
    expect(viaBootstrapAndEngine).toEqual([viewportUser]);
  });

  it("a declaration requiring transform:2d passes because the engine provides it", async () => {
    const decl = {
      src: "@test/renderer",
      export: "RendererPlugin",
      requires: { services: ["transform:2d"] },
    };
    const list = await userDeclarations([moduleOf("@test/renderer", [decl])]);
    expect(list).toEqual([decl]);
  });

  it("an optional requirement never inserts a provider nor fails", async () => {
    const optional = {
      src: "@test/mixer-user",
      export: "MixerUserPlugin",
      requires: { plugins: [], optional: ["audio:mixer"] },
    };
    const list = await userDeclarations([moduleOf("@test/mixer-user", [optional])]);
    expect(list).toEqual([optional]);
  });

  it("zero modules and modules without requires leave the list unchanged", async () => {
    const plain = { src: "@test/plain", export: "PlainPlugin", requires: {} };
    const list = await userDeclarations([moduleOf("@test/plain", [plain])]);
    expect(list).toEqual([plain]);
    const { app } = await run([]);
    expect(app.pluginDeclarations.map((entry) => entry.export)).toEqual([
      "SceneEnginePlugin",
      "TweenPlugin",
    ]);
  });

  it("a malformed requires or provides rejects APP:PLUGIN_NOT_DECLARATIVE", async () => {
    for (const bad of [
      { src: "@test/x", requires: "camera-core" },
      { src: "@test/x", requires: { plugins: "camera-core" } },
      { src: "@test/x", requires: { plugins: [{ name: 1 }] } },
      { src: "@test/x", requires: { services: [1] } },
      { src: "@test/x", requires: { optional: [1] } },
      { src: "@test/x", provides: "audio:mixer" },
      { src: "@test/x", provides: [1] },
    ]) {
      const { caught } = await run([moduleOf("@test/x", [bad])]);
      expect(gwenError(caught).cause).toMatchObject({ code: "APP:PLUGIN_NOT_DECLARATIVE" });
    }
  });

  it("a requirement named like an Object.prototype member is not a table row", async () => {
    const odd = {
      src: "@test/odd",
      export: "OddPlugin",
      requires: { services: ["toString"] },
    };
    const { caught } = await run([moduleOf("@test/odd", [odd])]);
    const error = gwenError(caught);
    expect(error.code).toBe("APP:SERVICE_PROVIDER_MISSING");
    expect(error.message).toContain('requires service "toString"');
    const oddPlugin = { ...odd, requires: { plugins: ["constructor"] } };
    const pluginError = gwenError((await run([moduleOf("@test/odd", [oddPlugin])])).caught);
    expect(pluginError.code).toBe("APP:PLUGIN_REQUIREMENT_MISSING");
    expect(pluginError.message).toContain('requires plugin "constructor"');
  });

  it("a services row inserts its provider right before the consumer", async () => {
    const makeApp = () => appWith(mixerTable());
    const list = await userDeclarations([moduleOf("@test/mixer-user", [MIXER_USER])], [], makeApp);
    expect(list).toEqual([MIXER, MIXER_USER]);
    const second = { ...MIXER_USER, src: "@test/mixer-user-2" };
    const two = await userDeclarations(
      [moduleOf("@test/mixer-user", [MIXER_USER]), moduleOf("@test/mixer-user-2", [second])],
      [],
      makeApp,
    );
    expect(two).toEqual([MIXER, MIXER_USER, second]);
  });

  it("a service provided by a later declaration rejects APP:PLUGIN_REQUIREMENT_ORDER", async () => {
    const { caught } = await run([
      moduleOf("@test/mixer-user", [MIXER_USER]),
      moduleOf("@test/mixer", [MIXER]),
    ]);
    const error = gwenError(caught);
    expect(error.code).toBe("APP:PLUGIN_REQUIREMENT_ORDER");
    expect(error.message).toContain(
      'Module "@test/mixer-user" requires "audio:mixer", which module "@test/mixer" declares later.',
    );
  });

  it("a config plugin named camera-core satisfies the requirement", async () => {
    const configPlugin = definePlugin({ provides: [] }, () => ({
      name: "camera-core",
      setup() {},
    }))();
    const list = await userDeclarations(
      [moduleOf("@gwenjs/camera2d", [CAMERA_2D])],
      [configPlugin],
    );
    expect(list).toEqual([CAMERA_2D]);
  });

  it("a requires entry given as an extension object counts by its name", async () => {
    const extension = {
      ...CAMERA_2D,
      requires: { plugins: [{ name: "camera-core", extensionApi: { major: 1, minor: 0 } }] },
    };
    const list = await userDeclarations([moduleOf("@gwenjs/camera2d", [extension])]);
    expect(list).toEqual([CAMERA_CORE, extension]);
  });

  it("two GwenApp instances insert independently", async () => {
    const providers: ProviderTable = {
      plugins: { "camera-core": { ...CAMERA_CORE } },
      services: {},
    };
    const before = structuredClone(providers);
    const makeApp = () => appWith(providers);
    const first = await userDeclarations([moduleOf("@gwenjs/camera2d", [CAMERA_2D])], [], makeApp);
    const second = await userDeclarations([moduleOf("@gwenjs/camera3d", [CAMERA_3D])], [], makeApp);
    expect(first).toEqual([CAMERA_CORE, CAMERA_2D]);
    expect(second).toEqual([CAMERA_CORE, CAMERA_3D]);
    expect(first[0]).not.toBe(second[0]);
    expect(providers).toEqual(before);
  });

  it("the hint is a Fix line in dev and absent in prod", async () => {
    const order = gwenError(
      (
        await run([
          moduleOf("@gwenjs/camera2d", [CAMERA_2D]),
          moduleOf("@gwenjs/camera-core", [CAMERA_CORE]),
        ])
      ).caught,
    );
    const orderHint =
      'Move "@gwenjs/camera-core" before "@gwenjs/camera2d" in modules, or remove it: the framework installs framework providers.';
    expect(order.hint).toBe(__GWEN_DEV__ ? orderHint : undefined);
    if (__GWEN_DEV__) expect(order.message).toContain(`\nFix: ${orderHint}`);
    else expect(order.message).not.toContain("Fix:");

    const missing = gwenError((await run([moduleOf("@test/mixer-user", [MIXER_USER])])).caught);
    const missingHint =
      'Add the module that provides "audio:mixer", or declare it in requires.optional if the plugin works without it.';
    expect(missing.hint).toBe(__GWEN_DEV__ ? missingHint : undefined);
    if (__GWEN_DEV__) expect(missing.message).toContain(`\nFix: ${missingHint}`);
    else expect(missing.message).not.toContain("Fix:");
  });
});

describe("plugin requirements of declarations", () => {
  const baseModule = () => moduleOf("@test/fx-base", [FX_BASE]);
  const extModule = (declaration: unknown = FX_EXT) => moduleOf("@test/fx-ext", [declaration]);
  const configPlugin = (name: string): GwenPlugin =>
    definePlugin({ provides: [] }, () => ({ name, setup() {} }))();

  it("an extension declared before its base rejects APP:PLUGIN_REQUIREMENT_ORDER naming both modules", async () => {
    const { caught } = await run([extModule(), baseModule()]);
    const error = gwenError(caught);
    expect(error.code).toBe("APP:PLUGIN_REQUIREMENT_ORDER");
    expect(error.message).toContain(
      'Module "@test/fx-ext" requires "fx-base", which module "@test/fx-base" declares later.',
    );
  });

  it("a string entry before its base rejects APP:PLUGIN_REQUIREMENT_ORDER like an object entry", async () => {
    const { caught } = await run([extModule(FX_EXT_STRING), baseModule()]);
    const error = gwenError(caught);
    expect(error.code).toBe("APP:PLUGIN_REQUIREMENT_ORDER");
    expect(error.message).toContain(
      'Module "@test/fx-ext" requires "fx-base", which module "@test/fx-base" declares later.',
    );
  });

  it("an extension without its base rejects APP:PLUGIN_REQUIREMENT_MISSING", async () => {
    const { caught } = await run([extModule()]);
    const error = gwenError(caught);
    expect(error.code).toBe("APP:PLUGIN_REQUIREMENT_MISSING");
    expect(error.message).toContain(
      'Module "@test/fx-ext" requires plugin "fx-base", which no module or config plugin installs.',
    );
  });

  it("a named declaration declared earlier satisfies a string and an object entry; another name does not", async () => {
    const renamed = { ...FX_EXT_STRING, src: "@test/fx-ext-string", name: "fx-ext-string" };
    const list = await userDeclarations([
      baseModule(),
      extModule(),
      moduleOf("@test/fx-ext-string", [renamed]),
    ]);
    expect(list).toEqual([FX_BASE, FX_EXT, renamed]);
    const other = { ...FX_BASE, name: "fx-other" };
    const { caught } = await run([moduleOf("@test/fx-base", [other]), extModule()]);
    expect(gwenError(caught).code).toBe("APP:PLUGIN_REQUIREMENT_MISSING");
  });

  it("a declaration without name satisfies nothing", async () => {
    const unnamed = { src: FX_BASE.src, export: FX_BASE.export };
    const { caught } = await run([moduleOf("@test/fx-base", [unnamed]), extModule()]);
    const error = gwenError(caught);
    expect(error.code).toBe("APP:PLUGIN_REQUIREMENT_MISSING");
    expect(error.message).toContain('requires plugin "fx-base"');
  });

  it("a config plugin with the base name satisfies it; one with another name does not", async () => {
    const list = await userDeclarations([extModule()], [configPlugin("fx-base")]);
    expect(list).toEqual([FX_EXT]);
    const { caught } = await run([extModule()], [configPlugin("fx-other")]);
    expect(gwenError(caught).code).toBe("APP:PLUGIN_REQUIREMENT_MISSING");
  });

  it("a built-in plugin name is satisfied by the scene and tween declarations", async () => {
    const builtIns = {
      src: "@test/needs-built-ins",
      export: "NeedsBuiltInsPlugin",
      requires: { plugins: ["gwen:scene", "gwen:tween", "gwen:viewports", "gwen:screen"] },
    };
    const { app, caught } = await run([moduleOf("@test/needs-built-ins", [builtIns])]);
    expect(caught).toBeUndefined();
    expect(
      app.pluginDeclarations.map((entry) => ("name" in entry ? entry.name : undefined)),
    ).toEqual(["gwen:scene", "gwen:tween", undefined]);
  });

  it("a declaration named like a framework row replaces the insertion", async () => {
    const own = {
      src: "@test/own-camera-core",
      export: "OwnCameraCorePlugin",
      name: "camera-core",
    };
    const list = await userDeclarations([
      moduleOf("@test/own-camera-core", [own]),
      moduleOf("@gwenjs/camera2d", [CAMERA_2D]),
    ]);
    expect(list).toEqual([own, CAMERA_2D]);
  });

  it("a declaration named like a framework row declared later rejects APP:PLUGIN_REQUIREMENT_ORDER", async () => {
    const own = {
      src: "@test/own-camera-core",
      export: "OwnCameraCorePlugin",
      name: "camera-core",
    };
    const { caught } = await run([
      moduleOf("@gwenjs/camera2d", [CAMERA_2D]),
      moduleOf("@test/own-camera-core", [own]),
    ]);
    const error = gwenError(caught);
    expect(error.code).toBe("APP:PLUGIN_REQUIREMENT_ORDER");
    expect(error.message).toContain('which module "@test/own-camera-core" declares later.');
  });

  it("two extensions without their base report the first one", async () => {
    const second = { ...FX_EXT, src: "@test/fx-ext-2", name: "fx-ext-2" };
    const { caught } = await run([extModule(), moduleOf("@test/fx-ext-2", [second])]);
    const error = gwenError(caught);
    expect(error.code).toBe("APP:PLUGIN_REQUIREMENT_MISSING");
    expect(error.message).toContain('Module "@test/fx-ext"');
    expect(error.message).not.toContain('Module "@test/fx-ext-2"');
  });

  it("a malformed name or extension entry rejects APP:PLUGIN_NOT_DECLARATIVE", async () => {
    const entry = (extensionApi: unknown) => ({
      ...FX_EXT,
      requires: { plugins: [{ name: "fx-base", extensionApi }] },
    });
    for (const bad of [
      { ...FX_BASE, name: 1 },
      { ...FX_BASE, name: "" },
      { ...FX_EXT, requires: { plugins: [{ name: "fx-base" }] } },
      entry({ major: 0, minor: 0 }),
      entry({ major: 1, minor: -1 }),
      entry({ major: 1.5, minor: 0 }),
      entry({ major: 1, minor: 0.5 }),
    ]) {
      const { caught } = await run([moduleOf("@test/bad", [bad])]);
      const error = gwenError(caught);
      expect(error.code).toBe("APP:MODULE_SETUP_FAILED");
      expect(error.cause).toMatchObject({ code: "APP:PLUGIN_NOT_DECLARATIVE" });
    }
  });

  it("the two hints are Fix lines in dev and absent in prod", async () => {
    const order = gwenError((await run([extModule(), baseModule()])).caught);
    const orderHint = 'Move "@test/fx-base" before "@test/fx-ext" in modules.';
    expect(order.hint).toBe(__GWEN_DEV__ ? orderHint : undefined);
    if (__GWEN_DEV__) expect(order.message).toContain(`\nFix: ${orderHint}`);
    else expect(order.message).not.toContain("Fix:");

    const absent = gwenError((await run([extModule()])).caught);
    const absentHint = 'Add the module of "fx-base" before "@test/fx-ext" in modules.';
    expect(absent.hint).toBe(__GWEN_DEV__ ? absentHint : undefined);
    if (__GWEN_DEV__) expect(absent.message).toContain(`\nFix: ${absentHint}`);
    else expect(absent.message).not.toContain("Fix:");
  });
});
