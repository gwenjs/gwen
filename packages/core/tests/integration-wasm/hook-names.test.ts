import { expect, it } from "vitest";
import { createRealEngine } from "@gwenjs/core/testing";
import { GwenHookNameError } from "../../src/engine/engine-errors";
import { defineComponent, Types } from "../../src/schema";
import { Physics2DPlugin } from "../../../physics2d/src/plugin/index";
import { createPhysicsKinematicSyncSystem as createSync2d } from "../../../physics2d/src/systems";
import { Physics3DPlugin } from "../../../physics3d/src/plugin/index";
import { createPhysicsKinematicSyncSystem as createSync3d } from "../../../physics3d/src/systems";

const Position2D = defineComponent({
  name: "HookNamePos2D",
  schema: { x: Types.f32, y: Types.f32 },
  defaults: { x: 0, y: 0 },
});

const Position3D = defineComponent({
  name: "HookNamePos3D",
  schema: { x: Types.f32, y: Types.f32, z: Types.f32 },
  defaults: { x: 0, y: 0, z: 0 },
});

it("::physics2d and physics3d install and run one frame with no hook-name error", async () => {
  expect(typeof GwenHookNameError).toBe("function");
  const plane = await createRealEngine({ variant: "physics2d", maxEntities: 32 });
  const space = await createRealEngine({ variant: "physics3d", maxEntities: 32 });
  try {
    const codes2: string[] = [];
    const off2 = plane.engine.errors.on((event) => {
      codes2.push(event.code);
    });
    const codes3: string[] = [];
    const off3 = space.engine.errors.on((event) => {
      codes3.push(event.code);
    });
    try {
      await plane.engine.use(Physics2DPlugin());
      await plane.engine.use(createSync2d({ positionComponent: Position2D }));
      await plane.advance(1, 1 / 60);
      await space.engine.use(Physics3DPlugin());
      await space.engine.use(createSync3d({ positionComponent: Position3D })());
      await space.advance(1, 1 / 60);
      expect(codes2).toEqual([]);
      expect(codes3).toEqual([]);
    } finally {
      off2();
      off3();
    }
  } finally {
    await plane.dispose();
    await space.dispose();
  }
});
