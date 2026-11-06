import { describe, expectTypeOf, it } from "vitest";
import type { GwenPluginProvidedKeys } from "@gwenjs/kit/plugin";
import type { GwenProvides } from "@gwenjs/schema";
import type { Physics2DProvides } from "../../src/index.js";
import { Physics2DPlugin, createPhysicsKinematicSyncSystem } from "../../src/index.js";

type Declared =
  | GwenPluginProvidedKeys<typeof Physics2DPlugin>
  | GwenPluginProvidedKeys<typeof createPhysicsKinematicSyncSystem>;

describe("official plugin provides match the augment", () => {
  it("declared keys equal the augmented keys", () => {
    expectTypeOf<Declared>().toEqualTypeOf<keyof Physics2DProvides>();
    expectTypeOf<Declared | "not-physics2d">().not.toEqualTypeOf<keyof Physics2DProvides>();
    expectTypeOf<Pick<GwenProvides, keyof Physics2DProvides>>().toEqualTypeOf<Physics2DProvides>();
  });
});
