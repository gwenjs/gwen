import { emit } from "@gwenjs/core";

export function leave(): void {
  emit("scene:enter");
}
