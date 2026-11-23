import { defineActor, definePrefab } from "./barrel";

export const prefab = definePrefab([]);

export const Score = defineActor("Score", prefab, (/*@map*/ scoreMark) => scoreMark);
