import { defineActor, definePrefab } from "@gwenjs/core/actor";

export const prefab = definePrefab([]);

// export const A = defineActor(() => {});

export const Anchor = defineActor(prefab, (/*@map*/ anchorMark) => anchorMark);
