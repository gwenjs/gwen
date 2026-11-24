import { defineLayout } from "@gwenjs/core/actor";

export function inner(value: number) {
  const defineLayout = (count: number) => count;
  const Hidden = defineLayout(value);
  return Hidden;
}

export const Anchor = defineLayout(() => ({}));
__GWEN_DEV__ && Object.assign(Anchor, { __layoutName__: "Anchor" });

export const kept = (/*@map*/ keptMark) => keptMark;
