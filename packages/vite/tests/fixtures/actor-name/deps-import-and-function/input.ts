import { defineActor, definePrefab, useActor } from "@gwenjs/core/actor";

export const prefab = definePrefab([]);

export const Boss = defineActor(prefab, () => {
  useActor(Other);
  useActor(Helper);
});

import { Other } from "./other";

export function Helper() {
  return 0;
}

export const kept = (/*@map*/ helperMark) => helperMark;
