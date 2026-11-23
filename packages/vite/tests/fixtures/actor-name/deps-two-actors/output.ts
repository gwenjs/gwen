import { defineActor, definePrefab, useActor } from "@gwenjs/core/actor";

export const prefab = definePrefab([]);

export const A = defineActor("A", prefab, () => 0);

export const B = defineActor("B", prefab, () => 0);

export const Boss = defineActor("Boss", prefab, () => {
  useActor(A);
  useActor(B);
});
Boss._plugin._deps = [A._plugin, B._plugin];

export const kept = (/*@map*/ bossMark) => bossMark;
