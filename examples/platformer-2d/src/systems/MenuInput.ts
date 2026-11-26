import { emit, onCleanup, useEngine } from "@gwenjs/core";
import { defineSystem } from "@gwenjs/core/system";

export const MenuInputSystem = defineSystem(() => {
  const engine = useEngine();
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Enter") engine.run(() => emit("game:start"));
  };
  window.addEventListener("keydown", onKeyDown);
  onCleanup(() => window.removeEventListener("keydown", onKeyDown));
});
