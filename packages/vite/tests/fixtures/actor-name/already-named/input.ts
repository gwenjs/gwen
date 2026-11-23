import { defineActor, definePrefab, useActor } from "@gwenjs/core/actor";

export const prefab = definePrefab([]);

export const A = defineActor("A", prefab, () => 0);

export const Named = defineActor("Kept", prefab, () => {
  useActor(A);
});

export const Anchor = defineActor(prefab, (/*@map*/ anchorMark) => anchorMark);
