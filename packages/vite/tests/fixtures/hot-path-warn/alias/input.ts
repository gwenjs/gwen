import { defineSystem, onUpdate as every, useService as svc } from "@gwenjs/core/system";

export const Alias = defineSystem("Alias", () => {
  every(() => {
    svc("a");
  });
});
