import { emit } from "@gwenjs/core";

export function Plugin() {
  return {
    name: "setup-emit",
    setup() {
      emit("myplug:setup");
    },
  };
}
