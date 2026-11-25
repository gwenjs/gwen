import { defineSystem, onUpdate, useService } from "@gwenjs/core/system";

export const Fn = defineSystem("Fn", () => {
  onUpdate(function () {
    useService("a");
  });
});
