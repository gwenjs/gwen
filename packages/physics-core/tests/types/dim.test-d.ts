import { expectTypeOf, it } from "vitest";
import type { Quat, Vec2, Vec3 } from "@gwenjs/math";
import type { DimRot, DimVec, KinematicBodyOptions } from "../../src/index.js";

it('DimVec<"2d"> is Vec2', () => {
  expectTypeOf<DimVec<"2d">>().toEqualTypeOf<Vec2>();
  expectTypeOf<DimVec<"3d">>().toEqualTypeOf<Vec3>();
  expectTypeOf<DimRot<"2d">>().toEqualTypeOf<number>();
  expectTypeOf<DimRot<"3d">>().toEqualTypeOf<Quat>();

  const ok: KinematicBodyOptions<"2d"> = {
    initialPosition: { x: 1, y: 2 },
    initialRotation: 0,
  };
  expectTypeOf(ok.initialPosition).toEqualTypeOf<Vec2 | undefined>();
});

it("a Vec3 is rejected in 2D options", () => {
  type Position2d = NonNullable<KinematicBodyOptions<"2d">["initialPosition"]>;
  type Position3d = NonNullable<KinematicBodyOptions<"3d">["initialPosition"]>;
  expectTypeOf<Position2d>().toEqualTypeOf<Vec2>();
  expectTypeOf<Position2d>().not.toEqualTypeOf<Vec3>();
  expectTypeOf<Position3d>().toEqualTypeOf<Vec3>();
  expectTypeOf<Position3d>().not.toEqualTypeOf<Vec2>();
});
