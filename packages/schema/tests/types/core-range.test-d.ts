import { describe, expectTypeOf, it } from "vitest";
import { CORE_RANGE } from "@gwenjs/schema";

describe("CORE_RANGE", () => {
  it("CORE_RANGE is the literal type ^1.0.0-alpha.0", () => {
    expectTypeOf(CORE_RANGE).toEqualTypeOf<"^1.0.0-alpha.0">();
  });
});
