import { defineSystem, onUpdate, useService } from "@gwenjs/core/system";

export const Loop = defineSystem("Loop", () => {
  const items = [1, 2];
  onUpdate(() => {
    items.forEach(() => {
      useService("a");
    });
  });
});
