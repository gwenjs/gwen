// @gwen-no-optimize
import { defineSystem, onUpdate, useService } from "@gwenjs/core/system";

export const Audio = defineSystem("Audio", () => {
  onUpdate(() => {
    useService("audio");
  });
});
