import { defineActor, definePrefab, useActor } from "@gwenjs/core/actor";

export const prefab = definePrefab([]);

export const A = defineActor("A", prefab, () => 0);

export const list = [A];

export const ns = { A };

export const Boss = defineActor(prefab, () => {
  useActor(list[0]);
  useActor(ns.A);
});

export const Anchor = defineActor(prefab, (/*@map*/ anchorMark) => anchorMark);
