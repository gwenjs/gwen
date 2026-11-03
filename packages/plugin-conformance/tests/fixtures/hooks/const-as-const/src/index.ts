import { defineHooks, emit } from "@gwenjs/core";

const FIRST = "myplug:first" as const;
const SECOND = "myplug:second" satisfies string;
const THIRD = "myplug:third" satisfies string as string;

export const hooks = defineHooks({
  [FIRST]: () => {},
  [SECOND]: () => {},
  [THIRD]: () => {},
  ["myplug:fourth" as const]: () => {},
});

export function announce(): void {
  emit(FIRST);
  emit(SECOND);
  emit(THIRD);
  emit("myplug:fourth" as const);
}
