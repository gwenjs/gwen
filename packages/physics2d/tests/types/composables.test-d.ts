import { describe, expectTypeOf, it } from "vitest";

import type { Vec2 } from "@gwenjs/math";
import { useService } from "@gwenjs/core/system";
import {
  onContact,
  useBoxCollider,
  useCapsuleCollider,
  useDynamicBody,
  useKinematicBody,
  usePhysics2D,
  useSphereCollider,
  useStaticBody,
} from "../../src/index.js";
import type { EntityId, GwenRuntimeHooks } from "@gwenjs/schema";
import type {
  BodyKind,
  BoxColliderHandle,
  BoxColliderOptions,
  CapsuleColliderHandle,
  CircleColliderHandle,
  CollisionContact,
  DynamicBodyHandle,
  DynamicBodyOptions,
  KinematicBodyHandle,
  KinematicBodyOptions,
  Physics2DAPI,
  Physics2DConfig,
  Physics2DPrefabExtension,
  QualityPreset,
  SensorState,
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

  it("gravity is a partial Vec2", () => {
    expectTypeOf<Physics2DConfig["gravity"]>().toEqualTypeOf<Partial<Vec2> | undefined>();
  });

  it("body kind and quality preset use the shared names", () => {
    expectTypeOf<BodyKind>().toEqualTypeOf<"fixed" | "dynamic" | "kinematic">();
    expectTypeOf<QualityPreset>().toEqualTypeOf<"low" | "medium" | "high" | "esport">();
    expectTypeOf<Parameters<typeof useBoxCollider>[0]>().toEqualTypeOf<BoxColliderOptions<"2d">>();
    expectTypeOf<BoxColliderOptions<"2d">>().not.toHaveProperty("d");
    expectTypeOf<DynamicBodyOptions["layer"]>().toEqualTypeOf<
      string | number | readonly (string | number)[] | undefined
    >();
    expectTypeOf<DynamicBodyOptions["mask"]>().toEqualTypeOf<
      string | number | readonly (string | number)[] | undefined
    >();
  });

  it("initialAngle is not a kinematic option", () => {
    expectTypeOf<KinematicBodyOptions<"2d">>().not.toHaveProperty("initialAngle");
    expectTypeOf<KinematicBodyOptions<"2d">>().toHaveProperty("initialRotation");
  });

  it("Physics2DPrefabExtension initialLinearVelocity is Vec2 or undefined", () => {
    expectTypeOf<Physics2DPrefabExtension["initialLinearVelocity"]>().toEqualTypeOf<
      Vec2 | undefined
    >();
  });

  it("addBoxCollider and addBallCollider take an EntityId", () => {
    expectTypeOf<Parameters<Physics2DAPI["addBoxCollider"]>[0]>().toEqualTypeOf<EntityId>();
    expectTypeOf<Parameters<Physics2DAPI["addBallCollider"]>[0]>().toEqualTypeOf<EntityId>();
  });

  it("onContact returns an unsubscribe", () => {
    expectTypeOf(onContact).returns.toEqualTypeOf<() => void>();
  });

  it("collision hooks stay typed when only physics2d is imported", () => {
    expectTypeOf<GwenRuntimeHooks["physics:collision"]>().parameters.toEqualTypeOf<
      [ReadonlyArray<CollisionContact>]
    >();
    expectTypeOf<GwenRuntimeHooks["physics:sensor:changed"]>().parameters.toEqualTypeOf<
      [EntityId, number, SensorState]
    >();
  });
});
