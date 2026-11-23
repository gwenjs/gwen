import { defineSystem } from "@gwenjs/core/system";

export const top = defineSystem(1);

export function f(defineSystem: () => number) {
  return defineSystem();
}
