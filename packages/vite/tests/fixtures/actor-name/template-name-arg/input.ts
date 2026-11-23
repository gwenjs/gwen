import { defineActor, definePrefab } from "@gwenjs/core/actor";

export const prefab = definePrefab([]);

export const Named = defineActor(`n`, prefab, () => 1);

export const Anchor = defineActor(prefab, (/*@map*/ anchorMark) => anchorMark);
