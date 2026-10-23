import { describe, it, expectTypeOf } from "vitest";
import type { GwenPrefabExtensions } from "@gwenjs/schema";

describe("schema extension types", () => {
  it("GwenPrefabExtensions has open index signature", () => {
    expectTypeOf<GwenPrefabExtensions>().toMatchTypeOf<Record<string, unknown>>();
  });
});
