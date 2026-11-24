/**
 * `definePhysicsModule` registers one plugin, its auto-imports and its Vite plugin.
 */

import { expect, it } from "vitest";
import { GwenModuleDefinitionError } from "@gwenjs/kit/module";
import type { AutoImport, GwenKit, PluginDeclaration, VitePlugin } from "@gwenjs/schema";
import * as api from "../src/module/index.js";

const MODULE_INVALID = "KIT:MODULE_INVALID";

interface Recording {
  readonly plugins: PluginDeclaration[];
  readonly autoImportCalls: AutoImport[][];
  readonly vitePlugins: VitePlugin[];
  readonly kit: GwenKit;
}

function recordingKit(): Recording {
  const plugins: PluginDeclaration[] = [];
  const autoImportCalls: AutoImport[][] = [];
  const vitePlugins: VitePlugin[] = [];
  const kit: GwenKit = {
    addPlugin(plugin) {
      plugins.push(plugin);
    },
    addAutoImports(imports) {
      autoImportCalls.push(imports);
    },
    addVitePlugin(plugin) {
      vitePlugins.push(plugin);
    },
    addSourceTransform() {},
    extendViteConfig() {},
    hook() {},
    options: {},
  };
  return { plugins, autoImportCalls, vitePlugins, kit };
}

function moduleInvalidMessage(): string {
  const what = 'Module "<anonymous>" is invalid: meta.name.';
  const hint = __GWEN_DEV__
    ? "\nFix: Give the module a non-empty meta.name and a setup function, or build it with defineGwenModule from @gwenjs/kit."
    : "";
  return `[defineGwenModule()] ${what}${hint}\nSee https://gwenjs.github.io/gwen/api/errors#kit-module-invalid (${MODULE_INVALID})`;
}

it("returns a module whose meta carries the name and the config key", () => {
  expect(typeof api.definePhysicsModule).toBe("function");
  const mod = api.definePhysicsModule({
    name: "@gwenjs/physics2d",
    configKey: "physics2d",
    defaults: { gravity: -9.81 },
    plugin: { src: "@gwenjs/physics2d", export: "Physics2DPlugin" },
    vitePlugin: () => ({ name: "physics2d-vite" }),
    autoImports: [],
  });
  expect(mod.meta.name).toBe("@gwenjs/physics2d");
  expect(mod.meta.configKey).toBe("physics2d");
});

it("setup registers the plugin declaration with the resolved options", async () => {
  expect(typeof api.definePhysicsModule).toBe("function");
  const options = { gravity: -9.81 };
  const mod = api.definePhysicsModule({
    name: "@gwenjs/physics2d",
    configKey: "physics2d",
    defaults: { gravity: 0 },
    plugin: { src: "@gwenjs/physics2d", export: "Physics2DPlugin" },
    vitePlugin: () => ({ name: "physics2d-vite" }),
    autoImports: [],
  });
  const recording = recordingKit();
  await mod.setup(options, recording.kit);
  expect(recording.plugins).toEqual([
    { src: "@gwenjs/physics2d", export: "Physics2DPlugin", options },
  ]);
  expect(recording.plugins[0]?.options).toBe(options);
});

it("setup registers every auto-import once, in the given order", async () => {
  expect(typeof api.definePhysicsModule).toBe("function");
  const none: AutoImport[] = [];
  const empty = api.definePhysicsModule({
    name: "@gwenjs/physics2d",
    configKey: "physics2d",
    defaults: { gravity: 0 },
    plugin: { src: "@gwenjs/physics2d", export: "Physics2DPlugin" },
    vitePlugin: () => ({ name: "physics2d-vite" }),
    autoImports: none,
  });
  const emptyRecording = recordingKit();
  await empty.setup({ gravity: 0 }, emptyRecording.kit);
  expect(emptyRecording.autoImportCalls.length).toBe(1);
  expect(emptyRecording.autoImportCalls[0]).toEqual([]);
  expect(emptyRecording.autoImportCalls[0]).not.toBe(none);

  const imports: AutoImport[] = [
    { name: "useBody", from: "@gwenjs/physics2d" },
    { name: "useCollider", from: "@gwenjs/physics2d" },
  ];
  const filled = api.definePhysicsModule({
    name: "@gwenjs/physics2d",
    configKey: "physics2d",
    defaults: { gravity: 0 },
    plugin: { src: "@gwenjs/physics2d", export: "Physics2DPlugin" },
    vitePlugin: () => ({ name: "physics2d-vite" }),
    autoImports: imports,
  });
  const filledRecording = recordingKit();
  await filled.setup({ gravity: 1 }, filledRecording.kit);
  expect(filledRecording.autoImportCalls.length).toBe(1);
  expect(filledRecording.autoImportCalls[0]).toEqual([
    { name: "useBody", from: "@gwenjs/physics2d" },
    { name: "useCollider", from: "@gwenjs/physics2d" },
  ]);
  expect(filledRecording.autoImportCalls[0]).not.toBe(imports);
});

it("setup adds the vite plugin built from the resolved options", async () => {
  expect(typeof api.definePhysicsModule).toBe("function");
  const options = { gravity: -9.81 };
  let seen: typeof options | undefined;
  let returned: VitePlugin | undefined;
  const mod = api.definePhysicsModule({
    name: "@gwenjs/physics2d",
    configKey: "physics2d",
    defaults: { gravity: 0 },
    plugin: { src: "@gwenjs/physics2d", export: "Physics2DPlugin" },
    vitePlugin: (received) => {
      seen = received;
      returned = { name: "physics2d-vite", gravity: received.gravity };
      return returned;
    },
    autoImports: [],
  });
  const recording = recordingKit();
  await mod.setup(options, recording.kit);
  expect(seen).toBe(options);
  expect(recording.vitePlugins.length).toBe(1);
  expect(recording.vitePlugins[0]).not.toBe(returned);
  expect(recording.vitePlugins[0]).toEqual({ name: "physics2d-vite", gravity: -9.81 });
});

it("defaults and validate are passed through unchanged", () => {
  expect(typeof api.definePhysicsModule).toBe("function");
  const defaults = { gravity: -9.81 };
  const issues = [
    {
      path: "gravity",
      expected: "number",
      received: "string",
      owner: "physics2d",
    },
  ];
  const validated = api.definePhysicsModule({
    name: "@gwenjs/physics2d",
    configKey: "physics2d",
    defaults,
    validate: () => issues,
    plugin: { src: "@gwenjs/physics2d", export: "Physics2DPlugin" },
    vitePlugin: () => ({ name: "physics2d-vite" }),
    autoImports: [],
  });
  expect(validated.defaults).toBe(defaults);
  expect(validated.validate?.({ gravity: 1 })).toBe(issues);

  const plain = api.definePhysicsModule({
    name: "@gwenjs/physics3d",
    configKey: "physics3d",
    defaults: { gravity: 0 },
    plugin: { src: "@gwenjs/physics3d", export: "Physics3DPlugin" },
    vitePlugin: () => ({ name: "physics3d-vite" }),
    autoImports: [],
  });
  expect(Object.hasOwn(plain, "validate")).toBe(false);
  expect(plain.validate).toBeUndefined();
});

it("an empty name is rejected with KIT:MODULE_INVALID", () => {
  expect(typeof api.definePhysicsModule).toBe("function");
  let caught: unknown;
  try {
    api.definePhysicsModule({
      name: "",
      configKey: "physics2d",
      defaults: { gravity: -9.81 },
      plugin: { src: "@gwenjs/physics2d", export: "Physics2DPlugin" },
      vitePlugin: () => ({ name: "physics2d-vite" }),
      autoImports: [],
    });
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(GwenModuleDefinitionError);
  if (!(caught instanceof GwenModuleDefinitionError)) {
    throw new Error("expected GwenModuleDefinitionError");
  }
  expect(caught.code).toBe(MODULE_INVALID);
  expect(caught.message).toBe(moduleInvalidMessage());
});

it("two modules do not share setup state", async () => {
  expect(typeof api.definePhysicsModule).toBe("function");
  const optionsA = { gravity: 1 };
  const optionsB = { gravity: 2 };
  const modA = api.definePhysicsModule({
    name: "@gwenjs/a",
    configKey: "a",
    defaults: { gravity: 0 },
    plugin: { src: "@gwenjs/a", export: "PluginA" },
    vitePlugin: () => ({ name: "vite-a" }),
    autoImports: [{ name: "useA", from: "@gwenjs/a" }],
  });
  const modB = api.definePhysicsModule({
    name: "@gwenjs/b",
    configKey: "b",
    defaults: { gravity: 0 },
    plugin: { src: "@gwenjs/b", export: "PluginB" },
    vitePlugin: () => ({ name: "vite-b" }),
    autoImports: [
      { name: "useB", from: "@gwenjs/b" },
      { name: "useC", from: "@gwenjs/b" },
    ],
  });
  const kitA = recordingKit();
  const kitB = recordingKit();
  await modA.setup(optionsA, kitA.kit);
  await modB.setup(optionsB, kitB.kit);
  expect(kitA.plugins).toEqual([{ src: "@gwenjs/a", export: "PluginA", options: optionsA }]);
  expect(kitB.plugins).toEqual([{ src: "@gwenjs/b", export: "PluginB", options: optionsB }]);
  expect(kitA.plugins[0]?.options).toBe(optionsA);
  expect(kitB.plugins[0]?.options).toBe(optionsB);
  expect(kitA.autoImportCalls).toEqual([[{ name: "useA", from: "@gwenjs/a" }]]);
  expect(kitB.autoImportCalls).toEqual([
    [
      { name: "useB", from: "@gwenjs/b" },
      { name: "useC", from: "@gwenjs/b" },
    ],
  ]);
  expect(kitA.vitePlugins).toEqual([{ name: "vite-a" }]);
  expect(kitB.vitePlugins).toEqual([{ name: "vite-b" }]);
});
