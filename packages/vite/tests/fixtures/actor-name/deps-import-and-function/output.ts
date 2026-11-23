import { defineActor, definePrefab, useActor } from "@gwenjs/core/actor";

export const prefab = definePrefab([]);

export const Boss = defineActor("Boss", prefab, () => {
  useActor(Other);
  useActor(Helper);
});
Boss._plugin._deps = [Other._plugin, Helper._plugin];

import { Other } from "./other";

export function Helper() {
  return 0;
}

export const kept = (/*@map*/ helperMark) => helperMark;
