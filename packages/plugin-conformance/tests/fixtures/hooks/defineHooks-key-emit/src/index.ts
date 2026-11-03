import { defineHooks, emit } from "@gwenjs/core";

const READY = "myplug:ready";

export const hooks = defineHooks({
  [READY]: () => {},
});

export function announce(): void {
  emit(READY);
}
