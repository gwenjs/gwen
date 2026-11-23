import { defineActor, definePrefab } from "@gwenjs/core/actor";

export const prefab = definePrefab([]);

export const Other = defineActor("Other", prefab, () => 0);
