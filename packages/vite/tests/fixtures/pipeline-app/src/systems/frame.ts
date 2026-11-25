import { defineSystem, onUpdate, useService } from "@gwenjs/core/system";

export const Frame = defineSystem("Frame", () => {
  onUpdate(() => {
    useService("audio");
  });
});
