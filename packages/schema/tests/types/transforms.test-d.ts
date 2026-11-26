import { describe, expectTypeOf, it } from "vitest";
import type {
  EntityId,
  GwenProvides,
  TransformReader2D,
  TransformReader3D,
  TransformRef2D,
  TransformRef3D,
  TransformSample2D,
  TransformSample3D,
} from "@gwenjs/schema";

describe("transform 2d contract", () => {
  it('GwenProvides["transform:2d"] is TransformReader2D', () => {
    expectTypeOf<GwenProvides["transform:2d"]>().toEqualTypeOf<TransformReader2D>();
  });

  it("TransformSample2D has exactly five number fields", () => {
    expectTypeOf<TransformSample2D>().toEqualTypeOf<{
      x: number;
      y: number;
      rotation: number;
      scaleX: number;
      scaleY: number;
    }>();
  });

  it("TransformRef2D is opaque: a plain object, a number and a slot index are not assignable", () => {
    expectTypeOf<{}>().not.toExtend<TransformRef2D>();
    expectTypeOf<number>().not.toExtend<TransformRef2D>();
    expectTypeOf<bigint>().not.toExtend<TransformRef2D>();
    expectTypeOf<EntityId>().not.toExtend<TransformRef2D>();
  });

  it("TransformReader2D track, release and read have the contract signatures", () => {
    expectTypeOf<TransformReader2D["track"]>().parameters.toEqualTypeOf<[EntityId]>();
    expectTypeOf<TransformReader2D["track"]>().returns.toEqualTypeOf<TransformRef2D>();
    expectTypeOf<TransformReader2D["release"]>().parameters.toEqualTypeOf<[TransformRef2D]>();
    expectTypeOf<TransformReader2D["release"]>().returns.toEqualTypeOf<void>();
    expectTypeOf<TransformReader2D["read"]>().parameters.toEqualTypeOf<
      [TransformRef2D, TransformSample2D]
    >();
    expectTypeOf<TransformReader2D["read"]>().returns.toEqualTypeOf<boolean>();
  });
});

describe("transform 3d contract", () => {
  it('GwenProvides["transform:3d"] is TransformReader3D', () => {
    expectTypeOf<GwenProvides["transform:3d"]>().toEqualTypeOf<TransformReader3D>();
  });

  it("TransformSample3D has exactly ten number fields", () => {
    expectTypeOf<TransformSample3D>().toEqualTypeOf<{
      x: number;
      y: number;
      z: number;
      qx: number;
      qy: number;
      qz: number;
      qw: number;
      scaleX: number;
      scaleY: number;
      scaleZ: number;
    }>();
  });

  it("TransformRef3D is opaque and not a TransformRef2D", () => {
    expectTypeOf<{}>().not.toExtend<TransformRef3D>();
    expectTypeOf<number>().not.toExtend<TransformRef3D>();
    expectTypeOf<bigint>().not.toExtend<TransformRef3D>();
    expectTypeOf<EntityId>().not.toExtend<TransformRef3D>();
    expectTypeOf<TransformRef2D>().not.toExtend<TransformRef3D>();
    expectTypeOf<TransformRef3D>().not.toExtend<TransformRef2D>();
  });

  it("TransformReader3D track, release and read have the contract signatures", () => {
    expectTypeOf<TransformReader3D["track"]>().parameters.toEqualTypeOf<[EntityId]>();
    expectTypeOf<TransformReader3D["track"]>().returns.toEqualTypeOf<TransformRef3D>();
    expectTypeOf<TransformReader3D["release"]>().parameters.toEqualTypeOf<[TransformRef3D]>();
    expectTypeOf<TransformReader3D["release"]>().returns.toEqualTypeOf<void>();
    expectTypeOf<TransformReader3D["read"]>().parameters.toEqualTypeOf<
      [TransformRef3D, TransformSample3D]
    >();
    expectTypeOf<TransformReader3D["read"]>().returns.toEqualTypeOf<boolean>();
  });
});
