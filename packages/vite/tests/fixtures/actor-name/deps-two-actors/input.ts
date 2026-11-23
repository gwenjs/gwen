import { defineActor, definePrefab, useActor } from "@gwenjs/core/actor";

export const prefab = definePrefab([]);

export const A = defineActor("A", prefab, () => 0);

export const B = defineActor("B", prefab, () => 0);

export const Boss = defineActor(prefab, () => {
  useActor(A);
  useActor(B);
});

export const kept = (/*@map*/ bossMark) => bossMark;
