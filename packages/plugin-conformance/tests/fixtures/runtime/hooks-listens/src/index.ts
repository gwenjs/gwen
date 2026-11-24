import { useHook } from "@gwenjs/core";

interface Engine {
  hooks: { hook(name: string, fn: () => void): void };
}

export function Plugin() {
  return {
    name: "listens",
    setup(engine: Engine) {
      useHook("input:move", () => {});
      engine.hooks.hook("engine:tick", () => {});
    },
  };
}
