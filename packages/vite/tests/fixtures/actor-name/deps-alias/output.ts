import { defineActor, definePrefab, useActor as ua } from "@gwenjs/core/actor";

export const prefab = definePrefab([]);

export const A = defineActor("A", prefab, () => 0);

export const Boss = defineActor("Boss", prefab, () => {
  ua(A);
});
Boss._plugin._deps = [A._plugin];

export const kept = (/*@map*/ bossMark) => bossMark;
