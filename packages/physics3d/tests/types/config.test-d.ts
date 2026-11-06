import { describe, expectTypeOf, it } from "vitest";
import type { Physics3DConfig, Physics3DVec3 } from "../../src/types";

describe("Physics3DConfig gravity", () => {
  it("gravity is a full Vec3", () => {
    expectTypeOf<Physics3DConfig["gravity"]>().toEqualTypeOf<Physics3DVec3 | undefined>();
    expectTypeOf<Partial<Physics3DVec3> | undefined>().not.toEqualTypeOf<
      Physics3DConfig["gravity"]
    >();
  });
});
