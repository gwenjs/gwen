import { defineActor, definePrefab } from "./barrel";

export const prefab = definePrefab([]);

export const Score = defineActor(prefab, (/*@map*/ scoreMark) => scoreMark);
