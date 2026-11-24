import { emit } from "@gwenjs/core";

// Twin of src/index.ts. setup emits myplug:setup, which src does not declare.

export function Plugin() {
  return {
    name: "setup-emit",
    setup() {
      emit("myplug:setup");
    },
  };
}
