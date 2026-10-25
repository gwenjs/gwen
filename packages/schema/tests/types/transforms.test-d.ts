import { describe, expectTypeOf, it } from "vitest";
import type {
  EntityId,
  GwenProvides,
  TransformReader2D,
  TransformRef2D,
  TransformSample2D,
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
