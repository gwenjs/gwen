import { defineActor } from "other-lib";
import { defineActor as real, definePrefab } from "@gwenjs/core/actor";

export const prefab = definePrefab([]);

export const Foreign = defineActor(prefab, () => 1);

export const Anchor = real("Anchor", prefab, (/*@map*/ anchorMark) => anchorMark);
