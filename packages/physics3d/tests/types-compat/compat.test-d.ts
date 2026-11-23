/**
 * Compile-time checks that a physics2d option value fits the physics3d option type.
 * The 2D composables are real exports. There is no runtime placeholder.
 */
import { describe, expectTypeOf, it } from "vitest";
import {
  useBoxCollider as useBoxCollider2d,
  useStaticBody as useStaticBody2d,
  type BoxColliderOptions,
  type StaticBodyOptions,
} from "@gwenjs/physics2d";
import {
  useBoxCollider as useBoxCollider3d,
  useStaticBody as useStaticBody3d,
} from "../../src/composables/index.js";
import type {
  BoxColliderHandle3D,
  ColliderHandle3D,
  DynamicBodyHandle3D,
  StaticBodyHandle3D,
  StaticBodyOptions3D,
} from "../../src/types.js";
import type { BoxColliderOptions3D } from "../../src/composables/use-box-collider.js";

function acceptStatic(options: Partial<StaticBodyOptions3D>): void {
  void options;
}

function acceptBox(options: Partial<BoxColliderOptions3D>): void {
  void options;
}

describe("physics3d options accept physics2d options", () => {
  it("a 2D static body options value fits StaticBodyOptions3D", () => {
    const prove = (options: StaticBodyOptions): void => {
      acceptStatic(options);
    };
    expectTypeOf(prove).toBeFunction();
    expectTypeOf(useStaticBody2d).toBeFunction();
    expectTypeOf(useStaticBody3d).toBeFunction();
  });

  it("a 2D box collider options value fits BoxColliderOptions3D", () => {
    const prove = (options: BoxColliderOptions<"2d">): void => {
      acceptBox(options);
    };
    expectTypeOf(prove).toBeFunction();
    expectTypeOf(useBoxCollider2d).toBeFunction();
    expectTypeOf(useBoxCollider3d).toBeFunction();
  });

  it("dynamic and box handles extend the static and collider handles", () => {
    expectTypeOf<DynamicBodyHandle3D>().toMatchTypeOf<StaticBodyHandle3D>();
    expectTypeOf<BoxColliderHandle3D>().toMatchTypeOf<ColliderHandle3D>();
    expectTypeOf<DynamicBodyHandle3D["applyForce"]>().toEqualTypeOf<
      (fx: number, fy: number, fz: number) => void
    >();
    expectTypeOf<DynamicBodyHandle3D["applyImpulse"]>().toEqualTypeOf<
      (ix: number, iy: number, iz: number) => void
    >();
    expectTypeOf<DynamicBodyHandle3D["applyTorque"]>().toEqualTypeOf<
      (tx: number, ty: number, tz: number) => void
    >();
    expectTypeOf<DynamicBodyHandle3D["setVelocity"]>().toEqualTypeOf<
      (vx: number, vy: number, vz: number) => void
    >();
  });
});
