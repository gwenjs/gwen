import { describe, expectTypeOf, it } from "vitest";
import type { Vec3 } from "@gwenjs/math";
import type { Physics3DConfig } from "../../src/types";

describe("Physics3DConfig gravity", () => {
  it("gravity is a partial Vec3", () => {
    expectTypeOf<Physics3DConfig["gravity"]>().toEqualTypeOf<Partial<Vec3> | undefined>();
  });
});
