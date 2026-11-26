import { defineComponent, Types } from "@gwenjs/core";

export const Coin = defineComponent({
  name: "Coin",
  schema: {
    value: Types.i32,
  },
});
