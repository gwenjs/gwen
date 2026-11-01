/**
 * @gwenjs/kit — defineGwenModule() unit tests.
 *
 * `defineGwenModule()` checks the definition and returns the same object.
 * These tests verify that check, the runtime invariants, and the GwenKit mock.
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
        gwen.addPlugin({ src: "@test/module", export: "TestPlugin" });
      },
    });

    const kit = mockKit();
    mod.setup({}, kit);
    expect(kit.addPlugin).toHaveBeenCalledTimes(1);
    expect(kit.addPlugin).toHaveBeenCalledWith({ src: "@test/module", export: "TestPlugin" });
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

describe("defineGwenModule() — definition validation", () => {
  function thrownBy(definition: unknown): {
    code: string;
    module: string;
    fields: readonly string[];
    name: string;
    message: string;
    hint: string | undefined;
  } {
    let caught: unknown;
    try {
      Reflect.apply(defineGwenModule, undefined, [definition]);
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ code: "KIT:MODULE_INVALID" });
    if (typeof caught !== "object" || caught === null) throw new Error("expected an error object");
    const error = caught as {
      code: string;
      module: string;
      fields: readonly string[];
      name: string;
      message: string;
      hint?: string;
    };
    return {
      code: error.code,
      module: error.module,
      fields: error.fields,
      name: error.name,
      message: error.message,
      hint: error.hint,
    };
  }

  const cases: ReadonlyArray<readonly [string, unknown, readonly string[]]> = [
    ["meta missing", { setup() {} }, ["meta"]],
    ["empty name and bad setup", { meta: { name: "" }, setup: 1 }, ["meta.name", "setup"]],
    ["leading space", { meta: { name: " x" }, setup() {} }, ["meta.name"]],
    ["trailing space", { meta: { name: "x " }, setup() {} }, ["meta.name"]],
    ["configKey", { meta: { name: "ok", configKey: 1 }, setup() {} }, ["meta.configKey"]],
    ["version", { meta: { name: "ok", version: 1 }, setup() {} }, ["meta.version"]],
    ["defaults array", { meta: { name: "ok" }, defaults: [], setup() {} }, ["defaults"]],
    ["defaults null", { meta: { name: "ok" }, defaults: null, setup() {} }, ["defaults"]],
    ["defaults map", { meta: { name: "ok" }, defaults: new Map(), setup() {} }, ["defaults"]],
    ["setup missing", { meta: { name: "ok" } }, ["setup"]],
    ["validate", { meta: { name: "ok" }, setup() {}, validate: "x" }, ["validate"]],
    ["null definition", null, ["meta", "setup"]],
  ];

  it.each(cases)(
    "each invalid field gives KIT:MODULE_INVALID with the exact fields (%s)",
    (_label, definition, fields) => {
      const error = thrownBy(definition);
      expect(error.code).toBe("KIT:MODULE_INVALID");
      expect(error.fields).toEqual(fields);
    },
  );

  it("every failing path is collected before throwing", () => {
    const error = thrownBy({
      meta: { name: "", configKey: 1 },
      defaults: [],
      setup: 1,
    });
    expect(error.fields).toEqual(["meta.name", "meta.configKey", "defaults", "setup"]);
  });

  it('"@gwenjs/core:tween" is accepted', () => {
    const definition = { meta: { name: "@gwenjs/core:tween" }, setup() {} };
    expect(defineGwenModule(definition)).toBe(definition);
    expect(thrownBy({ meta: { name: "@gwenjs/core:tween " }, setup() {} }).fields).toEqual([
      "meta.name",
    ]);
  });

  it("the error names the module and renders the grammar", () => {
    const error = thrownBy({ meta: { name: "@test/m" }, setup: 1 });
    expect(error.name).toBe("GwenModuleDefinitionError");
    expect(error.module).toBe("@test/m");
    expect(
      error.message.startsWith('[defineGwenModule()] Module "@test/m" is invalid: setup.'),
    ).toBe(true);
    expect(error.message.endsWith("(KIT:MODULE_INVALID)")).toBe(true);
    expect(error.message.includes("[GWEN] [")).toBe(false);
    expect(thrownBy({}).module).toBe("<anonymous>");
    expect(thrownBy({ meta: { name: "" }, setup() {} }).module).toBe("<anonymous>");
  });

  it("dev hint names defineGwenModule", () => {
    if (!__GWEN_DEV__) return;
    const error = thrownBy({ meta: { name: "m" } });
    expect(error.hint ?? "").toContain("or build it with defineGwenModule from @gwenjs/kit");
  });

  it("no hint in prod", () => {
    if (__GWEN_DEV__) return;
    const error = thrownBy({ meta: { name: "m" } });
    expect(error.hint).toBeUndefined();
    expect(error.message.includes("Fix:")).toBe(false);
  });

  it("two calls do not share state", () => {
    expect(thrownBy({ meta: { name: "" }, setup() {} }).fields).toEqual(["meta.name"]);
    expect(thrownBy({ setup() {} }).fields).toEqual(["meta"]);
    const good = { meta: { name: "ok" }, setup() {} };
    expect(defineGwenModule(good)).toBe(good);
  });

  it("a valid definition with defaults, validate, configKey and version is returned unchanged", () => {
    const definition = {
      meta: { name: "mod", configKey: "mod", version: "1.2.3" },
      defaults: { n: 1 },
      validate() {
        return [];
      },
      setup() {},
    };
    expect(defineGwenModule(definition)).toBe(definition);
    const short = { meta: { name: "a" }, setup() {} };
    expect(defineGwenModule(short)).toBe(short);
    expect(thrownBy({ ...definition, meta: { ...definition.meta, version: 1 } }).fields).toEqual([
      "meta.version",
    ]);
  });

  it("a null-prototype defaults record is accepted", () => {
    const definition = {
      meta: { name: "ok" },
      defaults: Object.create(null),
      setup() {},
    };
    expect(defineGwenModule(definition)).toBe(definition);
    expect(thrownBy({ ...definition, defaults: new Map() }).fields).toEqual(["defaults"]);
  });
});
