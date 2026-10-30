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

describe("@gwenjs/physics2d module", () => {
  it("the module setup registers the plugin, auto-imports and vite plugin only", async () => {
    const calls: string[] = [];
    const loaded = await import("@gwenjs/physics2d/module");
    await loaded.default.setup({}, recordingKit(calls));
    expect(calls).toEqual(["addPlugin", "addVitePlugin", "addAutoImports"]);
  });

  it("validate reports a bad layer bit as physics2d.layers.player", async () => {
    const { GwenApp, GwenAppConfigError } = await import("@gwenjs/app/resolve");
    const { resolveLoadedConfig } = await import("../../app/src/config");
    const loaded = await import("@gwenjs/physics2d/module");
    const resolved = resolveLoadedConfig({
      modules: ["@gwenjs/physics2d"],
      physics2d: { layers: { player: 99 } },
    });
    const app = new GwenApp();
    let issues: ReadonlyArray<{ path: string; expected: string; received: string }> = [];
    let caughtConfig = false;
    try {
      await app.setupModules(resolved, async (name) => {
        if (name !== "@gwenjs/physics2d") {
          throw new Error(`unexpected module ${name}`);
        }
        return loaded.default;
      });
    } catch (error) {
      if (!(error instanceof GwenAppConfigError)) throw error;
      caughtConfig = true;
      issues = error.issues;
    }
    expect(caughtConfig).toBe(true);
    const issue = issues.find((item) => item.path === "physics2d.layers.player");
    expect(issue?.path).toBe("physics2d.layers.player");
    expect(issue?.expected).toBe("an integer in [0, 31]");
    expect(issue?.received).toBe("99");
  });

  it("null layers pass setupModules", async () => {
    const { mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { GwenApp } = await import("@gwenjs/app/resolve");
    const { resolveGwenConfig } = await import("../../app/src/config");
    const loaded = await import("@gwenjs/physics2d/module");
    const dir = mkdtempSync(join(tmpdir(), "gwen-p61-null-layers-"));
    let failure = "";
    let declared = 0;
    try {
      writeFileSync(
        join(dir, "gwen.config.ts"),
        "export default { modules: ['@gwenjs/physics2d'], physics2d: { layers: null } };\n",
      );
      const resolved = await resolveGwenConfig(dir);
      const app = new GwenApp();
      await app.setupModules(resolved, async (name) => {
        if (name !== "@gwenjs/physics2d") {
          throw new Error(`unexpected module ${name}`);
        }
        return loaded.default;
      });
      declared = app.pluginDeclarations.filter(
        (item) => item.src === "@gwenjs/physics2d" && item.export === "Physics2DPlugin",
      ).length;
    } catch (error) {
      failure = error instanceof Error ? `${error.name}: ${error.message}` : "unknown";
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    expect({ failure, declared }).toEqual({ failure: "", declared: 1 });
  });

  it("setup declares Physics2DPlugin with JSON-serializable options", async () => {
    const { GwenApp } = await import("@gwenjs/app/resolve");
    const { resolveLoadedConfig } = await import("../../app/src/config");
    const loaded = await import("@gwenjs/physics2d/module");
    const resolved = resolveLoadedConfig({
      modules: ["@gwenjs/physics2d"],
      physics2d: { gravity: -9.81 },
    });
    const app = new GwenApp();
    const declaration = await app
      .setupModules(resolved, async (name) => {
        if (name !== "@gwenjs/physics2d") throw new Error(`unexpected module ${name}`);
        return loaded.default;
      })
      .then(
        () => app.pluginDeclarations.find((item) => item.src === "@gwenjs/physics2d"),
        () => undefined,
      );
    expect(declaration).toMatchObject({
      src: "@gwenjs/physics2d",
      export: "Physics2DPlugin",
      options: { gravity: -9.81 },
    });
    expect(JSON.parse(JSON.stringify(declaration))).toEqual(declaration);
  });

  it("the declared export exists on the package entry", async () => {
    const entry = await import("@gwenjs/physics2d");
    const { GwenApp } = await import("@gwenjs/app/resolve");
    const { resolveLoadedConfig } = await import("../../app/src/config");
    const loaded = await import("@gwenjs/physics2d/module");
    const resolved = resolveLoadedConfig({ modules: ["@gwenjs/physics2d"] });
    const app = new GwenApp();
    const declaration = await app
      .setupModules(resolved, async (name) => {
        if (name !== "@gwenjs/physics2d") throw new Error(`unexpected module ${name}`);
        return loaded.default;
      })
      .then(
        () => app.pluginDeclarations.find((item) => item.src === "@gwenjs/physics2d"),
        () => undefined,
      );
    const exportName = declaration?.export ?? "";
    expect(typeof Reflect.get(entry, exportName)).toBe("function");
  });

  it("module defaults are the plugin defaults", async () => {
    const config = await import("../src/config");
    expect(config.PHYSICS2D_DEFAULTS).toBeDefined();
    const loaded = await import("@gwenjs/physics2d/module");
    expect(loaded.default.defaults).toBe(config.PHYSICS2D_DEFAULTS);
    expect(Object.isFrozen(loaded.default.defaults)).toBe(true);
  });
});
