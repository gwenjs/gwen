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

// Twin of src/index.ts. EachFrame emits myplug:each on every engine:update.
export function EachFrame() {
  return {
    name: "each-frame",
    setup(engine) {
      engine.hooks.hook("engine:update", () => {
        emit("myplug:each");
      });
    },
  };
}
