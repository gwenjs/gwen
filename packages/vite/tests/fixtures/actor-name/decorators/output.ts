import { defineActor, definePrefab } from "@gwenjs/core/actor";

export const prefab = definePrefab([]);

function dec(value: unknown) {
  return value;
}

@dec
export class Box {}

export const Score = defineActor("Score", prefab, (/*@map*/ scoreMark) => scoreMark);
