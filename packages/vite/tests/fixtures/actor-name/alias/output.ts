import { defineActor as da, definePrefab } from "@gwenjs/core/actor";

export const prefab = definePrefab([]);

export const Score = da("Score", prefab, (/*@map*/ scoreMark) => scoreMark);
