import { defineActor, definePrefab, useActor } from "@gwenjs/core/actor";

export const prefab = definePrefab([]);

export function make() {
  const Inner = defineActor(prefab, () => {
    useActor(Later);
  });
  return Inner;
}

export const Later = defineActor("L", prefab, () => 0);

export const kept = (/*@map*/ innerMark) => innerMark;
