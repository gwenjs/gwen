import { describe, expectTypeOf, it } from "vitest";
import { definePlugin } from "@gwenjs/kit/plugin";

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

    const withOptions = definePlugin((_options?: { n?: number }) => ({
      name: "N",
      setup() {},
    }));
    expectTypeOf(withOptions).toBeCallableWith();
    expectTypeOf(withOptions).toBeCallableWith({ n: 1 });
    expectTypeOf(withOptions({ n: 1 }).name).toEqualTypeOf<string>();
  });
});
