import { defineSystem, onUpdate, useService } from "@gwenjs/core/system";

export const Audio = defineSystem("Audio", () => {
  onUpdate(() => {
    // @gwen-no-optimize
    const a = useService("silenced");
    const tail = [a];
    const b = useService("audible");
    return [tail, b];
  });
});
