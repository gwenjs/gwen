import { defineLayout } from "@gwenjs/core/actor";

function dec(value: unknown) {
  return value;
}

@dec
export class Box {}

export const Level1 = defineLayout(() => ({}));

export const kept = (/*@map*/ keptMark) => keptMark;
