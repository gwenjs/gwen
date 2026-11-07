import { expectTypeOf, it } from "vitest";
import type { GwenPluginRequires } from "@gwenjs/schema";
import "@gwenjs/camera-core";

declare module "@gwenjs/schema" {
  interface GwenPluginRegistry {
    "test:base": { readonly extensionApi: { readonly major: 1; readonly minor: 0 } };
    "test:plain": {};
  }
}

// String half and object half of `requires.plugins`.
// GwenPluginName is not imported: the base does not export it.
type Name = NonNullable<GwenPluginRequires["plugins"]>[number];
type PluginName = Extract<Name, string>;
type ObjectEntry = Exclude<Name, string>;

it("an unregistered string is a type error", () => {
  expectTypeOf<"nope">().not.toExtend<PluginName>();
});

it("a registered string is allowed", () => {
  ({ plugins: ["test:base"] }) satisfies GwenPluginRequires;
  expectTypeOf<"test:base">().toExtend<PluginName>();
});

it("equal major and a higher minor are allowed", () => {
  ({
    plugins: [{ name: "test:base", extensionApi: { major: 1, minor: 0 } }],
  }) satisfies GwenPluginRequires;
  ({
    plugins: [{ name: "test:base", extensionApi: { major: 1, minor: 1 } }],
  }) satisfies GwenPluginRequires;
  expectTypeOf<{
    readonly name: "test:base";
    readonly extensionApi: { readonly major: 1; readonly minor: 0 };
  }>().toExtend<ObjectEntry>();
  expectTypeOf<{
    readonly name: "test:base";
    readonly extensionApi: { readonly major: 1; readonly minor: 1 };
  }>().toExtend<ObjectEntry>();
});

it("a different major is a type error", () => {
  expectTypeOf<{
    readonly name: "test:base";
    readonly extensionApi: { readonly major: 2; readonly minor: 0 };
  }>().not.toExtend<ObjectEntry>();
});

it("object form rejects an entry without extensionApi", () => {
  expectTypeOf<{
    readonly name: "test:plain";
    readonly extensionApi: { readonly major: 1; readonly minor: 0 };
  }>().not.toExtend<ObjectEntry>();
});

it("object form rejects an unregistered name", () => {
  expectTypeOf<{
    readonly name: "nope";
    readonly extensionApi: { readonly major: 1; readonly minor: 0 };
  }>().not.toExtend<ObjectEntry>();
});

// gwen:tween and gwen:scene are registered in engine-types.ts, which the core entry emits.
// camera-core comes from the import above.
it("gwen:tween, gwen:scene and camera-core are plugin names", () => {
  ({ plugins: ["gwen:tween", "gwen:scene", "camera-core"] }) satisfies GwenPluginRequires;
  expectTypeOf<"gwen:tween">().toExtend<PluginName>();
  expectTypeOf<"gwen:scene">().toExtend<PluginName>();
  expectTypeOf<"camera-core">().toExtend<PluginName>();
});
