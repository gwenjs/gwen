import { defineLayout } from "@gwenjs/core/actor";

export const Level1 = defineLayout(() => ({}));
__GWEN_DEV__ && Object.assign(Level1, { __layoutName__: "Level1" });

export function build() {
  const Inner = defineLayout(() => ({}));
  __GWEN_DEV__ && Object.assign(Inner, { __layoutName__: "Inner" });
  return Inner;
}

export const kept = (/*@map*/ keptMark) => keptMark;
