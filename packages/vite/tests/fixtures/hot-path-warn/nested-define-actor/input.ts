import { defineActor } from "@gwenjs/core/actor";
import { defineSystem, onUpdate, useService } from "@gwenjs/core/system";

export const Outer = defineSystem("Outer", () => {
  onUpdate(() => {
    const Inner = defineActor("Inner", () => {
      useService("inner");
    });
    useService("after");
    return Inner;
  });
});
