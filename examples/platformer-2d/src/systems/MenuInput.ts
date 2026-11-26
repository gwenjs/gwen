import { emit, onCleanup, useEngine } from "@gwenjs/core";
import { defineSystem } from "@gwenjs/core/system";

export const MenuInputSystem = defineSystem(() => {
  const engine = useEngine();
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Enter") engine.run(() => emit("game:start"));
    if (event.key === "i") engine.run(() => emit("game:interpolation"));
  };
  window.addEventListener("keydown", onKeyDown);
  onCleanup(() => window.removeEventListener("keydown", onKeyDown));
});
