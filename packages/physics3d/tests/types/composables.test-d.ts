import { describe, expectTypeOf, it } from "vitest";

import type {
  CollisionContact,
  LayerSelector,
  PhysicsConfigBase,
  SensorState,
} from "@gwenjs/physics-core";
import { useHook, type GwenProvides } from "@gwenjs/core";
import type { EntityId } from "@gwenjs/schema";
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
  BulkStaticBoxesOptions,
  CapsuleColliderHandle3D,
  CompoundColliderOptions3D,
  DynamicBodyHandle3D,
  KinematicBodyHandle3D,
  Physics3DAPI,
  Physics3DConfig,
  Physics3DPluginHooks,
  SphereColliderHandle3D,
  StaticBodyHandle3D,
} from "../../src/index.js";
import type { OverlapOpts, RaycastOpts, ShapeCastOpts } from "../../src/types/joints.js";

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
  it("shared names", () => {
    expectTypeOf<Physics3DConfig["layers"]>().toEqualTypeOf<Record<string, number> | undefined>();
    expectTypeOf<Physics3DConfig>().toExtend<PhysicsConfigBase<"3d">>();
  });

  it("compound and bulk options name their filters layer and mask", () => {
    expectTypeOf<keyof CompoundColliderOptions3D>().toEqualTypeOf<"shapes" | "layer" | "mask">();
    expectTypeOf<keyof BulkStaticBoxesOptions>().toEqualTypeOf<
      "positions" | "halfExtents" | "friction" | "restitution" | "layer" | "mask"
    >();
    expectTypeOf<CompoundColliderOptions3D["layer"]>().toEqualTypeOf<LayerSelector | undefined>();
    expectTypeOf<CompoundColliderOptions3D["mask"]>().toEqualTypeOf<LayerSelector | undefined>();
    expectTypeOf<BulkStaticBoxesOptions["layer"]>().toEqualTypeOf<LayerSelector | undefined>();
    expectTypeOf<BulkStaticBoxesOptions["mask"]>().toEqualTypeOf<LayerSelector | undefined>();
    expectTypeOf<keyof RaycastOpts>().toEqualTypeOf<
      "direction" | "maxDist" | "layer" | "mask" | "solid" | "origin"
    >();
    expectTypeOf<keyof ShapeCastOpts>().toEqualTypeOf<
      "shape" | "direction" | "maxDist" | "layer" | "mask" | "origin" | "rotation"
    >();
    expectTypeOf<keyof OverlapOpts>().toEqualTypeOf<
      "shape" | "layer" | "mask" | "maxResults" | "origin" | "rotation"
    >();
    expectTypeOf<keyof NonNullable<Parameters<Physics3DAPI["castRay"]>[3]>>().toEqualTypeOf<
      "layer" | "mask" | "solid"
    >();
    expectTypeOf<keyof NonNullable<Parameters<Physics3DAPI["overlapShape"]>[3]>>().toEqualTypeOf<
      "layer" | "mask" | "maxResults"
    >();
  });

  it("shared collision hooks are the physics-core names", () => {
    useHook("physics:collision", (contacts) => {
      expectTypeOf(contacts).toEqualTypeOf<ReadonlyArray<CollisionContact>>();
    });
    useHook("physics:sensor:changed", (entityId, sensorId, state) => {
      expectTypeOf(entityId).toEqualTypeOf<EntityId>();
      expectTypeOf(sensorId).toEqualTypeOf<number>();
      expectTypeOf(state).toEqualTypeOf<SensorState>();
    });
    expectTypeOf<keyof Physics3DPluginHooks>().toEqualTypeOf<"physics3d:body-disabled">();
  });
});
