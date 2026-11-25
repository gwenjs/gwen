import { defineSystem, onUpdate, useService } from "@gwenjs/core/system";

// @gwen-no-optimize
// note
export const A = defineSystem("A", () => {
  onUpdate(() => {
    useService("a");
  });
});
