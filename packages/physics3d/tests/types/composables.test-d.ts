import { describe, expectTypeOf, it } from "vitest";

import type { GwenProvides } from "@gwenjs/core";
import { useService } from "@gwenjs/core/system";
import {
  useBoxCollider,
  useCapsuleCollider,
  useDynamicBody,
  useKinematicBody,
  usePhysics3D,
  useSphereCollider,
  useStaticBody,
} from "../../src/index.js";
import type {
  BoxColliderHandle3D,
  CapsuleColliderHandle3D,
  DynamicBodyHandle3D,
  KinematicBodyHandle3D,
  Physics3DAPI,
  SphereColliderHandle3D,
  StaticBodyHandle3D,
} from "../../src/index.js";

describe("physics3d composable inference", () => {
  it("physics3d composables return their handle types", () => {
    expectTypeOf(useStaticBody).returns.toEqualTypeOf<StaticBodyHandle3D>();
    expectTypeOf(useDynamicBody).returns.toEqualTypeOf<DynamicBodyHandle3D>();
    expectTypeOf(useKinematicBody).returns.toEqualTypeOf<KinematicBodyHandle3D>();
    expectTypeOf(useBoxCollider).returns.toEqualTypeOf<BoxColliderHandle3D>();
    expectTypeOf(useSphereCollider).returns.toEqualTypeOf<SphereColliderHandle3D>();
    expectTypeOf(useCapsuleCollider).returns.toEqualTypeOf<CapsuleColliderHandle3D>();
    expectTypeOf(usePhysics3D).returns.toEqualTypeOf<Physics3DAPI>();
  });

  it("physics3d service key resolves to Physics3DAPI", () => {
    expectTypeOf(useService("physics3d")).toEqualTypeOf<Physics3DAPI>();
  });

  it("physics3d program does not know the physics2d service key", () => {
    expectTypeOf<"physics2d">().not.toExtend<keyof GwenProvides>();
  });
});
