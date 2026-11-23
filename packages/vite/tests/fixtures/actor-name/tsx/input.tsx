import { defineActor, definePrefab } from "@gwenjs/core/actor";

export const prefab = definePrefab([]);

export const Score = defineActor(prefab, (/*@map*/ scoreMark: number) => scoreMark);

export const View = <span />;
