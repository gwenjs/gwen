import { defineLayout } from "@gwenjs/core/actor";

export const Level1 = defineLayout(() => ({}));

export function build() {
  const Inner = defineLayout(() => ({}));
  return Inner;
}

export const kept = (/*@map*/ keptMark) => keptMark;
