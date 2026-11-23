import { defineActor, definePrefab, useActor } from "@gwenjs/core/actor";

export const prefab = definePrefab([]);

export const C = defineActor("C", prefab, () => 0);

export const Outer = defineActor(prefab, () => {
  return defineActor(prefab, () => {
    useActor(C);
  });
});

export const kept = (/*@map*/ outerMark) => outerMark;
