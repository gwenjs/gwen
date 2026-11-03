import { defineHooks, emit } from "@gwenjs/core";

export const hooks = defineHooks({
  "myplug:ready": () => {},
});

export function announce(): void {
  emit("myplug:ready");
}
