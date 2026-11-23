import { defineSystem } from "@gwenjs/core/system";

export const top = defineSystem(1);

export function f() {
  const defineSystem = () => 1;
  return defineSystem();
}
