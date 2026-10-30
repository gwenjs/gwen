import { describe, expect, it } from "vitest";
import type { GwenKit } from "@gwenjs/schema";

function isKit(value: object): value is GwenKit {
  return "options" in value;
}

function recordingKit(calls: string[]): GwenKit {
  const target = { options: {} };
  const proxy = new Proxy(target, {
    get(target, key) {
      if (typeof key !== "string") return undefined;
      if (key in target) return Reflect.get(target, key);
      return (..._args: readonly unknown[]) => {
        calls.push(key);
      };
    },
  });
  if (!isKit(proxy)) {
    throw new Error("recording kit is missing options");
  }
  return proxy;
}

describe("@gwenjs/physics3d module export", () => {
  it("D13 module export: import('@gwenjs/physics3d/module') resolves", async () => {
    const specifier = "@gwenjs/physics3d/module";
    const loaded: { default: { meta: { name: string } } } = await import(specifier);
    expect(loaded).toBeTruthy();
    expect(loaded.default.meta.name).toBe("@gwenjs/physics3d");
  });

  it("setup declares Physics3DPlugin with JSON-serializable options", async () => {
    const { GwenApp } = await import("@gwenjs/app/resolve");
    const { resolveLoadedConfig } = await import("../../app/src/config");
    const loaded = await import("@gwenjs/physics3d/module");
    const gravity = { x: 0, y: -9.81, z: 0 };
    const resolved = resolveLoadedConfig({
      modules: ["@gwenjs/physics3d"],
      physics3d: { gravity },
    });
    const app = new GwenApp();
    const declaration = await app
      .setupModules(resolved, async (name) => {
        if (name !== "@gwenjs/physics3d") throw new Error(`unexpected module ${name}`);
        return loaded.default;
      })
      .then(
        () => app.pluginDeclarations.find((item) => item.src === "@gwenjs/physics3d"),
        () => undefined,
      );
    expect(declaration).toMatchObject({
      src: "@gwenjs/physics3d",
      export: "Physics3DPlugin",
      options: { gravity },
    });
    expect(JSON.parse(JSON.stringify(declaration))).toEqual(declaration);
  });

  it("the declared export exists on the package entry", async () => {
    const entry = await import("@gwenjs/physics3d");
    const { GwenApp } = await import("@gwenjs/app/resolve");
    const { resolveLoadedConfig } = await import("../../app/src/config");
    const loaded = await import("@gwenjs/physics3d/module");
    const gravity = { x: 0, y: -9.81, z: 0 };
    const resolved = resolveLoadedConfig({
      modules: ["@gwenjs/physics3d"],
      physics3d: { gravity },
    });
    const app = new GwenApp();
    const declaration = await app
      .setupModules(resolved, async (name) => {
        if (name !== "@gwenjs/physics3d") throw new Error(`unexpected module ${name}`);
        return loaded.default;
      })
      .then(
        () => app.pluginDeclarations.find((item) => item.src === "@gwenjs/physics3d"),
        () => undefined,
      );
    const exportName = declaration?.export ?? "";
    expect(typeof Reflect.get(entry, exportName)).toBe("function");
  });

  it("the module setup registers the plugin, auto-imports and vite plugin only", async () => {
    const calls: string[] = [];
    const loaded = await import("@gwenjs/physics3d/module");
    await loaded.default.setup({}, recordingKit(calls));
    expect(calls).toEqual(["addPlugin", "addAutoImports", "addVitePlugin"]);
  });
});
