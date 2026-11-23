import { defineActor, definePrefab, useActor } from "@gwenjs/core/actor";

export const prefab = definePrefab([]);

export function make() {
  const Inner = defineActor("Inner", prefab, () => {
    useActor(Later);
  });
  Inner._plugin._deps = [Later._plugin];
  return Inner;
}

export const Later = defineActor("L", prefab, () => 0);

export const kept = (/*@map*/ innerMark) => innerMark;
