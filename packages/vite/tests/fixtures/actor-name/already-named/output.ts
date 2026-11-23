import { defineActor, definePrefab, useActor } from "@gwenjs/core/actor";

export const prefab = definePrefab([]);

export const A = defineActor("A", prefab, () => 0);

export const Named = defineActor("Kept", prefab, () => {
  useActor(A);
});
Named._plugin._deps = [A._plugin];

export const Anchor = defineActor("Anchor", prefab, (/*@map*/ anchorMark) => anchorMark);
