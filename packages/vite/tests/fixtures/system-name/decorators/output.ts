import { defineSystem } from "@gwenjs/core/system";

function dec(value: unknown) {
  return value;
}

@dec
export class Box {}

export const Score = defineSystem("Score", (/*@map*/ scoreMark) => scoreMark);
