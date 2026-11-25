import { defineSystem, onUpdate, useService } from "@gwenjs/core/system";

// @gwen-no-optimize-later
export const A = defineSystem("A", () => {
  onUpdate(() => {
    useService("a");
  });
});

// @gwen-no-optimize please
export const B = defineSystem("B", () => {
  onUpdate(() => {
    useService("b");
  });
});
