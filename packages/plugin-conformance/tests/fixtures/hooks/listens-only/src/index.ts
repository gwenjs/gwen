import { useHook } from "@gwenjs/core";

interface Engine {
  hooks: { hook(name: string, fn: () => void): void };
}

export function listen(engine: Engine): void {
  useHook("input:move", () => {});
  engine.hooks.hook("engine:tick", () => {});
}
