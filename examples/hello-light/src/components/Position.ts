import { defineComponent, Types } from "@gwenjs/core";

export const Position = defineComponent({
  name: "Position",
  schema: {
    x: Types.f32,
    y: Types.f32,
  },
});
