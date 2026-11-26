import { defineComponent, Types } from "@gwenjs/core";

export const Velocity = defineComponent({
  name: "Velocity",
  schema: {
    x: Types.f32,
    y: Types.f32,
  },
});
