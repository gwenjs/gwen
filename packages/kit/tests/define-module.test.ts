/**
 * @gwenjs/kit — defineGwenModule() unit tests.
 *
 * `defineGwenModule()` is an identity function: it validates the definition
 * shape at compile time and returns it unchanged at runtime. These tests
 * verify runtime invariants and the GwenKit mock interface contract.
 */

import { describe, it, expect, vi } from "vitest";
import { defineGwenModule } from "../src/module";
import type { GwenKit } from "@gwenjs/schema";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Returns a minimal `GwenKit`-compatible mock.
 * All methods are `vi.fn()` stubs.
 */
function mockKit(): GwenKit {
  return {
    addPlugin: vi.fn(),
    addAutoImports: vi.fn(),
    addVitePlugin: vi.fn(),
    extendViteConfig: vi.fn(),
    addTypeTemplate: vi.fn(),
    addModuleAugment: vi.fn(),
    hook: vi.fn(),
    options: {},
  };
}

// ─── Identity behaviour ───────────────────────────────────────────────────────

describe("defineGwenModule() — identity", () => {
  it("returns the definition object unchanged (same reference)", () => {
    const setup = vi.fn();
    const definition = { meta: { name: "@test/module" }, setup };
    const mod = defineGwenModule(definition);
    expect(mod).toBe(definition);
  });

  it("meta.name is preserved on the returned module", () => {
    const mod = defineGwenModule({
      meta: { name: "@test/my-module" },
      setup: vi.fn(),
    });
    expect(mod.meta.name).toBe("@test/my-module");
  });

  it("meta.configKey is preserved when provided", () => {
    const mod = defineGwenModule({
      meta: { name: "@test/module", configKey: "myConfig" },
      setup: vi.fn(),
    });
    expect(mod.meta.configKey).toBe("myConfig");
  });

  it("meta.version is preserved when provided", () => {
    const mod = defineGwenModule({
      meta: { name: "@test/module", version: "2.3.4" },
      setup: vi.fn(),
    });
    expect(mod.meta.version).toBe("2.3.4");
  });

  it("defaults object is preserved on the returned module", () => {
    const mod = defineGwenModule({
      meta: { name: "@test/module" },
      defaults: { debug: true, poolSize: 128 },
      setup: vi.fn(),
    });
    expect(mod.defaults?.debug).toBe(true);
    expect(mod.defaults?.poolSize).toBe(128);
  });

  it("setup function reference is the same object", () => {
    const setup = vi.fn();
    const mod = defineGwenModule({ meta: { name: "@test/module" }, setup });
    expect(mod.setup).toBe(setup);
  });

  it("two independent definitions produce independent objects", () => {
    const modA = defineGwenModule({ meta: { name: "@test/a" }, setup: vi.fn() });
    const modB = defineGwenModule({ meta: { name: "@test/b" }, setup: vi.fn() });
    expect(modA).not.toBe(modB);
    expect(modA.meta.name).not.toBe(modB.meta.name);
  });
});

// ─── setup() invocation contract ─────────────────────────────────────────────

describe("defineGwenModule() — setup() call contract", () => {
  it("setup() is invoked with the provided options and GwenKit mock", () => {
    const setup = vi.fn();
    const mod = defineGwenModule({ meta: { name: "@test/module" }, setup });

    const kit = mockKit();
    const options = { speed: 10 };
    mod.setup(options, kit);

    expect(setup).toHaveBeenCalledTimes(1);
    expect(setup).toHaveBeenCalledWith(options, kit);
  });

  it("setup() can call gwen.addPlugin without throwing", () => {
    const mod = defineGwenModule({
      meta: { name: "@test/module" },
      setup(_opts, gwen) {
        gwen.addPlugin({ name: "TestPlugin", setup: vi.fn() });
      },
    });

    const kit = mockKit();
    mod.setup({}, kit);
    expect(kit.addPlugin).toHaveBeenCalledTimes(1);
  });

  it("setup() can call gwen.addAutoImports without throwing", () => {
    const mod = defineGwenModule({
      meta: { name: "@test/module" },
      setup(_opts, gwen) {
        gwen.addAutoImports([{ name: "useTest", from: "@test/module" }]);
      },
    });

    const kit = mockKit();
    mod.setup({}, kit);
    expect(kit.addAutoImports).toHaveBeenCalledWith([{ name: "useTest", from: "@test/module" }]);
  });

  it("setup() can call gwen.addTypeTemplate without throwing", () => {
    const mod = defineGwenModule({
      meta: { name: "@test/module" },
      setup(_opts, gwen) {
        gwen.addTypeTemplate({
          filename: "types/test.d.ts",
          getContents: () => "declare module '...' {}",
        });
      },
    });

    const kit = mockKit();
    mod.setup({}, kit);
    expect(kit.addTypeTemplate).toHaveBeenCalledTimes(1);
  });

  it("setup() can register a build-time hook", () => {
    const onDone = vi.fn();
    const mod = defineGwenModule({
      meta: { name: "@test/module" },
      setup(_opts, gwen) {
        gwen.hook("build:done", onDone);
      },
    });

    const kit = mockKit();
    mod.setup({}, kit);
    expect(kit.hook).toHaveBeenCalledWith("build:done", onDone);
  });

  it("async setup() returns a Promise", async () => {
    const mod = defineGwenModule({
      meta: { name: "@test/module" },
      async setup(_opts, _gwen) {
        await Promise.resolve();
      },
    });

    const kit = mockKit();
    const result = mod.setup({}, kit);
    expect(result).toBeInstanceOf(Promise);
    await result;
  });
});
