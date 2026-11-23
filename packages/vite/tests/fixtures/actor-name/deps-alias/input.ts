import { defineActor, definePrefab, useActor as ua } from "@gwenjs/core/actor";

export const prefab = definePrefab([]);

export const A = defineActor("A", prefab, () => 0);

export const Boss = defineActor(prefab, () => {
  ua(A);
});

export const kept = (/*@map*/ bossMark) => bossMark;
