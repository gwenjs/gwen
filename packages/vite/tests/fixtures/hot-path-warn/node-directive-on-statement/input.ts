import { defineSystem, onUpdate, useService } from "@gwenjs/core/system";

// @gwen-no-optimize
export const A = defineSystem("A", () => {
  onUpdate(() => {
    useService("silenced");
  });
});

export const B = defineSystem("B", () => {
  onUpdate(() => {
    useService("audible");
  });
});
