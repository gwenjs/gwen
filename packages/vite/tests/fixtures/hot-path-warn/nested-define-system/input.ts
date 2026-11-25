import { defineSystem, onUpdate, useService } from "@gwenjs/core/system";

export const Outer = defineSystem("Outer", () => {
  onUpdate(() => {
    const Inner = defineSystem("Inner", () => {
      useService("inner");
    });
    useService("after");
    return Inner;
  });
});

export const Anchor = defineSystem("Anchor", () => {
  onUpdate(() => {
    useService("anchor");
  });
});
