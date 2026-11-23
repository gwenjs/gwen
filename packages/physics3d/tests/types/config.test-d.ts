import { describe, expectTypeOf, it } from "vitest";
import type { Vec3 } from "@gwenjs/math";
import type { Physics3DConfig } from "../../src/types";

describe("Physics3DConfig gravity", () => {
  it("gravity is a full Vec3", () => {
    expectTypeOf<Physics3DConfig["gravity"]>().toEqualTypeOf<Vec3 | undefined>();
    expectTypeOf<Partial<Vec3> | undefined>().not.toEqualTypeOf<Physics3DConfig["gravity"]>();
  });
});
