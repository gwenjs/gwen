import { defineActor, definePrefab, useActor } from "@gwenjs/core/actor";

export const prefab = definePrefab([]);

export const Boss = defineActor(prefab, (Dep) => {
  useActor(Dep);
});
