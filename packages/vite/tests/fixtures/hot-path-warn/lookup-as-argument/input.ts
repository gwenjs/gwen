import { defineSystem, onUpdate, useService } from "@gwenjs/core/system";

export const Argument = defineSystem("Argument", () => {
  onUpdate(useService("k").tick);
});

export const Anchor = defineSystem("Anchor", () => {
  onUpdate(() => {
    useService("anchor");
  });
});
