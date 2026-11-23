import { defineSystem } from "@gwenjs/core/system";

function dec(value: unknown) {
  return value;
}

@dec
export class Box {}

export const Score = defineSystem((/*@map*/ scoreMark) => scoreMark);
