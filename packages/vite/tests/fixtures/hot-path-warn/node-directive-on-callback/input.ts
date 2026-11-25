import { defineSystem, onUpdate, useService } from "@gwenjs/core/system";

export const Audio = defineSystem("Audio", () => {
  // @gwen-no-optimize
  onUpdate(() => {
    useService("silenced");
  });
  onUpdate(() => {
    useService("audible");
  });
});
