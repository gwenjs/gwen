import { emit } from "@gwenjs/core";

export function Plugin() {
  return {
    name: "setup-emit",
    setup() {
      emit("myplug:setup");
    },
  };
}

/** Emits `myplug:each` on every `engine:update`. Not declared with defineHooks. */
export function EachFrame() {
  return {
    name: "each-frame",
    setup(engine: { hooks: { hook(name: string, fn: () => void): void } }) {
      engine.hooks.hook("engine:update", () => {
        emit("myplug:each");
      });
    },
  };
}
