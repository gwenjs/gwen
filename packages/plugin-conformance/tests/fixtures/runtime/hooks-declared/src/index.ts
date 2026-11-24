import { defineHooks, emit } from "@gwenjs/core";

export const hooks = defineHooks({
  "myplug:ready": () => {},
});

export function Plugin() {
  return {
    name: "declared",
    setup() {
      emit("myplug:ready");
    },
  };
}
