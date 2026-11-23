import { describe, expectTypeOf, it } from "vitest";
import { FRAMEWORK_RANGES } from "@gwenjs/schema";

describe("FRAMEWORK_RANGES", () => {
  it("FRAMEWORK_RANGES is Readonly<Record<string, string>>", () => {
    expectTypeOf(FRAMEWORK_RANGES).toEqualTypeOf<Readonly<Record<string, string>>>();
  });
});
