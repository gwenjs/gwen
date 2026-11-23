import { defineActor, definePrefab } from "@gwenjs/core/actor";

export const prefab = definePrefab([]);

export const Boss = defineActor(prefab, (/*@map*/ bossMark) => bossMark);
