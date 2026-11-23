import { defineActor, definePrefab } from "@gwenjs/core/actor";

export const prefab = definePrefab([]);

export function inner(value: number) {
  const defineActor = (count: number) => count;
  const Hidden = defineActor(prefab, () => value);
  return Hidden;
}

export const Anchor = defineActor("Anchor", prefab, (/*@map*/ anchorMark) => anchorMark);
