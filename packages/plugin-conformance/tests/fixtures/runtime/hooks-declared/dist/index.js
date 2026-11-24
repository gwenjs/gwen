import { defineHooks, emit } from "@gwenjs/core";

// Twin of src/index.ts. defineHooks declares myplug:ready; setup emits it.

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
