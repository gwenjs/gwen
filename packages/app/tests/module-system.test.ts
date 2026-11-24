/**
 * @file RFC-004 — GwenApp module system tests
 *
 * Tests the `GwenApp` orchestrator and the `defineGwenModule` helper.
 * All WASM and file-system I/O is avoided — modules are injected via the
 * `moduleLoader` parameter of `setupModules()`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineGwenModule, GwenModuleDefinitionError } from "@gwenjs/kit/module";
import type { GwenModule } from "@gwenjs/kit/module";
import type { AutoImport } from "@gwenjs/kit";
import { GwenError } from "@gwenjs/schema";
import type { GwenKit, GwenSourceTransform, PluginDeclaration } from "@gwenjs/schema";
import { GwenApp } from "../src/app.js";
import { BUILT_IN_MODULES } from "../src/built-in-modules.js";
import { resolveLoadedConfig as resolveConfig } from "../src/config.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Creates a simple moduleLoader that maps name → GwenModule.
 *
 * @param registry - Map from module name to module definition.
 */
function makeLoader(registry: Record<string, GwenModule>): (name: string) => Promise<GwenModule> {
  return async (name: string) => {
    const mod = registry[name];
    if (!mod) throw new Error(`[test] Unknown module: ${name}`);
    return mod;
  };
}

function addUnknown(gwen: GwenKit, value: unknown): void {
  Reflect.apply(gwen.addPlugin, gwen, [value]);
}

const SCENE_DECLARATION: PluginDeclaration = {
  src: "@gwenjs/core/internal",
  export: "SceneEnginePlugin",
};
const TWEEN_DECLARATION: PluginDeclaration = {
  src: "@gwenjs/core/internal",
  export: "TweenPlugin",
  options: { poolSize: 256 },
};

async function runModule(
  name: string,
  setup: GwenModule["setup"],
): Promise<{ app: GwenApp; caught: unknown }> {
  const mod = defineGwenModule({ meta: { name }, setup });
  const app = new GwenApp();
  const caught = await app
    .setupModules(resolveConfig({ modules: [name] }), makeLoader({ [name]: mod }))
    .then(
      () => undefined,
      (error: unknown) => error,
    );
  return { app, caught };
}

function assertPluginRejected(caught: unknown, moduleName: string): GwenError {
  expect(caught).toBeInstanceOf(GwenError);
  if (!(caught instanceof GwenError)) throw new Error("expected GwenError");
  expect(caught.code).toBe("APP:MODULE_SETUP_FAILED");
  expect(caught.message).toContain(`Module "${moduleName}"`);
  expect(caught.cause).toBeInstanceOf(GwenError);
  if (!(caught.cause instanceof GwenError)) throw new Error("expected cause");
  expect(caught.cause.code).toBe("APP:PLUGIN_NOT_DECLARATIVE");
  return caught.cause;
}

function cyclicRecord(): object {
  const box: { self?: object } = {};
  box.self = box;
  return box;
}

/** Each title keeps the kind as a literal so one `-t` selects one row. */
const NON_JSON_OPTIONS: ReadonlyArray<readonly [string, () => unknown]> = [
  ["NaN", () => Number.NaN],
  ["Infinity", () => Number.POSITIVE_INFINITY],
  ["bigint", () => 1n],
  ["cycle", () => cyclicRecord()],
  ["Date", () => new Date(0)],
  ["Map", () => new Map<string, number>([["k", 1]])],
  ["nested function", () => ({ child: { tick: () => 0 } })],
];

// ─── defineGwenModule ─────────────────────────────────────────────────────────

describe("defineGwenModule", () => {
  it("returns the definition object unchanged", () => {
    const definition = {
      meta: { name: "@test/my-module" },
      defaults: { speed: 1 },
      setup: vi.fn(),
    };

    const mod = defineGwenModule(definition);

    expect(mod).toBe(definition);
    expect(mod.meta.name).toBe("@test/my-module");
    expect(mod.defaults).toEqual({ speed: 1 });
    expect(typeof mod.setup).toBe("function");
  });

  it("works without defaults", () => {
    const mod = defineGwenModule({
      meta: { name: "@test/no-defaults" },
      setup: vi.fn(),
    });

    expect(mod.meta.name).toBe("@test/no-defaults");
    expect(mod.defaults).toBeUndefined();
  });

  it("preserves async setup signature", async () => {
    const setupFn = vi.fn().mockResolvedValue(undefined);
    const mod = defineGwenModule({
      meta: { name: "@test/async-module" },
      setup: setupFn,
    });

    // Should return a Promise
    const result = mod.setup({}, {} as Parameters<typeof mod.setup>[1]);
    expect(result).toBeInstanceOf(Promise);
    await result;
    expect(setupFn).toHaveBeenCalledTimes(1);
  });
});

// ─── GwenApp — options merging ────────────────────────────────────────────────

describe("GwenApp.setupModules — options merging via configKey", () => {
  it("calls setup with module defaults when no top-level config key is present", async () => {
    const setupFn = vi.fn();
    const mod = defineGwenModule({
      meta: { name: "@test/mod", configKey: "testMod" },
      defaults: { gravity: 9.81, iterations: 8 },
      setup: setupFn,
    });

    const config = resolveConfig({
      modules: ["@test/mod"],
      // no testMod key — defaults should apply
    });

    const app = new GwenApp();
    await app.setupModules(config, makeLoader({ "@test/mod": mod }));

    expect(setupFn).toHaveBeenCalledOnce();
    const [receivedOptions] = setupFn.mock.calls[0] as [Record<string, unknown>];
    expect(receivedOptions).toMatchObject({ gravity: 9.81, iterations: 8 });
  });

  it("user top-level config overrides module defaults (shallow)", async () => {
    const setupFn = vi.fn();
    const mod = defineGwenModule({
      meta: { name: "@test/mod", configKey: "testMod" },
      defaults: { gravity: 9.81, iterations: 8 },
      setup: setupFn,
    });

    const config = resolveConfig({
      modules: ["@test/mod"],
      testMod: { gravity: 20 },
    } as any);

    const app = new GwenApp();
    await app.setupModules(config, makeLoader({ "@test/mod": mod }));

    const [receivedOptions] = setupFn.mock.calls[0] as [Record<string, unknown>];
    expect(receivedOptions.gravity).toBe(20);
    expect(receivedOptions.iterations).toBe(8); // default preserved
  });

  it("user top-level config overrides module defaults (deep merge)", async () => {
    const setupFn = vi.fn();
    const mod = defineGwenModule({
      meta: { name: "@test/deep", configKey: "testDeep" },
      defaults: { renderer: { shadows: true, msaa: 4 } },
      setup: setupFn,
    });

    const config = resolveConfig({
      modules: ["@test/deep"],
      testDeep: { renderer: { msaa: 2 } },
    } as any);

    const app = new GwenApp();
    await app.setupModules(config, makeLoader({ "@test/deep": mod }));

    const [receivedOptions] = setupFn.mock.calls[0] as [Record<string, unknown>];
    const renderer = receivedOptions["renderer"] as Record<string, unknown>;
    expect(renderer.msaa).toBe(2);
    expect(renderer.shadows).toBe(true);
  });

  it("module without configKey receives empty options merged with defaults", async () => {
    const setupFn = vi.fn();
    const mod = defineGwenModule({
      meta: { name: "@test/no-key" }, // no configKey
      defaults: { x: 42 },
      setup: setupFn,
    });

    const config = resolveConfig({ modules: ["@test/no-key"] });
    const app = new GwenApp();
    await app.setupModules(config, makeLoader({ "@test/no-key": mod }));

    const [receivedOptions] = setupFn.mock.calls[0] as [Record<string, unknown>];
    expect(receivedOptions.x).toBe(42);
  });

  it("empty user config {} preserves all defaults", async () => {
    const setupFn = vi.fn();
    const mod = defineGwenModule({
      meta: { name: "@test/empty-opts", configKey: "emptyOpts" },
      defaults: { a: 1, b: 2 },
      setup: setupFn,
    });

    const config = resolveConfig({
      modules: ["@test/empty-opts"],
      emptyOpts: {},
    } as any);

    const app = new GwenApp();
    await app.setupModules(config, makeLoader({ "@test/empty-opts": mod }));

    const [receivedOptions] = setupFn.mock.calls[0] as [Record<string, unknown>];
    expect(receivedOptions).toMatchObject({ a: 1, b: 2 });
  });

  it("stores PluginDeclaration objects in pluginDeclarations (not in plugins)", async () => {
    const decl = { src: "@gwenjs/renderer-core", export: "ScreenPlugin", options: { fov: 75 } };
    const mod = defineGwenModule({
      meta: { name: "@test/decl-mod" },
      setup(_opts, gwen) {
        gwen.addPlugin(decl);
      },
    });

    const config = resolveConfig({ modules: ["@test/decl-mod"] });
    const app = new GwenApp();
    await app.setupModules(config, makeLoader({ "@test/decl-mod": mod }));

    expect(app.pluginDeclarations).toEqual([SCENE_DECLARATION, TWEEN_DECLARATION, decl]);
    // The declaration does not become a runtime plugin. GwenApp still installs viewports and screen.
    expect(app.plugins.map((plugin) => plugin.name)).toEqual(["gwen:viewports", "gwen:screen"]);
  });
});

describe("GwenApp.setupModules — reserved key collision", () => {
  it("reserved configKey throws APP:CONFIG_CONFLICT", async () => {
    let calls = 0;
    const mod = defineGwenModule({
      meta: { name: "@test/bad-key", configKey: "engine" }, // "engine" is reserved
      defaults: { x: 1 },
      setup() {
        calls += 1;
      },
    });

    const config = resolveConfig({ modules: ["@test/bad-key"] });
    const caught = (await new GwenApp()
      .setupModules(config, makeLoader({ "@test/bad-key": mod }))
      .catch((err: unknown) => err)) as { code?: string; message?: string };
    expect(caught.code).toBe("APP:CONFIG_CONFLICT");
    expect(caught.message).toContain("@test/bad-key");
    expect(calls).toBe(0);
  });

  it("duplicate configKey throws APP:CONFIG_CONFLICT", async () => {
    const first = defineGwenModule({
      meta: { name: "@test/first", configKey: "shared" },
      setup() {},
    });
    const second = defineGwenModule({
      meta: { name: "@test/second", configKey: "shared" },
      setup() {},
    });
    const config = resolveConfig({ modules: ["@test/first", "@test/second"] });
    const caught = (await new GwenApp()
      .setupModules(config, makeLoader({ "@test/first": first, "@test/second": second }))
      .catch((err: unknown) => err)) as { code?: string; message?: string };
    expect(caught.code).toBe("APP:CONFIG_CONFLICT");
    expect(caught.message).toContain("@test/first");
    expect(caught.message).toContain("@test/second");
  });
});

describe("GwenApp.setupModules — a module runs once", () => {
  it("a module listed twice runs setup once", async () => {
    let calls = 0;
    const mod = defineGwenModule({
      meta: { name: "@test/twice" },
      setup() {
        calls += 1;
      },
    });
    const config = resolveConfig({ modules: ["@test/twice", "@test/twice"] });
    await new GwenApp().setupModules(config, async () => mod);
    expect(calls).toBe(1);
  });

  it("a built-in module listed in modules runs setup once", async () => {
    const tween = BUILT_IN_MODULES.find((mod) => mod.meta.name === "@gwenjs/core:tween");
    if (tween === undefined) throw new Error("missing @gwenjs/core:tween");
    let calls = 0;
    const previous = tween.setup;
    tween.setup = (options, kit) => {
      calls += 1;
      return previous(options, kit);
    };
    try {
      const config = resolveConfig({ modules: ["@gwenjs/core:tween"] });
      await new GwenApp().setupModules(config, async () => tween);
      expect(calls).toBe(1);
    } finally {
      tween.setup = previous;
    }
  });
});

// ─── GwenApp — plugin collection ──────────────────────────────────────────────

describe("GwenApp.setupModules — plugin collection", () => {
  it("addPlugin with a plugin instance fails the build naming the module", async () => {
    const name = "@test/instance-mod";
    const { caught } = await runModule(name, (_opts, gwen) => {
      addUnknown(gwen, { name: "x", setup() {} });
    });
    const cause = assertPluginRejected(caught, name);
    expect(
      cause.message.startsWith("[kit.addPlugin()] kit.addPlugin() takes a PluginDeclaration"),
    ).toBe(true);
  });

  it("addPlugin with a factory function fails the same way", async () => {
    const name = "@test/factory-mod";
    const { caught } = await runModule(name, (_opts, gwen) => {
      addUnknown(gwen, () => ({ name: "x", setup() {} }));
    });
    const cause = assertPluginRejected(caught, name);
    expect(
      cause.message.startsWith("[kit.addPlugin()] kit.addPlugin() takes a PluginDeclaration"),
    ).toBe(true);
  });

  it("addPlugin with non-serializable options fails", async () => {
    const src = "@test/serial";
    for (const options of [{ cb: () => 1 }, { a: { cb: () => 1 } }]) {
      const { caught } = await runModule("@test/serial-mod", (_opts, gwen) => {
        gwen.addPlugin({ src, options });
      });
      const cause = assertPluginRejected(caught, "@test/serial-mod");
      expect(cause.message).toContain(
        `Plugin declaration "${src}" has options that are not JSON-serializable.`,
      );
    }

    const options = {
      name: "hero",
      flags: [true, false],
      count: 0,
      ratio: -1.5,
      label: "ok",
      child: { enabled: true, tags: ["a", null] },
      empty: null,
    };
    const { app, caught } = await runModule("@test/ok-opts", (_opts, gwen) => {
      gwen.addPlugin({ src: "@test/ok", options });
    });
    expect(caught).toBeUndefined();
    const found = app.pluginDeclarations.find((item) => item.src === "@test/ok");
    expect(found?.options).toEqual(options);
  });

  it("a declaration is collected in module order", async () => {
    const declA = { src: "@test/a", export: "A" };
    const declB = { src: "@test/b", export: "B" };
    const modA = defineGwenModule({
      meta: { name: "@test/mod-a" },
      setup(_opts, gwen) {
        gwen.addPlugin(declA);
      },
    });
    const modB = defineGwenModule({
      meta: { name: "@test/mod-b" },
      setup(_opts, gwen) {
        gwen.addPlugin(declB);
      },
    });
    const app = new GwenApp();
    await app.setupModules(
      resolveConfig({ modules: ["@test/mod-a", "@test/mod-b"] }),
      makeLoader({ "@test/mod-a": modA, "@test/mod-b": modB }),
    );
    expect(app.pluginDeclarations).toEqual([SCENE_DECLARATION, TWEEN_DECLARATION, declA, declB]);
  });

  it("addPlugin with a declaration without export and without options is collected", async () => {
    const decl = { src: "@test/x" };
    const mod = defineGwenModule({
      meta: { name: "@test/bare" },
      setup(_opts, gwen) {
        gwen.addPlugin(decl);
      },
    });
    const app = new GwenApp();
    const listed = await app
      .setupModules(resolveConfig({ modules: ["@test/bare"] }), makeLoader({ "@test/bare": mod }))
      .then(
        () => app.pluginDeclarations,
        () => undefined,
      );
    expect(listed).toEqual([SCENE_DECLARATION, TWEEN_DECLARATION, decl]);
  });

  it("addPlugin with a non-string export fails", async () => {
    const name = "@test/bad-export";
    for (const exportName of [() => "plugin", 1]) {
      const { caught } = await runModule(name, (_opts, gwen) => {
        addUnknown(gwen, { src: "x", export: exportName });
      });
      assertPluginRejected(caught, name);
    }
  });

  it("addPlugin with an empty src fails", async () => {
    const name = "@test/empty-src";
    const { caught } = await runModule(name, (_opts, gwen) => {
      gwen.addPlugin({ src: "" });
    });
    assertPluginRejected(caught, name);
  });

  it("addPlugin with options undefined is collected like no options", async () => {
    const absent = { src: "@test/absent", export: "Bare" };
    const explicit = { src: "@test/explicit", export: "Bare", options: undefined };
    const { app, caught } = await runModule("@test/undef-opts", (_opts, gwen) => {
      gwen.addPlugin(absent);
      gwen.addPlugin(explicit);
    });
    expect(caught).toBeUndefined();
    const declarations = app.pluginDeclarations.filter((item) => item.export === "Bare");
    expect(declarations).toHaveLength(2);
    for (const row of declarations) {
      expect("options" in row).toBe(false);
    }
    expect(declarations).toEqual([absent, { src: explicit.src, export: explicit.export }]);
  });

  it.each(NON_JSON_OPTIONS)("addPlugin rejects options %s", async (kind, makeOptions) => {
    const src = "@test/not-json";
    const name = `@test/not-json-${kind.replace(/ /g, "-")}`;
    const { caught } = await runModule(name, (_opts, gwen) => {
      gwen.addPlugin({ src, options: makeOptions() });
    });
    const cause = assertPluginRejected(caught, name);
    expect(cause.message.split("\n")[0]).toBe(
      `[kit.addPlugin()] Plugin declaration "${src}" has options that are not JSON-serializable.`,
    );
  });
});

// ─── GwenApp — auto-imports ───────────────────────────────────────────────────

describe("GwenApp.setupModules — auto-imports and type templates", () => {
  it("accumulates auto-imports from multiple modules", async () => {
    const importA: AutoImport = { name: "usePhysics", from: "@test/physics" };
    const importB: AutoImport = { name: "useInput", from: "@test/input" };

    const modA = defineGwenModule({
      meta: { name: "@test/physics" },
      setup(_opts, gwen) {
        gwen.addAutoImports([importA]);
      },
    });
    const modB = defineGwenModule({
      meta: { name: "@test/input" },
      setup(_opts, gwen) {
        gwen.addAutoImports([importB]);
      },
    });

    const config = resolveConfig({ modules: ["@test/physics", "@test/input"] });
    const app = new GwenApp();
    await app.setupModules(config, makeLoader({ "@test/physics": modA, "@test/input": modB }));

    // Built-in modules add ~38 auto-imports from system/actor/scene/router/tween modules
    // + 1 useScreen built-in
    // + 2 user imports = ~41 total
    expect(app.autoImports).toContainEqual(importA);
    expect(app.autoImports).toContainEqual(importB);
  });

  it("gwen.options exposes the resolved config", async () => {
    let capturedOptions: unknown;

    const mod = defineGwenModule({
      meta: { name: "@test/opts-mod" },
      setup(_opts, gwen) {
        capturedOptions = gwen.options;
      },
    });

    const config = resolveConfig({
      modules: ["@test/opts-mod"],
      engine: { maxEntities: 999 },
    });
    const app = new GwenApp();
    await app.setupModules(config, makeLoader({ "@test/opts-mod": mod }));

    expect((capturedOptions as typeof config).engine.maxEntities).toBe(999);
    expect(Object.isFrozen(capturedOptions)).toBe(true);
  });
});

// ─── GwenApp — Vite config extension ─────────────────────────────────────────

describe("GwenApp.resolveViteConfig", () => {
  it("returns the base config unmodified when no extenders are registered", async () => {
    const config = resolveConfig({ modules: [] });
    const app = new GwenApp();
    await app.setupModules(config, makeLoader({}));

    const base = { root: "./src", plugins: [] };
    const result = app.resolveViteConfig(base);

    expect(result).toMatchObject({ root: "./src", plugins: [] });
  });

  it("applies a single extender from a module", async () => {
    const mod = defineGwenModule({
      meta: { name: "@test/vite-mod" },
      setup(_opts, gwen) {
        gwen.extendViteConfig(() => ({ define: { __VERSION__: '"1.0.0"' } }));
      },
    });

    const config = resolveConfig({ modules: ["@test/vite-mod"] });
    const app = new GwenApp();
    await app.setupModules(config, makeLoader({ "@test/vite-mod": mod }));

    const result = app.resolveViteConfig({ root: "./src" });
    expect(result.define).toEqual({ __VERSION__: '"1.0.0"' });
    expect(result.root).toBe("./src");
  });

  it("applies extenders from multiple modules in registration order", async () => {
    const order: string[] = [];

    const modA = defineGwenModule({
      meta: { name: "@test/ext-a" },
      setup(_opts, gwen) {
        gwen.extendViteConfig(() => {
          order.push("a");
          return { customA: true };
        });
      },
    });
    const modB = defineGwenModule({
      meta: { name: "@test/ext-b" },
      setup(_opts, gwen) {
        gwen.extendViteConfig(() => {
          order.push("b");
          return { customB: true };
        });
      },
    });

    const config = resolveConfig({ modules: ["@test/ext-a", "@test/ext-b"] });
    const app = new GwenApp();
    await app.setupModules(config, makeLoader({ "@test/ext-a": modA, "@test/ext-b": modB }));

    const result = app.resolveViteConfig({});

    expect(order).toEqual(["a", "b"]);
    expect(result.customA).toBe(true);
    expect(result.customB).toBe(true);
  });

  it("applies root-level config.vite as the last extender", async () => {
    const mod = defineGwenModule({
      meta: { name: "@test/vite-first" },
      setup(_opts, gwen) {
        gwen.extendViteConfig(() => ({ base: "/from-module/" }));
      },
    });

    // root-level vite key should override the module's extension
    const config = resolveConfig({
      modules: ["@test/vite-first"],
      vite: { base: "/from-root/" },
    });

    const app = new GwenApp();
    await app.setupModules(config, makeLoader({ "@test/vite-first": mod }));

    const result = app.resolveViteConfig({});
    // Root vite applied last — wins over module extension
    expect(result.base).toBe("/from-root/");
  });

  it("each extender receives the accumulated config from previous extenders", async () => {
    const mod = defineGwenModule({
      meta: { name: "@test/chain" },
      setup(_opts, gwen) {
        gwen.extendViteConfig(() => ({ counter: 1 }));
        gwen.extendViteConfig((cfg) => ({ counter: (cfg["counter"] as number) + 1 }));
      },
    });

    const config = resolveConfig({ modules: ["@test/chain"] });
    const app = new GwenApp();
    await app.setupModules(config, makeLoader({ "@test/chain": mod }));

    const result = app.resolveViteConfig({});
    expect(result.counter).toBe(2);
  });
});

// ─── GwenApp — build hooks ────────────────────────────────────────────────────

describe("GwenApp — build hooks", () => {
  let hookOrder: string[];

  beforeEach(() => {
    hookOrder = [];
  });

  it("fires hooks in correct order: build:before → module:before → module:done → build:done", async () => {
    const mod = defineGwenModule({
      meta: { name: "@test/hook-mod" },
      setup: vi.fn(),
    });

    const config = resolveConfig({ modules: ["@test/hook-mod"] });
    const app = new GwenApp();

    app.buildHooks.hook("build:before", () => {
      hookOrder.push("build:before");
    });
    app.buildHooks.hook("module:before", () => {
      hookOrder.push("module:before");
    });
    app.buildHooks.hook("module:done", () => {
      hookOrder.push("module:done");
    });
    app.buildHooks.hook("build:done", () => {
      hookOrder.push("build:done");
    });

    await app.setupModules(config, makeLoader({ "@test/hook-mod": mod }));

    // Built-in modules (system, actor, scene, router, tween) get module:before/done calls
    // Then user module gets module:before/done calls
    // build:before comes first, build:done comes last
    expect(hookOrder[0]).toBe("build:before");
    expect(hookOrder[hookOrder.length - 1]).toBe("build:done");
    // Verify the user module was called once
    const userModuleCallIndex = hookOrder.lastIndexOf("module:before");
    expect(userModuleCallIndex).toBeGreaterThan(0);
  });

  it("module:before and module:done receive the module as argument", async () => {
    const mod = defineGwenModule({
      meta: { name: "@test/arg-mod" },
      setup: vi.fn(),
    });

    const config = resolveConfig({ modules: ["@test/arg-mod"] });
    const app = new GwenApp();

    const beforeArg = vi.fn();
    const doneArg = vi.fn();
    app.buildHooks.hook("module:before", beforeArg);
    app.buildHooks.hook("module:done", doneArg);

    await app.setupModules(config, makeLoader({ "@test/arg-mod": mod }));

    expect(beforeArg).toHaveBeenCalledWith(mod);
    expect(doneArg).toHaveBeenCalledWith(mod);
  });

  it("fires module hooks once per module when multiple modules are listed", async () => {
    const modA = defineGwenModule({ meta: { name: "@test/a" }, setup: vi.fn() });
    const modB = defineGwenModule({ meta: { name: "@test/b" }, setup: vi.fn() });

    const config = resolveConfig({ modules: ["@test/a", "@test/b"] });
    const app = new GwenApp();

    const beforeFn = vi.fn();
    const doneFn = vi.fn();
    app.buildHooks.hook("module:before", beforeFn);
    app.buildHooks.hook("module:done", doneFn);

    await app.setupModules(config, makeLoader({ "@test/a": modA, "@test/b": modB }));

    // Built-in modules (system, actor, scene, router, tween) = 5 modules
    // + 2 user modules = 7 modules total
    expect(beforeFn).toHaveBeenCalledTimes(7);
    expect(doneFn).toHaveBeenCalledTimes(7);
  });

  it("build:before fires before any module setup", async () => {
    const setupOrder: string[] = [];

    const mod = defineGwenModule({
      meta: { name: "@test/order-mod" },
      setup() {
        setupOrder.push("setup");
      },
    });

    const config = resolveConfig({ modules: ["@test/order-mod"] });
    const app = new GwenApp();
    app.buildHooks.hook("build:before", () => {
      setupOrder.push("build:before");
    });

    await app.setupModules(config, makeLoader({ "@test/order-mod": mod }));

    expect(setupOrder[0]).toBe("build:before");
    expect(setupOrder[1]).toBe("setup");
  });

  it("build:done fires after all module setup is complete", async () => {
    const setupOrder: string[] = [];

    const modA = defineGwenModule({
      meta: { name: "@test/done-a" },
      setup() {
        setupOrder.push("a");
      },
    });
    const modB = defineGwenModule({
      meta: { name: "@test/done-b" },
      setup() {
        setupOrder.push("b");
      },
    });

    const config = resolveConfig({ modules: ["@test/done-a", "@test/done-b"] });
    const app = new GwenApp();
    app.buildHooks.hook("build:done", () => {
      setupOrder.push("build:done");
    });

    await app.setupModules(config, makeLoader({ "@test/done-a": modA, "@test/done-b": modB }));

    expect(setupOrder).toEqual(["a", "b", "build:done"]);
  });

  it("a module can subscribe to hooks via gwen.hook()", async () => {
    const hookFired = vi.fn();

    const mod = defineGwenModule({
      meta: { name: "@test/inner-hook-mod" },
      setup(_opts, gwen) {
        gwen.hook("build:done", hookFired);
      },
    });

    const config = resolveConfig({ modules: ["@test/inner-hook-mod"] });
    const app = new GwenApp();
    await app.setupModules(config, makeLoader({ "@test/inner-hook-mod": mod }));

    expect(hookFired).toHaveBeenCalledOnce();
  });

  it("registers gwen:screen plugin automatically", async () => {
    const app = new GwenApp();
    const config = resolveConfig({});
    await app.setupModules(config);
    const names = app.plugins.map((p) => p.name);
    expect(names).toContain("gwen:screen");
  });

  it("gwen:screen plugin appears after gwen:viewports", async () => {
    const app = new GwenApp();
    const config = resolveConfig({});
    await app.setupModules(config);
    const names = app.plugins.map((p) => p.name);
    const viewportsIdx = names.indexOf("gwen:viewports");
    const screenIdx = names.indexOf("gwen:screen");
    expect(screenIdx).toBeGreaterThan(viewportsIdx);
  });

  it("includes useScreen in auto-imports", async () => {
    const app = new GwenApp();
    await app.setupModules(resolveConfig({}));
    const names = app.autoImports.map((i) => i.name);
    expect(names).toContain("useScreen");
  });
});

// ─── GwenApp — Vite plugins collection ───────────────────────────────────────

describe("GwenApp.setupModules — Vite plugin collection", () => {
  it("collects Vite plugins registered via gwen.addVitePlugin()", async () => {
    const vitePlugin = { name: "my-vite-plugin", transform: vi.fn() };

    const mod = defineGwenModule({
      meta: { name: "@test/vite-plugin-mod" },
      setup(_opts, gwen) {
        gwen.addVitePlugin(vitePlugin);
      },
    });

    const config = resolveConfig({ modules: ["@test/vite-plugin-mod"] });
    const app = new GwenApp();
    await app.setupModules(config, makeLoader({ "@test/vite-plugin-mod": mod }));

    expect(app.vitePlugins).toHaveLength(1);
    expect(app.vitePlugins[0]).toBe(vitePlugin);
  });
});

// ─── GwenApp — getter immutability ───────────────────────────────────────────

describe("GwenApp — getter immutability", () => {
  it("plugins getter returns a defensive copy", async () => {
    const app = new GwenApp();
    await app.setupModules(resolveConfig({}));

    const snap1 = app.plugins;
    snap1.push({ name: "injected", setup() {} });

    // gwen:viewports + gwen:screen. Module plugins are declarations.
    expect(app.plugins).toHaveLength(2);
    expect(app.plugins.map((plugin) => plugin.name)).toEqual(["gwen:viewports", "gwen:screen"]);
  });
});

// ─── resolveConfig ────────────────────────────────────────────────────────────

describe("resolveConfig", () => {
  it("fills in engine defaults when none are provided", () => {
    const cfg = resolveConfig({});

    expect(cfg.engine.maxEntities).toBe(10_000);
    expect(cfg.engine.targetFPS).toBe(60);
    expect(cfg.engine.variant).toBe("light");
    expect(cfg.engine.loop).toBe("internal");
    expect(cfg.engine.maxDeltaSeconds).toBe(0.1);
  });

  it("user engine values override defaults", () => {
    const cfg = resolveConfig({ engine: { maxEntities: 500 } });

    expect(cfg.engine.maxEntities).toBe(500);
    expect(cfg.engine.targetFPS).toBe(60); // default preserved
  });

  it("modules defaults to an empty array", () => {
    const cfg = resolveConfig({});
    expect(cfg.modules).toEqual([]);
  });

  it("preserves user-provided modules array", () => {
    const cfg = resolveConfig({ modules: ["@test/mod-a", "@test/mod-b"] });
    expect(cfg.modules).toHaveLength(2);
  });
});

describe("GwenApp.setupModules — local modules", () => {
  const roots: string[] = [];

  afterEach(() => {
    while (roots.length > 0) {
      const root = roots.pop();
      if (root !== undefined) rmSync(root, { recursive: true, force: true });
    }
  });

  function makeRoot(): string {
    const root = mkdtempSync(join(tmpdir(), "gwen-local-mod-"));
    roots.push(root);
    return root;
  }

  /** Under `packages/app` so jiti resolves `@gwenjs/kit/module` from that package. */
  function makeAppRoot(): string {
    const root = mkdtempSync(join(dirname(fileURLToPath(import.meta.url)), "tmp-local-mod-"));
    roots.push(root);
    return root;
  }

  function writeModule(root: string, rel: string, source: string): void {
    const file = join(root, rel);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, source);
  }

  function declarationSrcs(app: GwenApp): string[] {
    return app.pluginDeclarations.map((item) => item.src);
  }

  it("local src/modules run in setupModules", async () => {
    const root = makeRoot();
    writeModule(
      root,
      "src/modules/score.ts",
      `export default { meta: {}, setup(_options, gwen) { gwen.addPlugin({ src: "local-score" }); } }\n`,
    );
    writeModule(
      root,
      "src/modules/hud/index.ts",
      `export default { meta: {}, setup(_options, gwen) { gwen.addPlugin({ src: "local-hud" }); } }\n`,
    );
    const cfg = defineGwenModule({
      meta: { name: "cfg" },
      setup(_options, gwen) {
        gwen.addPlugin({ src: "cfg-plugin" });
      },
    });
    const app = new GwenApp();
    const before: string[] = [];
    const done: string[] = [];
    app.buildHooks.hook("module:before", (mod) => {
      before.push(mod.meta.name);
    });
    app.buildHooks.hook("module:done", (mod) => {
      done.push(mod.meta.name);
    });
    await app.setupModules(resolveConfig({ modules: ["cfg"] }), makeLoader({ cfg }), { root });

    expect(declarationSrcs(app).slice(-3)).toEqual(["cfg-plugin", "local-hud", "local-score"]);
    expect(before.slice(-2)).toEqual(["local:hud", "local:score"]);
    expect(done.slice(-2)).toEqual(["local:hud", "local:score"]);

    const empty = makeRoot();
    const bare = new GwenApp();
    await bare.setupModules(resolveConfig({ modules: [] }), makeLoader({}), { root: empty });
    expect(declarationSrcs(bare).filter((src) => src.startsWith("local-"))).toEqual([]);
  });

  it("a local module that throws fails the load naming local:<name>", async () => {
    const root = makeRoot();
    writeModule(
      root,
      "src/modules/boom.ts",
      `export default { meta: {}, setup() { throw new Error("kaput"); } }\n`,
    );
    const app = new GwenApp();
    let caught: unknown;
    try {
      await app.setupModules(resolveConfig({ modules: [] }), makeLoader({}), { root });
      caught = undefined;
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(GwenError);
    if (!(caught instanceof GwenError)) throw new Error("expected GwenError");
    expect(caught.code).toBe("APP:MODULE_SETUP_FAILED");
    expect(caught.message).toContain('Module "local:boom"');
    expect(caught.message).toContain("kaput");
  });

  it("a custom localModulesDir is honoured", async () => {
    const root = makeRoot();
    writeModule(
      root,
      "custom/mods/alpha.ts",
      `export default { meta: {}, setup(_options, gwen) { gwen.addPlugin({ src: "local-alpha" }); } }\n`,
    );
    writeModule(
      root,
      "src/modules/decoy.ts",
      `export default { meta: {}, setup(_options, gwen) { gwen.addPlugin({ src: "local-decoy" }); } }\n`,
    );
    const app = new GwenApp();
    await app.setupModules(
      resolveConfig({ modules: [], localModulesDir: "custom/mods" }),
      makeLoader({}),
      { root },
    );
    const srcs = declarationSrcs(app);
    expect(srcs).toContain("local-alpha");
    expect(srcs).not.toContain("local-decoy");

    const disabled = makeRoot();
    writeModule(
      disabled,
      "src/modules/decoy.ts",
      `export default { meta: {}, setup(_options, gwen) { gwen.addPlugin({ src: "local-decoy" }); } }\n`,
    );
    const off = new GwenApp();
    await off.setupModules(resolveConfig({ modules: [], localModulesDir: false }), makeLoader({}), {
      root: disabled,
    });
    expect(declarationSrcs(off).filter((src) => src.startsWith("local-"))).toEqual([]);
  });

  it("a local module name is local:<name> and an explicit meta.name wins", async () => {
    const root = makeRoot();
    writeModule(
      root,
      "src/modules/named.ts",
      `export default { meta: { name: "my-own-name" }, setup() {} }\n`,
    );
    writeModule(root, "src/modules/anon.ts", `export default { meta: {}, setup() {} }\n`);
    const app = new GwenApp();
    const before: string[] = [];
    app.buildHooks.hook("module:before", (mod) => {
      before.push(mod.meta.name);
    });
    await app.setupModules(resolveConfig({ modules: [] }), makeLoader({}), { root });
    expect(before.filter((name) => !name.startsWith("@"))).toEqual(["local:anon", "my-own-name"]);
  });

  it("a local module that cannot be loaded fails with APP:MODULE_LOAD_FAILED naming its file", async () => {
    const root = makeRoot();
    const file = join(root, "src", "modules", "broken.ts");
    writeModule(root, "src/modules/broken.ts", "export default {\n");
    const app = new GwenApp();
    let caught: unknown;
    try {
      await app.setupModules(resolveConfig({ modules: [] }), makeLoader({}), { root });
      caught = undefined;
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(GwenError);
    if (!(caught instanceof GwenError)) throw new Error("expected GwenError");
    expect(caught.code).toBe("APP:MODULE_LOAD_FAILED");
    expect(caught.message).toContain("local:broken");
    expect(caught.message).toContain(file);
    expect(caught.message).not.toContain("package is installed");
    expect(caught.message).not.toContain("gwen add");
  });

  it("a local module without setup fails with KIT:MODULE_INVALID naming its file", async () => {
    const root = makeRoot();
    const file = join(root, "src", "modules", "plain.ts");
    writeModule(root, "src/modules/plain.ts", "export default {}\n");
    const app = new GwenApp();
    let caught: unknown;
    try {
      await app.setupModules(resolveConfig({ modules: [] }), makeLoader({}), { root });
      caught = undefined;
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(GwenError);
    if (!(caught instanceof GwenError)) throw new Error("expected GwenError");
    expect(caught.code).toBe("KIT:MODULE_INVALID");
    expect(caught.message).toContain(file);
  });

  it("a local module with an empty meta.name gets the inferred name", async () => {
    const root = makeRoot();
    writeModule(
      root,
      "src/modules/blank.ts",
      `export default { meta: { name: "" }, setup() {} }\n`,
    );
    // A frozen meta is never written to: the name goes onto a copy.
    writeModule(
      root,
      "src/modules/frozen.ts",
      `const meta = Object.freeze({ name: "" });
export default { meta, setup() {} };
`,
    );
    const app = new GwenApp();
    const before: string[] = [];
    app.buildHooks.hook("module:before", (mod) => {
      before.push(mod.meta.name);
    });
    await app.setupModules(resolveConfig({ modules: [] }), makeLoader({}), { root });
    expect(before.filter((name) => !name.startsWith("@")).sort()).toEqual([
      "local:blank",
      "local:frozen",
    ]);
  });

  it("an invalid module fails the load with KIT:MODULE_INVALID", async () => {
    const root = makeRoot();
    writeModule(
      root,
      "src/modules/bad-key.ts",
      `export default { meta: { name: "ok:name", configKey: 1 }, setup() {} }\n`,
    );
    const app = new GwenApp();
    let caught: unknown;
    try {
      await app.setupModules(resolveConfig({ modules: [] }), makeLoader({}), { root });
      caught = undefined;
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(GwenModuleDefinitionError);
    if (!(caught instanceof GwenModuleDefinitionError)) {
      throw new Error("expected GwenModuleDefinitionError");
    }
    expect(caught.code).toBe("KIT:MODULE_INVALID");
    expect(caught.fields).toEqual(["meta.configKey"]);
    expect(caught.module).toBe("ok:name");
    expect(caught.message).toContain('Module "ok:name" is invalid: meta.configKey.');
  });

  it("a local module without meta fails with KIT:MODULE_INVALID naming its file", async () => {
    const root = makeRoot();
    const file = join(root, "src", "modules", "plain.ts");
    writeModule(root, "src/modules/plain.ts", "export default { setup() {} }\n");
    const app = new GwenApp();
    let caught: unknown;
    try {
      await app.setupModules(resolveConfig({ modules: [] }), makeLoader({}), { root });
      caught = undefined;
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(GwenModuleDefinitionError);
    if (!(caught instanceof GwenModuleDefinitionError)) {
      throw new Error("expected GwenModuleDefinitionError");
    }
    expect(caught.code).toBe("KIT:MODULE_INVALID");
    expect(caught.module).toBe(file);
    expect(caught.fields).toEqual(["meta"]);
  });

  it("a local module with a non-string meta.name fails with KIT:MODULE_INVALID", async () => {
    const root = makeRoot();
    writeModule(
      root,
      "src/modules/numbered.ts",
      `export default { meta: { name: 42 }, setup() {} }\n`,
    );
    const app = new GwenApp();
    let caught: unknown;
    try {
      await app.setupModules(resolveConfig({ modules: [] }), makeLoader({}), { root });
      caught = undefined;
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(GwenModuleDefinitionError);
    if (!(caught instanceof GwenModuleDefinitionError)) {
      throw new Error("expected GwenModuleDefinitionError");
    }
    expect(caught.code).toBe("KIT:MODULE_INVALID");
    expect(caught.fields).toEqual(["meta.name"]);
  });

  it("a local file built with defineGwenModule and no meta.name fails with KIT:MODULE_INVALID", async () => {
    const root = makeAppRoot();
    writeModule(
      root,
      "src/modules/score.ts",
      `import { defineGwenModule } from "@gwenjs/kit/module";
export default defineGwenModule({ meta: { configKey: "score" }, setup() {} });
`,
    );
    const app = new GwenApp();
    let caught: unknown;
    try {
      await app.setupModules(resolveConfig({ modules: [] }), makeLoader({}), { root });
      caught = undefined;
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(GwenError);
    if (!(caught instanceof GwenError)) throw new Error("expected GwenError");
    expect(caught.code).toBe("APP:MODULE_LOAD_FAILED");
    expect(caught.cause).toMatchObject({ code: "KIT:MODULE_INVALID", fields: ["meta.name"] });
  });
});

describe("resolveConfig — module entry as string only", () => {
  it("accepts string entries in modules array", () => {
    const cfg = resolveConfig({ modules: ["@test/mod-a", "@test/mod-b"] });
    expect(cfg.modules).toEqual(["@test/mod-a", "@test/mod-b"]);
  });

  it("modules defaults to empty array", () => {
    const cfg = resolveConfig({});
    expect(cfg.modules).toEqual([]);
  });
});

describe("GwenApp.setupModules — source transforms", () => {
  const REASON_NAME = 'the name must be "<namespace>:<transform>" in lower case';
  const REASON_GWEN = 'the "gwen:" namespace is reserved for built-in transforms';
  const REASON_RUN = "run is not a function";
  const HINT_NAME = 'Use a lower-case name "<namespace>:<transform>", for example "tint:inline".';
  const HINT_GWEN =
    'Choose a namespace other than "gwen". That namespace is reserved for built-in transforms.';
  const HINT_RUN = "Set run to a function. It receives the program and the transform context.";
  const HINT_DUPLICATE =
    "Register each source transform name once. Remove the second registration.";
  const BAD_NAMES = [
    "Tint:inline",
    "tint",
    "tint:Inline",
    "a:b:c",
    "tint:",
    ":inline",
    "",
    "tint:in line",
  ] as const;

  function invalidWhat(name: string, reason: string): string {
    return `Source transform "${name}" is invalid: ${reason}.`;
  }

  function duplicateWhat(name: string, moduleName: string): string {
    return `Source transform "${name}" is already registered by module "${moduleName}".`;
  }

  function grammarMessage(code: string, what: string, hint: string): string {
    const fix = __GWEN_DEV__ ? `\nFix: ${hint}` : "";
    const anchor = code.toLowerCase().replaceAll(":", "-").replaceAll("_", "-");
    return `[kit.addSourceTransform()] ${what}${fix}\nSee https://gwenjs.github.io/gwen/api/errors#${anchor} (${code})`;
  }

  function addSourceTransform(kit: GwenKit, transform: GwenSourceTransform): void {
    kit.addSourceTransform(transform);
  }

  function addUncheckedTransform(kit: GwenKit, transform: unknown): void {
    Reflect.apply(kit.addSourceTransform, kit, [transform]);
  }

  function sourceTransforms(app: GwenApp): GwenSourceTransform[] {
    return app.sourceTransforms;
  }

  function namedTransform(name: string): { name: string; run: () => readonly [] } {
    return { name, run: () => [] };
  }

  async function runModules(
    entries: ReadonlyArray<{ name: string; setup: GwenModule["setup"] }>,
  ): Promise<{ app: GwenApp; caught: unknown }> {
    const registry: Record<string, GwenModule> = {};
    const names: string[] = [];
    for (const entry of entries) {
      names.push(entry.name);
      registry[entry.name] = defineGwenModule({ meta: { name: entry.name }, setup: entry.setup });
    }
    const app = new GwenApp();
    const caught = await app
      .setupModules(resolveConfig({ modules: names }), makeLoader(registry))
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    return { app, caught };
  }

  function kitCause(caught: unknown): GwenError {
    expect(caught).toBeInstanceOf(GwenError);
    if (!(caught instanceof GwenError)) throw new Error("expected GwenError");
    expect(caught.code).toBe("APP:MODULE_SETUP_FAILED");
    expect(caught.cause).toBeInstanceOf(GwenError);
    if (!(caught.cause instanceof GwenError)) throw new Error("expected cause");
    return caught.cause;
  }

  it("addSourceTransform collects a valid transform and sourceTransforms returns it", async () => {
    const minimal = namedTransform("a:b");
    const tint = namedTransform("tint:inline");
    const dashed = namedTransform("tint-2:in-line");
    const { app, caught } = await runModules([
      {
        name: "@example/tint",
        setup(_options, kit) {
          addSourceTransform(kit, minimal);
          addSourceTransform(kit, tint);
          addSourceTransform(kit, dashed);
        },
      },
    ]);
    expect(caught).toBeUndefined();
    const listed = sourceTransforms(app);
    expect(listed).toEqual([minimal, tint, dashed]);
    expect(Array.isArray(listed) ? listed[0] : undefined).toBe(minimal);
    expect(Array.isArray(listed) ? listed[1] : undefined).toBe(tint);
    expect(Array.isArray(listed) ? listed[2] : undefined).toBe(dashed);
  });

  it("addSourceTransform rejects a gwen: name with KIT:SOURCE_TRANSFORM_INVALID", async () => {
    const reserved = await runModules([
      {
        name: "@example/tint",
        setup(_options, kit) {
          addSourceTransform(kit, namedTransform("gwen:x"));
        },
      },
    ]);
    const reservedCause = kitCause(reserved.caught);
    expect(reservedCause.code).toBe("KIT:SOURCE_TRANSFORM_INVALID");
    expect(reservedCause.composable).toBe("kit.addSourceTransform");
    expect(reservedCause.message).toContain("[kit.addSourceTransform()]");
    expect(reservedCause.message).toContain(invalidWhat("gwen:x", REASON_GWEN));

    const empty = await runModules([
      {
        name: "@example/tint",
        setup(_options, kit) {
          addSourceTransform(kit, namedTransform("gwen:"));
        },
      },
    ]);
    const emptyCause = kitCause(empty.caught);
    expect(emptyCause.code).toBe("KIT:SOURCE_TRANSFORM_INVALID");
    expect(emptyCause.message).toContain(invalidWhat("gwen:", REASON_NAME));
  });

  it.each(BAD_NAMES)(
    "addSourceTransform rejects an upper-case or colon-less name with KIT:SOURCE_TRANSFORM_INVALID",
    async (name) => {
      const { caught } = await runModules([
        {
          name: "@example/tint",
          setup(_options, kit) {
            addSourceTransform(kit, namedTransform(name));
          },
        },
      ]);
      const cause = kitCause(caught);
      expect(cause.code).toBe("KIT:SOURCE_TRANSFORM_INVALID");
      expect(cause.message).toContain(invalidWhat(name, REASON_NAME));
    },
  );

  it("addSourceTransform rejects a run that is not a function with KIT:SOURCE_TRANSFORM_INVALID", async () => {
    const samples: readonly unknown[] = [
      { name: "tint:inline" },
      { name: "tint:inline", run: null },
      { name: "tint:inline", run: "nope" },
      null,
      "nope",
      1,
    ];
    for (const sample of samples) {
      const { caught } = await runModules([
        {
          name: "@example/tint",
          setup(_options, kit) {
            addUncheckedTransform(kit, sample);
          },
        },
      ]);
      const cause = kitCause(caught);
      expect(cause.code).toBe("KIT:SOURCE_TRANSFORM_INVALID");
      expect(cause.message).toContain(REASON_RUN);
      const recordName =
        typeof sample === "object" && sample !== null && "name" in sample ? sample.name : "";
      const quoted = typeof recordName === "string" ? recordName : "";
      expect(cause.message).toContain(invalidWhat(quoted, REASON_RUN));
    }
  });

  it("the same name twice rejects KIT:SOURCE_TRANSFORM_DUPLICATE naming the first module", async () => {
    const same = await runModules([
      {
        name: "@example/tint",
        setup(_options, kit) {
          addSourceTransform(kit, namedTransform("tint:inline"));
          addSourceTransform(kit, namedTransform("tint:inline"));
        },
      },
    ]);
    const sameCause = kitCause(same.caught);
    expect(sameCause.code).toBe("KIT:SOURCE_TRANSFORM_DUPLICATE");
    expect(sameCause.message).toContain(duplicateWhat("tint:inline", "@example/tint"));

    const across = await runModules([
      {
        name: "@example/first",
        setup(_options, kit) {
          addSourceTransform(kit, namedTransform("tint:inline"));
        },
      },
      {
        name: "@example/second",
        setup(_options, kit) {
          addSourceTransform(kit, namedTransform("tint:inline"));
        },
      },
    ]);
    const acrossCause = kitCause(across.caught);
    expect(acrossCause.code).toBe("KIT:SOURCE_TRANSFORM_DUPLICATE");
    expect(acrossCause.composable).toBe("kit.addSourceTransform");
    expect(acrossCause.message).toContain(duplicateWhat("tint:inline", "@example/first"));
  });

  it("transforms are collected in module order", async () => {
    const first = namedTransform("aaa:first");
    const second = namedTransform("bbb:second");
    const { app, caught } = await runModules([
      {
        name: "@example/a",
        setup(_options, kit) {
          addSourceTransform(kit, first);
        },
      },
      {
        name: "@example/b",
        setup(_options, kit) {
          addSourceTransform(kit, second);
        },
      },
    ]);
    expect(caught).toBeUndefined();
    const listed = sourceTransforms(app);
    const again = sourceTransforms(app);
    expect(listed).toEqual([first, second]);
    expect(again).toEqual([first, second]);
    expect(listed).not.toBe(again);
    expect(Array.isArray(listed) ? listed[0] : undefined).toBe(first);
    expect(Array.isArray(listed) ? listed[1] : undefined).toBe(second);
  });

  it("KIT:SOURCE_TRANSFORM_INVALID and KIT:SOURCE_TRANSFORM_DUPLICATE render the grammar message with the hint only in dev", async () => {
    const invalid = await runModules([
      {
        name: "@example/tint",
        setup(_options, kit) {
          addSourceTransform(kit, namedTransform("Tint:inline"));
        },
      },
    ]);
    const invalidCause = kitCause(invalid.caught);
    expect(invalidCause.message).toBe(
      grammarMessage(
        "KIT:SOURCE_TRANSFORM_INVALID",
        invalidWhat("Tint:inline", REASON_NAME),
        HINT_NAME,
      ),
    );
    expect(invalidCause.hint).toBe(__GWEN_DEV__ ? HINT_NAME : undefined);

    const reserved = await runModules([
      {
        name: "@example/tint",
        setup(_options, kit) {
          addSourceTransform(kit, namedTransform("gwen:x"));
        },
      },
    ]);
    expect(kitCause(reserved.caught).message).toBe(
      grammarMessage("KIT:SOURCE_TRANSFORM_INVALID", invalidWhat("gwen:x", REASON_GWEN), HINT_GWEN),
    );

    const missingRun = await runModules([
      {
        name: "@example/tint",
        setup(_options, kit) {
          addUncheckedTransform(kit, { name: "tint:inline" });
        },
      },
    ]);
    expect(kitCause(missingRun.caught).message).toBe(
      grammarMessage(
        "KIT:SOURCE_TRANSFORM_INVALID",
        invalidWhat("tint:inline", REASON_RUN),
        HINT_RUN,
      ),
    );

    const duplicate = await runModules([
      {
        name: "@example/first",
        setup(_options, kit) {
          addSourceTransform(kit, namedTransform("tint:inline"));
        },
      },
      {
        name: "@example/second",
        setup(_options, kit) {
          addSourceTransform(kit, namedTransform("tint:inline"));
        },
      },
    ]);
    const duplicateCause = kitCause(duplicate.caught);
    expect(duplicateCause.message).toBe(
      grammarMessage(
        "KIT:SOURCE_TRANSFORM_DUPLICATE",
        duplicateWhat("tint:inline", "@example/first"),
        HINT_DUPLICATE,
      ),
    );
    expect(duplicateCause.hint).toBe(__GWEN_DEV__ ? HINT_DUPLICATE : undefined);
  });
});
