/**
 * @gwenjs/schema — module types structural tests.
 *
 * These tests verify the runtime shape of objects conforming to the
 * build-time module interfaces: AutoImport, GwenTypeTemplate, GwenBaseConfig,
 * and GwenBuildHooks handler signatures.
 */

import { describe, it, expect, vi } from "vitest";
import type { AutoImport, GwenTypeTemplate, GwenBaseConfig, GwenBuildHooks } from "../src";

describe("AutoImport", () => {
  it("accepts an object with required name and from fields", () => {
    const entry: AutoImport = { name: "usePhysics2D", from: "@gwenjs/physics2d" };
    expect(entry.name).toBe("usePhysics2D");
    expect(entry.from).toBe("@gwenjs/physics2d");
  });

  it("accepts an optional 'as' alias", () => {
    const entry: AutoImport = {
      name: "usePhysics2D",
      from: "@gwenjs/physics2d",
      as: "usePhysics",
    };
    expect(entry.as).toBe("usePhysics");
  });

  it("'as' is undefined when not provided", () => {
    const entry: AutoImport = { name: "usePhysics2D", from: "@gwenjs/physics2d" };
    expect(entry.as).toBeUndefined();
  });
});

describe("GwenTypeTemplate", () => {
  it("accepts a filename and getContents function", () => {
    const template: GwenTypeTemplate = {
      filename: "types/physics.d.ts",
      getContents() {
        return "declare module '...' {}";
      },
    };
    expect(template.filename).toBe("types/physics.d.ts");
    expect(template.getContents()).toBe("declare module '...' {}");
  });

  it("getContents is callable and returns a string", () => {
    const template: GwenTypeTemplate = {
      filename: "types/foo.d.ts",
      getContents: () => "// generated",
    };
    expect(typeof template.getContents()).toBe("string");
  });
});

describe("GwenBaseConfig", () => {
  it("accepts an empty config object", () => {
    const config: GwenBaseConfig = {};
    expect(config.modules).toBeUndefined();
    expect(config.engine).toBeUndefined();
  });

  it("accepts a modules array with strings and tuples", () => {
    const config: GwenBaseConfig = {
      modules: ["@gwenjs/renderer-2d", ["@gwenjs/input", { binding: "keyboard" }]],
    };
    expect(config.modules).toHaveLength(2);
    expect(config.modules?.[0]).toBe("@gwenjs/renderer-2d");
  });

  it("accepts engine sub-options", () => {
    const config: GwenBaseConfig = {
      engine: { maxEntities: 10_000, targetFPS: 120 },
    };
    expect(config.engine?.maxEntities).toBe(10_000);
    expect(config.engine?.targetFPS).toBe(120);
  });

  it("accepts arbitrary extra keys via index signature", () => {
    const config: GwenBaseConfig = { myModule: { debug: true } };
    expect((config as Record<string, unknown>)["myModule"]).toEqual({ debug: true });
  });
});

describe("GwenBuildHooks", () => {
  it("build:before handler is callable with no arguments", () => {
    const handler = vi.fn<GwenBuildHooks["build:before"]>();
    handler();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("build:done handler is callable with no arguments", () => {
    const handler = vi.fn<GwenBuildHooks["build:done"]>();
    handler();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("module:before handler receives mod with meta.name", () => {
    const handler = vi.fn<GwenBuildHooks["module:before"]>();
    handler({ meta: { name: "@test/module" } });
    expect(handler).toHaveBeenCalledWith({ meta: { name: "@test/module" } });
  });

  it("module:done handler receives mod with meta.name", () => {
    const handler = vi.fn<GwenBuildHooks["module:done"]>();
    handler({ meta: { name: "@test/module" } });
    expect(handler).toHaveBeenCalledWith({ meta: { name: "@test/module" } });
  });

  it("vite:extendConfig handler receives a ViteUserConfig-shaped object", () => {
    const handler = vi.fn<GwenBuildHooks["vite:extendConfig"]>();
    const config = { resolve: { alias: {} } };
    handler(config);
    expect(handler).toHaveBeenCalledWith(config);
  });
});
