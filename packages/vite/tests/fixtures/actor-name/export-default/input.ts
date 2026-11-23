import { defineActor, definePrefab } from "@gwenjs/core/actor";

export const prefab = definePrefab([]);

export default defineActor(prefab, () => 1);

export const Anchor = defineActor(prefab, (/*@map*/ anchorMark) => anchorMark);
