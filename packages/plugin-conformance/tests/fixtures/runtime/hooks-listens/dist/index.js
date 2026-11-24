import { useHook } from "@gwenjs/core";

// Twin of src/index.ts. Listens only: no emit.

export function Plugin() {
  return {
    name: "listens",
    setup(engine) {
      useHook("input:move", () => {});
      engine.hooks.hook("engine:tick", () => {});
    },
  };
}
