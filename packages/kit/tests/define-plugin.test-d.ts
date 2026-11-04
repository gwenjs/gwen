import { describe, expectTypeOf, it } from "vitest";
import { definePlugin } from "@gwenjs/kit/plugin";
import type {
  GwenDeclaredPlugin,
  GwenPluginDeclaration,
  GwenPluginOptionsInput,
  GwenPluginProvidedKeys,
  PluginKeyError,
} from "../src/define-plugin.js";

declare module "@gwenjs/schema" {
  interface GwenProvides {
    physics2d: { gravity: number };
    x: { n: number };
    y: { n: number };
    errors: { n: number };
    "wasm:bridge": { n: number };
    memory: { n: number };
  }
}

describe("definePlugin", () => {
  it("rejects onBeforeUpdate", () => {
    definePlugin(() => ({
      name: "P",
      setup() {},
      // @ts-expect-error
      onBeforeUpdate() {},
    }));
  });

  it("rejects onUpdate", () => {
    definePlugin(() => ({
      name: "P",
      setup() {},
      // @ts-expect-error
      onUpdate() {},
    }));
  });

  it("rejects onAfterUpdate", () => {
    definePlugin(() => ({
      name: "P",
      setup() {},
      // @ts-expect-error
      onAfterUpdate() {},
    }));
  });

  it("rejects onRender", () => {
    definePlugin(() => ({
      name: "P",
      setup() {},
      // @ts-expect-error
      onRender() {},
    }));
  });

  it("rejects onStart", () => {
    definePlugin(() => ({
      name: "P",
      setup() {},
      // @ts-expect-error
      onStart() {},
    }));
  });

  it("rejects onStop", () => {
    definePlugin(() => ({
      name: "P",
      setup() {},
      // @ts-expect-error
      onStop() {},
    }));
  });

  it("rejects onDestroy", () => {
    definePlugin(() => ({
      name: "P",
      setup() {},
      // @ts-expect-error
      onDestroy() {},
    }));
  });

  it("rejects version", () => {
    const allowed = { name: "P", setup() {} };
    definePlugin(() => ({
      ...allowed,
      // @ts-expect-error
      version: "1.2.3",
    }));
  });

  it("allowed keys and option forms keep their types", () => {
    const keyed = definePlugin(() => ({
      name: "P",
      setup() {},
      teardown() {},
      onError() {},
      requires: { plugins: ["other"] },
    }))();
    expectTypeOf(keyed.teardown).toBeFunction();
    expectTypeOf(keyed.onError).toBeFunction();
    expectTypeOf(keyed.requires).toEqualTypeOf<{ plugins: string[] }>();

    const noOptions = definePlugin(() => ({ name: "Bare", setup() {} }));
    expectTypeOf(noOptions).toBeCallableWith();
    expectTypeOf(noOptions().name).toEqualTypeOf<string>();
    expectTypeOf(noOptions().setup).toBeFunction();
    // @ts-expect-error
    noOptions({ n: 1 });

    const withOptions = definePlugin({ provides: [], options: { defaults: { n: 0 } } }, () => ({
      name: "N",
      setup() {},
    }));
    expectTypeOf(withOptions).toBeCallableWith();
    expectTypeOf(withOptions).toBeCallableWith({ n: 1 });
    expectTypeOf(withOptions({ n: 1 }).name).toEqualTypeOf<string>();
  });

  it("PluginKeyError names the hook and the bad key", () => {
    expectTypeOf<
      PluginKeyError<"onRender">
    >().toEqualTypeOf<`"onRender" is never called by the engine. In setup(), use engine.hooks.hook("engine:render", …)`>();
    expectTypeOf<
      PluginKeyError<"version">
    >().toEqualTypeOf<`"version" is not a GwenPlugin key (allowed: name, setup, teardown, onError, requires)`>();
  });

  it("PluginKeyError names definePlugin's first argument for provides and validateOptions", () => {
    expectTypeOf<
      PluginKeyError<"provides">
    >().toEqualTypeOf<`"provides" is set by definePlugin's first argument`>();
    expectTypeOf<
      PluginKeyError<"validateOptions">
    >().toEqualTypeOf<`"validateOptions" is set by definePlugin's first argument`>();
  });

  it("all three overloads infer", () => {
    const withOptions = definePlugin(
      { provides: ["physics2d"], options: { defaults: { gravity: -9.8 } } },
      (options) => {
        expectTypeOf(options).toEqualTypeOf<Readonly<{ gravity: number }>>();
        return { name: "P", setup() {} };
      },
    );
    expectTypeOf(withOptions)
      .parameter(0)
      .toEqualTypeOf<GwenPluginOptionsInput<{ gravity: number }> | undefined>();
    expectTypeOf(withOptions).returns.toExtend<GwenDeclaredPlugin<"physics2d">>();
    expectTypeOf(withOptions().provides).toEqualTypeOf<readonly "physics2d"[]>();
    expectTypeOf(withOptions().name).toEqualTypeOf<string>();

    const servicesOnly = definePlugin({ provides: ["x"] }, () => ({ name: "S", setup() {} }));
    expectTypeOf(servicesOnly).toBeCallableWith();
    expectTypeOf(servicesOnly).returns.toExtend<GwenDeclaredPlugin<"x">>();
    expectTypeOf(servicesOnly().provides).toEqualTypeOf<readonly "x"[]>();

    const bare = definePlugin(() => ({ name: "B", setup() {} }));
    expectTypeOf(bare).toBeCallableWith();
    expectTypeOf(bare).returns.toExtend<GwenDeclaredPlugin<never>>();
    expectTypeOf(bare().provides).toEqualTypeOf<readonly never[]>();
    expectTypeOf(bare().validateOptions).returns.toEqualTypeOf<
      ReturnType<GwenDeclaredPlugin<never>["validateOptions"]>
    >();
  });

  it("an annotated declaration is accepted as the first argument", () => {
    const declaration: GwenPluginDeclaration<{ gravity: number }, "physics2d"> = {
      provides: (options) => (options.gravity > 0 ? ["physics2d"] : []),
      options: { defaults: { gravity: 1 }, validate: () => [] },
    };
    const P = definePlugin(declaration, () => ({ name: "P", setup() {} }));
    expectTypeOf(P)
      .parameter(0)
      .toEqualTypeOf<GwenPluginOptionsInput<{ gravity: number }> | undefined>();
    expectTypeOf(P().provides).toEqualTypeOf<readonly "physics2d"[]>();
  });

  it("an annotated declaration with an array provides and options keeps its options", () => {
    const declaration: GwenPluginDeclaration<{ gravity: number }, "physics2d"> = {
      provides: ["physics2d"],
      options: { defaults: { gravity: 1 } },
    };
    const P = definePlugin(declaration, () => ({ name: "P", setup() {} }));
    expectTypeOf(P)
      .parameter(0)
      .toEqualTypeOf<GwenPluginOptionsInput<{ gravity: number }> | undefined>();
  });

  it("a provides function without parameters keeps its literal keys", () => {
    const P = definePlugin({ provides: () => ["x", "x"], options: { defaults: {} } }, () => ({
      name: "P",
      setup() {},
    }));
    expectTypeOf(P().provides).toEqualTypeOf<readonly "x"[]>();
  });

  it("provide of a key outside provides does not compile in an unannotated setup", () => {
    definePlugin({ provides: ["x"] }, () => ({
      name: "P",
      setup(engine) {
        engine.provide("x", { n: 1 });
        // @ts-expect-error
        engine.provide("y", { n: 1 });
      },
    }));
  });

  it("provide of a key outside an array provides does not compile with options", () => {
    definePlugin({ provides: ["x"], options: { defaults: {} } }, () => ({
      name: "P",
      setup(engine) {
        engine.provide("x", { n: 1 });
        // @ts-expect-error
        engine.provide("y", { n: 1 });
      },
    }));
  });

  it("provide of a key outside a function provides does not compile with options", () => {
    definePlugin({ provides: () => ["x"], options: { defaults: {} } }, () => ({
      name: "P",
      setup(engine) {
        engine.provide("x", { n: 1 });
        // @ts-expect-error
        engine.provide("y", { n: 1 });
      },
    }));
  });

  it("provides outside GwenProvides does not compile", () => {
    const make = () => ({ name: "P", setup() {} });
    definePlugin({ provides: ["physics2d"] }, make);
    // @ts-expect-error
    definePlugin({ provides: ["nope"] }, make);
  });

  it("provides of an engine key does not compile", () => {
    const make = () => ({ name: "P", setup() {} });
    definePlugin({ provides: ["x"] }, make);
    // @ts-expect-error
    definePlugin({ provides: ["logger"] }, make);
    // @ts-expect-error
    definePlugin({ provides: ["errors"] }, make);
    // @ts-expect-error
    definePlugin({ provides: ["wasm:bridge"] }, make);
    // @ts-expect-error
    definePlugin({ provides: ["memory"] }, make);
  });

  it("an explicit undefined option does not compile", () => {
    const strict = definePlugin({ provides: [], options: { defaults: { gravity: -9.8 } } }, () => ({
      name: "P",
      setup() {},
    }));
    strict({ gravity: 1 });
    strict();
    // @ts-expect-error
    strict({ gravity: undefined });

    const defaults: { scale: number | undefined } = { scale: 1 };
    const lenient = definePlugin({ provides: [], options: { defaults } }, () => ({
      name: "P",
      setup() {},
    }));
    lenient({ scale: undefined });
  });

  it("provides and validateOptions in the factory return do not compile", () => {
    const declared = definePlugin(() => ({ name: "P", setup() {} }))();
    expectTypeOf(declared.provides).toEqualTypeOf<readonly never[]>();
    expectTypeOf(declared.validateOptions).toBeFunction();

    definePlugin(() => ({
      name: "P",
      setup() {},
      // @ts-expect-error
      provides: ["x"],
    }));
    definePlugin(() => ({
      name: "P",
      setup() {},
      // @ts-expect-error
      validateOptions: () => [],
    }));
  });

  it("provides and validateOptions in the factory return do not compile with services", () => {
    const S = definePlugin({ provides: ["x"] }, () => ({ name: "S", setup() {} }));
    expectTypeOf(S().provides).toEqualTypeOf<readonly "x"[]>();

    // @ts-expect-error
    definePlugin({ provides: ["x"] }, () => ({
      name: "P",
      setup() {},
      provides: ["x"],
    }));
    // @ts-expect-error
    definePlugin({ provides: ["x"] }, () => ({
      name: "P",
      setup() {},
      validateOptions: () => [],
    }));
  });

  it("provides and validateOptions in the factory return do not compile with options", () => {
    const O = definePlugin({ provides: ["x"], options: { defaults: {} } }, () => ({
      name: "O",
      setup() {},
    }));
    expectTypeOf(O().provides).toEqualTypeOf<readonly "x"[]>();

    // @ts-expect-error
    definePlugin({ provides: ["x"], options: { defaults: {} } }, () => ({
      name: "P",
      setup() {},
      provides: ["x"],
    }));
    // @ts-expect-error
    definePlugin({ provides: ["x"], options: { defaults: {} } }, () => ({
      name: "P",
      setup() {},
      validateOptions: () => [],
    }));
  });

  it("GwenPluginProvidedKeys extracts K", () => {
    const withOptions = definePlugin(
      { provides: ["physics2d"], options: { defaults: { gravity: -9.8 } } },
      () => ({ name: "P", setup() {} }),
    );
    expectTypeOf<GwenPluginProvidedKeys<typeof withOptions>>().toEqualTypeOf<"physics2d">();

    const bare = definePlugin(() => ({ name: "B", setup() {} }));
    expectTypeOf<GwenPluginProvidedKeys<typeof bare>>().toEqualTypeOf<never>();
  });
});
