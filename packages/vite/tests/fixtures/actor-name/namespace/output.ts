import * as G from "@gwenjs/core/actor";

export const prefab = G.definePrefab([]);

export const Score = G.defineActor("Score", prefab, (/*@map*/ scoreMark) => scoreMark);
