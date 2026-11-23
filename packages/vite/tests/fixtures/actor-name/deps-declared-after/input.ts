import { defineActor, definePrefab, useActor } from "@gwenjs/core/actor";

export const prefab = definePrefab([]);

export const Boss = defineActor(prefab, () => {
  useActor(Y);
});

export const Y = defineActor("Y", prefab, () => 0);
