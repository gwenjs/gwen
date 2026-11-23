import { defineActor as da, definePrefab } from "@gwenjs/core/actor";

export const prefab = definePrefab([]);

export const Score = da(prefab, (/*@map*/ scoreMark) => scoreMark);
