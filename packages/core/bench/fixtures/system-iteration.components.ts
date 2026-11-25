import { defineComponent, Types } from "@gwenjs/core";

export const Position = defineComponent({
  name: "AllocPosition",
  schema: { x: Types.f32, y: Types.f32 },
});

export const Velocity = defineComponent({
  name: "AllocVelocity",
  schema: { vx: Types.f32, vy: Types.f32 },
});
