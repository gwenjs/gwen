import { describe, expectTypeOf, it } from "vitest";

import { useService } from "@gwenjs/core/system";
import {
  useBoxCollider,
  useCapsuleCollider,
  useDynamicBody,
  useKinematicBody,
  usePhysics2D,
  useSphereCollider,
  useStaticBody,
} from "../../src/index.js";
import type {
  BoxColliderHandle,
  CapsuleColliderHandle,
  CircleColliderHandle,
  DynamicBodyHandle,
  KinematicBodyHandle,
  Physics2DAPI,
  StaticBodyHandle,
} from "../../src/index.js";

describe("physics2d composable inference", () => {
  it("physics2d composables return their handle types", () => {
    expectTypeOf(useStaticBody).returns.toEqualTypeOf<StaticBodyHandle>();
    expectTypeOf(useDynamicBody).returns.toEqualTypeOf<DynamicBodyHandle>();
    expectTypeOf(useKinematicBody).returns.toEqualTypeOf<KinematicBodyHandle>();
    expectTypeOf(useBoxCollider).returns.toEqualTypeOf<BoxColliderHandle>();
    expectTypeOf(useSphereCollider).returns.toEqualTypeOf<CircleColliderHandle>();
    expectTypeOf(useCapsuleCollider).returns.toEqualTypeOf<CapsuleColliderHandle>();
    expectTypeOf(usePhysics2D).returns.toEqualTypeOf<Physics2DAPI>();
  });

  it("physics2d service key resolves to Physics2DAPI", () => {
    expectTypeOf(useService("physics2d")).toEqualTypeOf<Physics2DAPI>();
  });
});
