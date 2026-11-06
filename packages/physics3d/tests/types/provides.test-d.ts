import { describe, expectTypeOf, it } from "vitest";
import type { GwenPluginProvidedKeys } from "@gwenjs/kit/plugin";
import type { GwenProvides } from "@gwenjs/schema";
import type { Physics3DProvides } from "../../src/index.js";
import { Physics3DPlugin, createPhysicsKinematicSyncSystem } from "../../src/index.js";

type Declared =
  | GwenPluginProvidedKeys<typeof Physics3DPlugin>
  | GwenPluginProvidedKeys<typeof createPhysicsKinematicSyncSystem>;

describe("official plugin provides match the augment", () => {
  it("declared keys equal the augmented keys", () => {
    expectTypeOf<Declared>().toEqualTypeOf<keyof Physics3DProvides>();
    expectTypeOf<Declared | "not-physics3d">().not.toEqualTypeOf<keyof Physics3DProvides>();
    expectTypeOf<Pick<GwenProvides, keyof Physics3DProvides>>().toEqualTypeOf<Physics3DProvides>();
  });
});
