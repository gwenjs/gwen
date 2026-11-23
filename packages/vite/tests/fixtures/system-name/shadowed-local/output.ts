import { defineSystem } from "@gwenjs/core/system";

export function inner(value: number) {
  const defineSystem = (count: number) => count;
  const Hidden = defineSystem(() => value);
  return Hidden;
}

export const Anchor = defineSystem("Anchor", (/*@map*/ anchorMark) => anchorMark);
