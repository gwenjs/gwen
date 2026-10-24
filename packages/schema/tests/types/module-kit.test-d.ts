import { describe, expectTypeOf, it } from "vitest";
import type { GwenKit } from "@gwenjs/schema";

describe("GwenKit", () => {
  it("GwenKit has no addTypeTemplate or addModuleAugment", () => {
    expectTypeOf<GwenKit>().not.toHaveProperty("addTypeTemplate");
    expectTypeOf<GwenKit>().not.toHaveProperty("addModuleAugment");
  });
});
